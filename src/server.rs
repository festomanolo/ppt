use crate::camera::{calculate_target_camera, interpolate_camera, interpolate_camera_parabolic};
use crate::scene::{Camera, FrameNode, PresentationProject};
use crate::storage::{
    export_offline_bundle, export_offline_bundle_to_bytes, import_offline_bundle_from_bytes,
    OfflineDatabase, DEFAULT_SVG_ASSET,
};
use crate::theme::{generate_100_themes, ThemePalette};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const INDEX_HTML: &str = include_str!("ui/index.html");
const APP_CSS: &str = include_str!("ui/app.css");

/// Front-end scripts in load order. Each is referenced from `index.html` as `<script src="/name"></script>`.
const SCRIPTS: [(&str, &str); 6] = [
    ("icons.js", include_str!("ui/icons.js")),
    ("engine.js", include_str!("ui/engine.js")),
    ("editor.js", include_str!("ui/editor.js")),
    ("outline.js", include_str!("ui/outline.js")),
    ("present.js", include_str!("ui/present.js")),
    ("boot.js", include_str!("ui/boot.js")),
];

const FONTS: [(&str, &[u8]); 3] = [
    ("Geist.woff2", include_bytes!("ui/fonts/Geist.woff2")),
    ("GeistMono.woff2", include_bytes!("ui/fonts/GeistMono.woff2")),
    ("GeistSerif.woff2", include_bytes!("ui/fonts/GeistSerif.woff2")),
];

pub struct StudioState {
    pub db: Mutex<OfflineDatabase>,
    pub active_project: Mutex<PresentationProject>,
    pub themes: Vec<ThemePalette>,
    pub autosave_bundle_path: String,
}

#[derive(Debug, Deserialize)]
pub struct CameraTransitionRequest {
    pub from: Camera,
    pub to: Camera,
    pub progress: f32,
    pub parabolic: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TargetCameraRequest {
    pub frame: FrameNode,
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub padding_factor: f32,
}

#[derive(Debug, Serialize)]
pub struct HealthStatus {
    pub status: &'static str,
    pub engine: &'static str,
    pub theme_count: usize,
    pub frame_count: usize,
}

#[derive(Debug, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub theme_id: String,
    pub updated_at: i64,
    pub frame_count: usize,
    pub step_count: usize,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
pub struct NewProjectRequest {
    pub name: Option<String>,
    /// `blank` (default), `starter` or `benchmark`.
    pub template: Option<String>,
    pub theme_id: Option<String>,
}

pub fn build_router(state: Arc<StudioState>) -> Router {
    Router::new()
        .route("/", get(serve_index))
        .route("/app.css", get(serve_css))
        .route("/js/:name", get(serve_script))
        .route("/fonts/:name", get(serve_font))
        .route("/assets/diagram.svg", get(serve_default_asset))
        .route("/api/health", get(get_health))
        .route("/api/themes", get(get_themes))
        .route("/api/project", get(get_project).put(update_project))
        .route("/api/project/starter", post(load_starter))
        .route("/api/project/benchmark-50", post(load_benchmark_50))
        .route("/api/project/undo", post(undo_project))
        .route("/api/project/redo", post(redo_project))
        .route("/api/project/export", get(export_project_bundle))
        .route("/api/project/export-html", get(export_project_html))
        .route("/api/project/import", post(import_project))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/:id", axum::routing::delete(delete_project))
        .route("/api/projects/:id/open", post(open_project))
        .route("/api/projects/:id/duplicate", post(duplicate_project))
        .route("/api/camera/target", post(compute_target_camera))
        .route("/api/camera/interpolate", post(compute_interpolated_camera))
        .layer(DefaultBodyLimit::max(96 * 1024 * 1024))
        .with_state(state)
}

async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn serve_css() -> Response {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], APP_CSS).into_response()
}

