//! Integration tests for the redesigned studio: scene integrity, theme contrast,
//! storage behaviour, the offline HTML player and the HTTP API.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use ppt::scene::{ContentBlock, FrameNode};
use ppt::server::{build_router, build_standalone_html, StudioState};
use ppt::*;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

/* ---------- helpers ---------- */

fn hsl_to_rgb(css: &str) -> (f64, f64, f64) {
    let inner = css.trim_start_matches("hsla(").trim_start_matches("hsl(").trim_end_matches(')');
    let parts: Vec<f64> = inner
        .split(',')
        .map(|p| p.trim().trim_end_matches('%').parse::<f64>().unwrap())
        .collect();
    let (h, s, l) = (parts[0] / 360.0, parts[1] / 100.0, parts[2] / 100.0);
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f64| {
        if t < 0.0 { t += 1.0 }
        if t > 1.0 { t -= 1.0 }
        if t < 1.0 / 6.0 { p + (q - p) * 6.0 * t }
        else if t < 0.5 { q }
        else if t < 2.0 / 3.0 { p + (q - p) * (2.0 / 3.0 - t) * 6.0 }
        else { p }
    };
    (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0))
}

fn luminance(css: &str) -> f64 {
    let (r, g, b) = hsl_to_rgb(css);
    let lin = |c: f64| if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

fn contrast(a: &str, b: &str) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

fn test_state(project: PresentationProject) -> Arc<StudioState> {
    let db = OfflineDatabase::open_in_memory().unwrap();
    db.save_project(&project).unwrap();
    let bundle = std::env::temp_dir().join(format!("ppt-test-{}.prezi-rs", project.id));
    Arc::new(StudioState {
        db: Mutex::new(db),
        active_project: Mutex::new(project),
        themes: generate_100_themes(),
        autosave_bundle_path: bundle.to_string_lossy().into_owned(),
    })
}

async fn send(app: &axum::Router, method: &str, uri: &str, body: Option<String>) -> (StatusCode, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    if body.is_some() {
        req = req.header("content-type", "application/json");
    }
    let resp = app
        .clone()
        .oneshot(req.body(body.map(Body::from).unwrap_or_else(Body::empty)).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes)
}

/* ---------- scene ---------- */

#[test]
fn starter_deck_path_points_at_real_objects() {
    let p = PresentationProject::starter_project();
    assert!(p.presentation_path.len() >= 10, "starter tour should have a real path");
    for step in &p.presentation_path {
        assert!(
            p.frames.iter().any(|f| f.id == step.frame_id) || p.elements.iter().any(|e| e.id == step.frame_id),
            "path step points at missing object {}",
            step.frame_id
        );
    }
    // Reveal steps must refer to existing path indices.
    for el in &p.elements {
        if let Some(r) = el.reveal_step {
            assert!((r as usize) < p.presentation_path.len());
        }
    }
    let mut ids = std::collections::HashSet::new();
    for id in p.frames.iter().map(|f| &f.id).chain(p.elements.iter().map(|e| &e.id)) {
        assert!(ids.insert(id.clone()), "duplicate id {}", id);
    }
}

#[test]
fn normalize_migrates_legacy_content_once() {
    let mut p = PresentationProject::new("legacy", "Legacy", "tech-dark-1");
    p.add_frame(
        FrameNode {
            id: "f1".into(),
            title: "Old frame".into(),
            position: CanvasPoint::new(0.0, 0.0),
            width: 800.0,
            height: 460.0,
            content_blocks: vec![
                ContentBlock::Text { text: "Hello".into(), font_size: 20.0, color_token: "primary_accent".into() },
                ContentBlock::Shape { shape_type: "circle".into(), stroke: 2.0 },
                ContentBlock::Image { relative_path: "assets/diagram.svg".into() },
            ],
            ..Default::default()
        },
        true,
        1000,
    );
    p.normalize();
    assert!(p.frames[0].content_blocks.is_empty());
    // Title + text + shape + image
    assert_eq!(p.elements.len(), 4);
    assert!(p.elements.iter().any(|e| e.kind == ElementKind::Text && e.text == "Hello" && e.color_token == "accent"));
    assert!(p.elements.iter().any(|e| e.kind == ElementKind::Shape && e.shape == "ellipse"));
    assert!(p.elements.iter().any(|e| e.kind == ElementKind::Image));
    let before = p.clone();
    p.normalize();
    assert_eq!(p, before, "normalize must be idempotent");
}

#[test]
fn legacy_json_without_new_fields_still_loads() {
    // A deck saved by the first version of the engine (no elements / style / transition fields).
    let json = r#"{"id":"old","name":"Old","theme_id":"tech-dark-1",
        "frames":[{"id":"a","title":"A","position":{"x":0,"y":0},"width":100,"height":80,"rotation":0,
                   "children_ids":[],"content_blocks":[]}],
        "presentation_path":[{"frame_id":"a","transition_duration_ms":900}]}"#;
    let p: PresentationProject = serde_json::from_str(json).expect("old decks must deserialize");
    assert_eq!(p.frames[0].style, FrameStyle::Rect);
    assert_eq!(p.frames[0].fill_token, "surface");
    assert_eq!(p.presentation_path[0].transition, TransitionKind::Zoom);
    assert!(p.elements.is_empty());
}

