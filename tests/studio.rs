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
