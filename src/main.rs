use ppt::{
    calculate_target_camera, export_offline_bundle, generate_100_themes, import_offline_bundle,
    interpolate_camera_parabolic, server::run_studio_server, OfflineDatabase, PresentationProject,
};
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let command = args.get(1).map(|s| s.as_str()).unwrap_or("info");

    match command {
        "serve" | "studio" => {
            let addr = args.get(2).map(|s| s.as_str()).unwrap_or("127.0.0.1:4321");
            let db_path = args
                .get(3)
                .map(|s| s.as_str())
                .unwrap_or("prezi_studio.db");
            let bundle_path = args
                .get(4)
                .map(|s| s.as_str())
                .unwrap_or("autosave.prezi-rs");
            run_studio_server(addr, db_path, bundle_path).await?;
        }
        "demo-50" => {
            let output_path = args
                .get(2)
                .map(|s| s.as_str())
                .unwrap_or("showcase-50.prezi-rs");
            let showcase = PresentationProject::generate_50_frame_showcase();
            export_offline_bundle(&showcase, output_path)?;
            println!(
                "Generated 50-frame hierarchical benchmark project '{}' ({} frames, {} path steps) -> {}",
                showcase.name,
                showcase.frames.len(),
                showcase.presentation_path.len(),
                output_path
            );
        }
        "export-starter" => {
            let output_path = args
                .get(2)
                .map(|s| s.as_str())
                .unwrap_or("starter.prezi-rs");
            let starter = PresentationProject::starter_project();
            export_offline_bundle(&starter, output_path)?;
            println!(
                "Exported starter presentation '{}' ({} frames) -> {}",
                starter.name,
                starter.frames.len(),
                output_path
            );
        }
        "inspect" => {
            let input_path = args
                .get(2)
                .ok_or("Usage: ppt inspect <path-to-bundle.prezi-rs>")?;
            let project = import_offline_bundle(input_path)?;
            println!("Project ID   : {}", project.id);
            println!("Project Name : {}", project.name);
            println!("Theme ID     : {}", project.theme_id);
            println!("Total Frames : {}", project.frames.len());
            println!("Path Steps   : {}", project.presentation_path.len());
        }
        "themes" => {
            let themes = generate_100_themes();
            println!("Generated {} procedural themes:", themes.len());
            for (idx, theme) in themes.iter().take(15).enumerate() {
                println!(
                    "  {:02}. [{}] {} ({:?}) -> bg={}, accent={}",
                    idx + 1,
                    theme.id,
                    theme.name,
                    theme.category,
                    theme.background,
                    theme.primary_accent
                );
            }
            println!("  ... and {} more themes.", themes.len().saturating_sub(15));
        }
        _ => {
            let themes = generate_100_themes();
            let showcase = PresentationProject::generate_50_frame_showcase();
            let db = OfflineDatabase::open_in_memory()?;
            db.save_project(&showcase)?;

            let cam_start = calculate_target_camera(&showcase.frames[0], 1920.0, 1080.0, 0.80);
            let cam_end = calculate_target_camera(&showcase.frames[1], 1920.0, 1080.0, 0.80);
            let cam_mid = interpolate_camera_parabolic(&cam_start, &cam_end, 0.5);

            println!("==============================================================");
            println!(" Prezi-RS • Offline Zooming Presentation Engine (Rust Core)");
            println!("==============================================================");
            println!(" • 100-Theme Procedural Engine : {} themes ready", themes.len());
            println!(
                " • Hierarchical Scene Graph    : {} benchmark frames verified",
                showcase.frames.len()
            );
            println!(
                " • Parabolic Camera Engine     : zoom {:.2} -> mid {:.2} -> target {:.2}",
                cam_start.zoom, cam_mid.zoom, cam_end.zoom
            );
            println!(
                " • SQLite + ZIP Persistence    : {} project cached in-memory",
                db.list_projects()?.len()
            );
            println!("--------------------------------------------------------------");
            println!("Available commands:");
            println!("  cargo run -- serve [addr]         Launch interactive Canvas Studio");
            println!("  cargo run -- demo-50 [file]       Export 50-frame benchmark (.prezi-rs)");
            println!("  cargo run -- export-starter [file] Export starter presentation bundle");
            println!("  cargo run -- inspect <file>       Inspect a .prezi-rs / .zpz archive");
            println!("  cargo run -- themes               List procedural 100-theme palettes");
        }
    }

    Ok(())
}