/* ---------- themes ---------- */

#[test]
fn every_theme_meets_contrast_targets() {
    for t in generate_100_themes() {
        let body = contrast(&t.text_primary, &t.background);
        let on_surface = contrast(&t.text_primary, &t.surface);
        let muted = contrast(&t.text_muted, &t.background);
        let accent = contrast(&t.primary_accent, &t.background);
        assert!(body >= 7.0, "{}: text/bg {:.2}", t.id, body);
        assert!(on_surface >= 4.5, "{}: text/surface {:.2}", t.id, on_surface);
        assert!(muted >= 4.5, "{}: muted/bg {:.2}", t.id, muted);
        assert!(accent >= 3.0, "{}: accent/bg {:.2}", t.id, accent);
        let accent2 = contrast(&t.secondary_accent, &t.background);
        assert!(accent2 >= 2.9, "{}: accent2/bg {:.2}", t.id, accent2);
        assert!(["dots", "grid", "glow", "none"].contains(&t.pattern.as_str()));
    }
}

#[test]
fn themes_have_distinct_names() {
    let themes = generate_100_themes();
    let names: std::collections::HashSet<_> = themes.iter().map(|t| t.name.clone()).collect();
    assert_eq!(names.len(), 100);
}

/* ---------- storage ---------- */

#[test]
fn delete_removes_deck_and_history() {
    let db = OfflineDatabase::open_in_memory().unwrap();
    let a = PresentationProject::starter_project();
    let mut b = PresentationProject::blank_project("deck-b", "B", "tech-dark-1");
    db.save_project(&a).unwrap();
    db.save_project(&b).unwrap();
    b.name = "B2".into();
    db.save_project(&b).unwrap();
    assert_eq!(db.list_project_rows().unwrap().len(), 2);
    assert!(db.delete_project("deck-b").unwrap());
    assert!(db.load_project("deck-b").unwrap().is_none());
    assert!(db.undo("deck-b").unwrap().is_none(), "history must go with the deck");
    assert_eq!(db.list_project_rows().unwrap().len(), 1);
}

#[test]
fn undo_history_is_bounded() {
    let db = OfflineDatabase::open_in_memory().unwrap();
    let mut p = PresentationProject::blank_project("bounded", "Bounded", "tech-dark-1");
    for i in 0..260 {
        p.name = format!("v{}", i);
        db.save_project(&p).unwrap();
    }
    let mut undos = 0;
    while db.undo("bounded").unwrap().is_some() {
        undos += 1;
    }
    assert!(undos < 210 && undos >= 190, "expected ~200 retained snapshots, got {}", undos);
}

