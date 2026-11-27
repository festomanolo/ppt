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

async fn update_project(
    State(state): State<Arc<StudioState>>,
    Json(updated): Json<PresentationProject>,
) -> Result<Json<PresentationProject>, StatusCode> {
    {
        let db = state.db.lock().unwrap();
        db.save_project(&updated)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    let _ = export_offline_bundle(&updated, &state.autosave_bundle_path);
    let mut proj = state.active_project.lock().unwrap();
    *proj = updated.clone();
    Ok(Json(updated))
}

async fn load_starter(State(state): State<Arc<StudioState>>) -> Json<PresentationProject> {
    let starter = PresentationProject::starter_project();
    {
        let db = state.db.lock().unwrap();
        let _ = db.save_project(&starter);
    }
    let _ = export_offline_bundle(&starter, &state.autosave_bundle_path);
    let mut proj = state.active_project.lock().unwrap();
    *proj = starter.clone();
    Json(starter)
}

async fn load_benchmark_50(State(state): State<Arc<StudioState>>) -> Json<PresentationProject> {
    let showcase = PresentationProject::generate_50_frame_showcase();
    {
        let db = state.db.lock().unwrap();
        let _ = db.save_project(&showcase);
    }
    let _ = export_offline_bundle(&showcase, &state.autosave_bundle_path);
    let mut proj = state.active_project.lock().unwrap();
    *proj = showcase.clone();
    Json(showcase)
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
        let mut active = state.active_project.lock().unwrap();
        *active = project.clone();
        Ok(Json(project))
    } else {
        let active = state.active_project.lock().unwrap().clone();
        Ok(Json(active))
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
        let mut active = state.active_project.lock().unwrap();
        *active = project.clone();
        Ok(Json(project))
    } else {
        let active = state.active_project.lock().unwrap().clone();
        Ok(Json(active))
    }
}

async fn export_project_bundle(
    State(state): State<Arc<StudioState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let proj = state.active_project.lock().unwrap().clone();
    let bytes = export_offline_bundle_to_bytes(&proj)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let filename = format!("attachment; filename=\"{}.prezi-rs\"", proj.id);
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, filename),
        ],
        bytes,
    ))
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
    let starter = PresentationProject::starter_project();
    let initial_project = db.load_project(&starter.id)?.unwrap_or_else(|| {
        let _ = db.save_project(&starter);
        starter
    });
    let _ = export_offline_bundle(&initial_project, autosave_bundle_path);

    let state = Arc::new(StudioState {
        db: Mutex::new(db),
        active_project: Mutex::new(initial_project),
        themes: generate_100_themes(),
        autosave_bundle_path: autosave_bundle_path.to_string(),
    });

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Prezi-RS Offline Canvas Studio listening on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
