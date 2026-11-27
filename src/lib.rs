pub mod camera;
pub mod scene;
pub mod server;
pub mod storage;
pub mod theme;

pub use camera::{
    calculate_target_camera, ease_in_out_cubic, interpolate_camera, interpolate_camera_parabolic,
};
pub use scene::{
    Camera, CanvasElement, CanvasPoint, ContentBlock, ElementKind, FrameNode, FrameStyle,
    PresentationProject, SlidePathStep, TransitionKind,
};
pub use storage::{
    export_offline_bundle, export_offline_bundle_to_bytes, export_offline_bundle_with_assets,
    import_offline_bundle, import_offline_bundle_from_bytes, BundleManifest, OfflineDatabase,
};
pub use theme::{find_theme_by_id, generate_100_themes, ThemeCategory, ThemePalette};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_100_theme_procedural_generator() {
        let themes = generate_100_themes();
        assert_eq!(themes.len(), 100, "Must generate exactly 100 themes");

        let mut unique_ids = std::collections::HashSet::new();
        for theme in &themes {
            assert!(
                unique_ids.insert(theme.id.clone()),
                "Duplicate theme id: {}",
                theme.id
            );
            assert!(theme.background.starts_with("hsl("));
            assert!(theme.canvas_grid.starts_with("hsla("));
            assert!(theme.surface.starts_with("hsl("));
            assert!(theme.primary_accent.starts_with("hsl("));
            assert!(theme.secondary_accent.starts_with("hsl("));
            assert!(theme.frame_border.starts_with("hsla("));
            assert!(!theme.font_family.is_empty());
            assert!(theme.to_css_variables().contains("--primary-accent:"));
        }

        assert!(find_theme_by_id("tech-dark-1").is_some());
        assert!(find_theme_by_id("vapor-midnight-20").is_some());
    }

    #[test]
    fn test_camera_calculation_and_easing_interpolation() {
        let frame = FrameNode {
            id: "frame-1".into(),
            title: "Main Topic".into(),
            position: CanvasPoint { x: 100.0, y: 200.0 },
            width: 800.0,
            height: 400.0,
            rotation: 0.2,
            children_ids: vec![],
            content_blocks: vec![],
        };

        let target = calculate_target_camera(&frame, 1600.0, 900.0, 0.8);
        assert!((target.center.x - 500.0).abs() < 1e-4);
        assert!((target.center.y - 400.0).abs() < 1e-4);
        assert!((target.zoom - 1.6).abs() < 1e-4);
        assert!((target.rotation - 0.2).abs() < 1e-4);

        let origin = Camera {
            center: CanvasPoint { x: 0.0, y: 0.0 },
            zoom: 1.0,
            rotation: 0.0,
        };

        let start = interpolate_camera(&origin, &target, 0.0);
        assert_eq!(start, origin);

        let mid = interpolate_camera(&origin, &target, 0.5);
        assert!((mid.center.x - 250.0).abs() < 1e-4);
        assert!((mid.center.y - 200.0).abs() < 1e-4);
        assert!((mid.zoom - 1.3).abs() < 1e-4);

        let end = interpolate_camera(&origin, &target, 1.0);
        assert!((end.center.x - target.center.x).abs() < 1e-4);
        assert!((end.zoom - target.zoom).abs() < 1e-4);

        // Parabolic transition between distant frames must zoom out at the midpoint
        let far_target = Camera {
            center: CanvasPoint {
                x: 4000.0,
                y: 3000.0,
            },
            zoom: 1.0,
            rotation: 0.0,
        };
        let parabolic_mid = interpolate_camera_parabolic(&origin, &far_target, 0.5);
        assert!(
            parabolic_mid.zoom < 1.0,
            "Parabolic camera must zoom out during long-distance transition, got {}",
            parabolic_mid.zoom
        );
    }

    #[test]
    fn test_world_screen_coordinate_roundtrip_and_matrix3d() {
        let mut cam = Camera {
            center: CanvasPoint::new(320.0, -180.0),
            zoom: 1.75,
            rotation: 0.35,
        };
        let world_pt = CanvasPoint::new(450.0, -90.0);
        let screen_pt = cam.world_to_screen(world_pt, 1920.0, 1080.0);
        let recovered = cam.screen_to_world(screen_pt, 1920.0, 1080.0);

        assert!((recovered.x - world_pt.x).abs() < 1e-2);
        assert!((recovered.y - world_pt.y).abs() < 1e-2);

        let cursor = CanvasPoint::new(640.0, 360.0);
        let world_under_cursor_before = cam.screen_to_world(cursor, 1920.0, 1080.0);
        cam.zoom_at_screen_point(1.5, cursor, 1920.0, 1080.0);
        let world_under_cursor_after = cam.screen_to_world(cursor, 1920.0, 1080.0);
        assert!((world_under_cursor_before.x - world_under_cursor_after.x).abs() < 1e-2);
        assert!((world_under_cursor_before.y - world_under_cursor_after.y).abs() < 1e-2);

        let css = cam.to_css_matrix3d(1920.0, 1080.0);
        assert!(css.starts_with("matrix3d("));
    }

    #[test]
    fn test_50_frame_hierarchical_scene_graph() {
        let showcase = PresentationProject::generate_50_frame_showcase();
        assert_eq!(showcase.frames.len(), 50);
        assert_eq!(showcase.presentation_path.len(), 50);

        let traversal = showcase.hierarchical_traversal();
        assert_eq!(traversal.len(), 50);
        assert_eq!(traversal[0].id, "frame-001");

        // Hit-test the central hub at (0, 0)
        let hit = showcase.hit_test(CanvasPoint::new(0.0, 0.0));
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().id, "frame-001");
    }

    #[test]
    fn test_offline_zip_bundle_export_and_import() {
        let project = PresentationProject::starter_project();
        let tmp_path = std::env::temp_dir().join("test_export.prezi-rs");
        let tmp_str = tmp_path.to_str().unwrap();

        export_offline_bundle(&project, tmp_str).expect("Bundle export should succeed");
        let loaded = import_offline_bundle(tmp_str).expect("Bundle import should succeed");
        let _ = std::fs::remove_file(&tmp_path);

        assert_eq!(loaded, project);
    }

    #[test]
    fn test_sqlite_persistence_and_undo_redo_stack() {
        let db = OfflineDatabase::open_in_memory().expect("In-memory SQLite should initialize");
        let mut project = PresentationProject::starter_project();

        db.save_project(&project).expect("Initial save should succeed");
        let initial_frame_count = project.frames.len();

        // Add a new frame and save
        project.add_frame(
            FrameNode {
                id: "frame-extra".into(),
                title: "Extra Node".into(),
                position: CanvasPoint::new(500.0, 500.0),
                width: 400.0,
                height: 300.0,
                rotation: 0.0,
                children_ids: vec![],
                content_blocks: vec![],
            },
            true,
            900,
        );
        db.save_project(&project).expect("Second save should succeed");

        let loaded = db.load_project(&project.id).unwrap().unwrap();
        assert_eq!(loaded.frames.len(), initial_frame_count + 1);

        // Undo back to initial state
        let undone = db.undo(&project.id).unwrap().unwrap();
        assert_eq!(undone.frames.len(), initial_frame_count);

        // Redo forward to modified state
        let redone = db.redo(&project.id).unwrap().unwrap();
        assert_eq!(redone.frames.len(), initial_frame_count + 1);
    }
}