#[test]
fn bundle_roundtrip_preserves_new_model() {
    let p = PresentationProject::starter_project();
    let bytes = export_offline_bundle_to_bytes(&p).unwrap();
    let back = import_offline_bundle_from_bytes(&bytes).unwrap();
    assert_eq!(back, p);
    assert!(import_offline_bundle_from_bytes(b"not a zip").is_err());
}

/* ---------- offline HTML player ---------- */

#[test]
fn standalone_html_is_self_contained() {
    let mut p = PresentationProject::starter_project();
    p.name = "Q3 </script> <b>Review</b>".into();
    let html = build_standalone_html(&p, &generate_100_themes());
    assert!(!html.contains("src=\"/js/"), "scripts must be inlined");
    assert!(!html.contains("href=\"/app.css\""), "stylesheet must be inlined");
    assert!(!html.contains("url(/fonts/"), "fonts must be inlined");
    assert!(html.contains("data:font/woff2;base64,"));
    assert!(html.contains("window.__EMBED__ = "));
    assert!(html.contains("<title>Q3 &lt;/script&gt; &lt;b&gt;Review&lt;/b&gt;</title>"));
    // The deck name inside the embedded JSON cannot close the script tag early.
    let embed_start = html.find("window.__EMBED__").unwrap();
    let embed_end = html[embed_start..].find("</script>").unwrap() + embed_start;
    assert!(html[embed_start..embed_end].contains("Q3 <\\/script>"));
    for name in ["P.present", "P.openOutline", "P.initPresenterWindow", "zoomPath"] {
        assert!(html.contains(name), "player is missing {}", name);
    }
}

/* ---------- HTTP API ---------- */

#[tokio::test]
async fn serves_shell_and_every_referenced_asset() {
    let app = build_router(test_state(PresentationProject::starter_project()));
    let (status, body) = send(&app, "GET", "/", None).await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body).unwrap();
    let mut refs = vec!["/app.css".to_string()];
    for part in html.split("src=\"").skip(1) {
        refs.push(part.split('"').next().unwrap().to_string());
    }
    assert!(refs.len() >= 7);
    for r in refs {
        let (s, b) = send(&app, "GET", &r, None).await;
        assert_eq!(s, StatusCode::OK, "{} should be served", r);
        assert!(!b.is_empty());
    }
    for font in ["Geist.woff2", "GeistMono.woff2", "GeistSerif.woff2"] {
        let (s, b) = send(&app, "GET", &format!("/fonts/{}", font), None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(&b[..4], b"wOF2");
    }
    assert_eq!(send(&app, "GET", "/js/nope.js", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&app, "GET", "/fonts/../Cargo.toml", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn deck_lifecycle_over_http() {
    let app = build_router(test_state(PresentationProject::starter_project()));

    // Create a blank deck: it becomes active.
    let (s, b) = send(&app, "POST", "/api/projects", Some(r#"{"template":"blank","name":"Pitch","theme_id":"nordic-frost-3"}"#.into())).await;
    assert_eq!(s, StatusCode::OK);
    let created: PresentationProject = serde_json::from_slice(&b).unwrap();
    assert_eq!(created.name, "Pitch");
    assert_eq!(created.theme_id, "nordic-frost-3");
    let (_, b) = send(&app, "GET", "/api/project", None).await;
    let active: PresentationProject = serde_json::from_slice(&b).unwrap();
    assert_eq!(active.id, created.id);

    // Save an edit.
    let mut edited = active.clone();
    edited.name = "Pitch v2".into();
    let (s, _) = send(&app, "PUT", "/api/project", Some(serde_json::to_string(&edited).unwrap())).await;
    assert_eq!(s, StatusCode::OK);

    // List shows both decks, the new one active.
    let (_, b) = send(&app, "GET", "/api/projects", None).await;
    let list: serde_json::Value = serde_json::from_slice(&b).unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let mine = arr.iter().find(|d| d["id"] == created.id.as_str()).unwrap();
    assert_eq!(mine["name"], "Pitch v2");
    assert_eq!(mine["active"], true);