async fn serve_script(Path(name): Path<String>) -> Response {
    match SCRIPTS.iter().find(|(n, _)| *n == name) {
        Some((_, src)) => (
            [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
            *src,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_font(Path(name): Path<String>) -> Response {
    match FONTS.iter().find(|(n, _)| *n == name) {
        Some((_, bytes)) => (
            [
                (header::CONTENT_TYPE, "font/woff2"),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            *bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_default_asset() -> Response {
    ([(header::CONTENT_TYPE, "image/svg+xml")], DEFAULT_SVG_ASSET).into_response()
}

async fn get_health(State(state): State<Arc<StudioState>>) -> Json<HealthStatus> {
    let proj = state.active_project.lock().unwrap();
    Json(HealthStatus {
        status: "ok",
        engine: "prezi-rs",
        theme_count: state.themes.len(),
        frame_count: proj.frames.len(),
    })
}

async fn get_themes(State(state): State<Arc<StudioState>>) -> Json<Vec<ThemePalette>> {
    Json(state.themes.clone())
}

async fn get_project(State(state): State<Arc<StudioState>>) -> Json<PresentationProject> {
    let proj = state.active_project.lock().unwrap();
    Json(proj.clone())
}

/// Persists `project` to SQLite and the autosave bundle, and makes it the active project.
fn activate(state: &StudioState, mut project: PresentationProject) -> Result<PresentationProject, StatusCode> {
    project.normalize();
    {
        let db = state.db.lock().unwrap();
        db.save_project(&project)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    let _ = export_offline_bundle(&project, &state.autosave_bundle_path);
    *state.active_project.lock().unwrap() = project.clone();
    Ok(project)
}

async fn update_project(
    State(state): State<Arc<StudioState>>,
    Json(updated): Json<PresentationProject>,
) -> Result<Json<PresentationProject>, StatusCode> {
    activate(&state, updated).map(Json)
}

async fn load_starter(State(state): State<Arc<StudioState>>) -> Result<Json<PresentationProject>, StatusCode> {
    activate(&state, PresentationProject::starter_project()).map(Json)
}

async fn load_benchmark_50(
    State(state): State<Arc<StudioState>>,
) -> Result<Json<PresentationProject>, StatusCode> {
    activate(&state, PresentationProject::generate_50_frame_showcase()).map(Json)
}

fn new_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{:x}", prefix, nanos & 0xffff_ffff_ffff)
}

async fn list_projects(
    State(state): State<Arc<StudioState>>,
) -> Result<Json<Vec<ProjectSummary>>, StatusCode> {
    let active_id = state.active_project.lock().unwrap().id.clone();
    let rows = {
        let db = state.db.lock().unwrap();
        db.list_project_rows()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    let summaries = rows
        .into_iter()
        .map(|(id, name, updated_at, json)| {
            let parsed: Option<PresentationProject> = serde_json::from_str(&json).ok();
            ProjectSummary {
                active: id == active_id,
                theme_id: parsed.as_ref().map(|p| p.theme_id.clone()).unwrap_or_default(),
                frame_count: parsed.as_ref().map(|p| p.frames.len()).unwrap_or(0),
                step_count: parsed.as_ref().map(|p| p.presentation_path.len()).unwrap_or(0),
                id,
                name,
                updated_at,
            }
        })
        .collect();
    Ok(Json(summaries))
}

async fn create_project(
    State(state): State<Arc<StudioState>>,
    Json(req): Json<NewProjectRequest>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let mut project = match req.template.as_deref() {
        Some("starter") => PresentationProject::starter_project(),
        Some("benchmark") => PresentationProject::generate_50_frame_showcase(),
        _ => PresentationProject::blank_project(
            "",
            req.name.clone().unwrap_or_else(|| "Untitled deck".into()),
            req.theme_id.clone().unwrap_or_else(|| "tech-dark-1".into()),
        ),
    };
    project.id = new_id("deck");
    if let Some(name) = req.name {
        project.name = name;
    }
    if let Some(theme) = req.theme_id {
        project.theme_id = theme;
    }
    activate(&state, project).map(Json)
}

async fn open_project(
    State(state): State<Arc<StudioState>>,
    Path(id): Path<String>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let loaded = {
        let db = state.db.lock().unwrap();
        db.load_project(&id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    let mut project = loaded.ok_or(StatusCode::NOT_FOUND)?;
    project.normalize();
    let _ = export_offline_bundle(&project, &state.autosave_bundle_path);
    *state.active_project.lock().unwrap() = project.clone();
    Ok(Json(project))
}

async fn duplicate_project(
    State(state): State<Arc<StudioState>>,
    Path(id): Path<String>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let loaded = {
        let db = state.db.lock().unwrap();
        db.load_project(&id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    let mut project = loaded.ok_or(StatusCode::NOT_FOUND)?;
    project.id = new_id("deck");
    project.name = format!("{} copy", project.name);
    activate(&state, project).map(Json)
}

async fn delete_project(
    State(state): State<Arc<StudioState>>,
    Path(id): Path<String>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let next = {
        let db = state.db.lock().unwrap();
        db.delete_project(&id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = db
            .list_project_rows()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        rows.into_iter()
            .find_map(|(_, _, _, json)| serde_json::from_str::<PresentationProject>(&json).ok())
    };
    let active_id = state.active_project.lock().unwrap().id.clone();
    if active_id != id {
        return Ok(Json(state.active_project.lock().unwrap().clone()));
    }
    let project = match next {
        Some(p) => p,
        None => {
            let mut p = PresentationProject::starter_project();
            p.id = new_id("deck");
            p
        }
    };
    activate(&state, project).map(Json)
}

async fn import_project(
    State(state): State<Arc<StudioState>>,
    body: Bytes,
) -> Result<Json<PresentationProject>, (StatusCode, String)> {
    let project = import_offline_bundle_from_bytes(&body)
        .or_else(|_| serde_json::from_slice::<PresentationProject>(&body).map_err(|e| e.into()))
        .map_err(|e: Box<dyn std::error::Error>| {
            (StatusCode::BAD_REQUEST, format!("Not a valid .prezi-rs bundle: {}", e))
        })?;
    activate(&state, project)
        .map(Json)
        .map_err(|s| (s, "Could not save the imported deck".into()))
}

async fn undo_project(
    State(state): State<Arc<StudioState>>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let current_id = state.active_project.lock().unwrap().id.clone();
    let restored = {
        let db = state.db.lock().unwrap();
        db.undo(&current_id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    if let Some(project) = restored {
        let _ = export_offline_bundle(&project, &state.autosave_bundle_path);
        *state.active_project.lock().unwrap() = project.clone();
        Ok(Json(project))
    } else {
        Ok(Json(state.active_project.lock().unwrap().clone()))
    }
}

async fn redo_project(
    State(state): State<Arc<StudioState>>,
) -> Result<Json<PresentationProject>, StatusCode> {
    let current_id = state.active_project.lock().unwrap().id.clone();
    let restored = {
        let db = state.db.lock().unwrap();
        db.redo(&current_id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    if let Some(project) = restored {
        let _ = export_offline_bundle(&project, &state.autosave_bundle_path);
        *state.active_project.lock().unwrap() = project.clone();
        Ok(Json(project))
    } else {
        Ok(Json(state.active_project.lock().unwrap().clone()))
    }
}

fn safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() { "deck".into() } else { trimmed.to_string() }
}

async fn export_project_bundle(
    State(state): State<Arc<StudioState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let proj = state.active_project.lock().unwrap().clone();
    let bytes = export_offline_bundle_to_bytes(&proj)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let disposition = format!("attachment; filename=\"{}.prezi-rs\"", safe_filename(&proj.name));
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        bytes,
    ))
}

/// Builds a single self-contained HTML file (fonts, scripts, theme and deck inlined)
/// that plays the presentation from `file://` with no server or network.
pub fn build_standalone_html(project: &PresentationProject, themes: &[ThemePalette]) -> String {
    let mut project = project.clone();
    let svg_data = format!("data:image/svg+xml;base64,{}", B64.encode(DEFAULT_SVG_ASSET));
    for el in &mut project.elements {
        if el.src == "assets/diagram.svg" || el.src == "/assets/diagram.svg" {
            el.src = svg_data.clone();
        }
    }
    let theme = themes
        .iter()
        .find(|t| t.id == project.theme_id)
        .or_else(|| themes.first());
    let embed = serde_json::json!({ "project": project, "themes": theme.map(|t| vec![t.clone()]).unwrap_or_default() });
    let embed_json = serde_json::to_string(&embed)
        .unwrap_or_else(|_| "{}".into())
        .replace("</", "<\\/");

    let mut css = APP_CSS.to_string();
    for (name, bytes) in FONTS {
        css = css.replace(
            &format!("url(/fonts/{})", name),
            &format!("url(data:font/woff2;base64,{})", B64.encode(bytes)),
        );
    }

    let mut html = INDEX_HTML.replace(
        "<link rel=\"stylesheet\" href=\"/app.css\">",
        &format!("<style>{}</style>", css),
    );
    html = html.replace(
        "<!--EMBED-->",
        &format!("<script>window.__EMBED__ = {};</script>", embed_json),
    );
    for (name, src) in SCRIPTS {
        html = html.replace(
            &format!("<script src=\"/js/{}\"></script>", name),
            &format!("<script>{}</script>", src.replace("</script", "<\\/script")),
        );
    }
    html.replace(
        "<title>Prezi-RS Studio</title>",
        &format!("<title>{}</title>", escape_html(&project.name)),
    )
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

async fn export_project_html(State(state): State<Arc<StudioState>>) -> impl IntoResponse {
    let proj = state.active_project.lock().unwrap().clone();
    let html = build_standalone_html(&proj, &state.themes);
    let disposition = format!("attachment; filename=\"{}.html\"", safe_filename(&proj.name));
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        html,
    )
}

async fn compute_target_camera(Json(req): Json<TargetCameraRequest>) -> Json<Camera> {
    Json(calculate_target_camera(
        &req.frame,
        req.viewport_width,
        req.viewport_height,
        req.padding_factor,
    ))
}

async fn compute_interpolated_camera(Json(req): Json<CameraTransitionRequest>) -> Json<Camera> {
    let cam = if req.parabolic.unwrap_or(true) {
        interpolate_camera_parabolic(&req.from, &req.to, req.progress)
    } else {
        interpolate_camera(&req.from, &req.to, req.progress)
    };
    Json(cam)
}

pub async fn run_studio_server(
    addr: &str,
    db_path: &str,
    autosave_bundle_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let db = OfflineDatabase::open(db_path)?;
    // Reopen the most recently edited deck, falling back to the starter deck.
    let mut initial_project = db
        .list_project_rows()?
        .into_iter()
        .find_map(|(_, _, _, json)| serde_json::from_str::<PresentationProject>(&json).ok())
        .unwrap_or_else(|| {
            let starter = PresentationProject::starter_project();
            let _ = db.save_project(&starter);
            starter
        });
    // Upgrade the untouched legacy starter deck to the new one.
    if initial_project.id == "prezi-rs-starter"
        && initial_project.frames.iter().any(|f| !f.content_blocks.is_empty())
    {
        initial_project = PresentationProject::starter_project();
        let _ = db.save_project(&initial_project);
    }
    initial_project.normalize();
    let _ = export_offline_bundle(&initial_project, autosave_bundle_path);

    let state = Arc::new(StudioState {
        db: Mutex::new(db),
        active_project: Mutex::new(initial_project),
        themes: generate_100_themes(),
        autosave_bundle_path: autosave_bundle_path.to_string(),
    });

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Prezi-RS Studio running at http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
