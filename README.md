# Prezi-RS (`ppt`)

An offline-first, Prezi-like zooming presentation engine and interactive Web Canvas studio built in **Rust** with high-performance `matrix3d` camera zooming, parabolic easing transitions, hierarchical scene graphs, a 100-theme procedural palette engine, and offline SQLite + `.prezi-rs` ZIP bundle persistence.

## Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   UI & Theme Layer                     │
│         (Toolbar, 100 Theme Palettes, Path Bar)        │
├────────────────────────────────────────────────────────┤
│                     Camera Engine                      │
│      (Pan, Zoom, Smooth Easing Curves, Fit-to-Frame)   │
├────────────────────────────────────────────────────────┤
│                 Hierarchical Scene Graph               │
│     (Topics, Subtopics, Text, Vectors, Media Nodes)    │
├────────────────────────────────────────────────────────┤
│            Offline Storage & Serialization             │
│               (SQLite + .prezi-rs ZIP)                 │
└────────────────────────────────────────────────────────┘
```

## Core Modules

- [`src/scene.rs`](src/scene.rs) — Normalized world-space scene graph (`CanvasPoint`, `Camera`, `FrameNode`, `ContentBlock`, `SlidePathStep`, `PresentationProject`), hierarchical parent-child topic/subtopic traversal, hit-testing, and a 50-frame spiral benchmark generator (`generate_50_frame_showcase`).
- [`src/camera.rs`](src/camera.rs) — `calculate_target_camera`, `interpolate_camera` (`EaseInOutCubic`), `interpolate_camera_parabolic` (non-linear zoom-out trajectory for long-distance transitions), world/screen coordinate transforms, and GPU `matrix3d` generation.
- [`src/theme.rs`](src/theme.rs) — `ThemePalette`, `ThemeCategory`, and `generate_100_themes()` generating 100 procedural HSL color palettes across 8 visual categories.
- [`src/storage.rs`](src/storage.rs) — `.prezi-rs` / `.zpz` offline deflated ZIP archive exporter/importer (`export_offline_bundle`, `import_offline_bundle`) with `manifest.json`, `project.json`, and `assets/`, plus `OfflineDatabase` (embedded SQLite via `rusqlite`) with deterministic Undo/Redo snapshot history.
- [`src/server.rs`](src/server.rs) — Local studio server (`axum`): deck CRUD (`/api/projects`), autosave, `.prezi-rs` import/export, and `export-html`, which inlines the CSS, fonts and scripts into one offline player file.
- [`src/ui/`](src/ui) — The studio front end, plain scripts with no build step:
  - `engine.js`: camera (van Wijk–Nuij optimal zoom flights), rendering, themes, undo and autosave
  - `editor.js`: tools, selection, inspector, path rail, minimap, ⌘K palette and shortcuts
  - `outline.js`: **Build from outline** (⌘O). Turns an indented outline into a zooming deck in four layouts: Orbit, Journey, Board and Deep dive.
  - `present.js`: present mode (reveals, overview with O, laser L, blackout B, jump by number, swipe/pinch) and a **presenter window** (P) with notes, timer and Now/Next previews
  - `boot.js`: startup, offline-backup recovery, and the embedded player

## Quick Start

```bash
# Run engine diagnostics & summary
cargo run

# Run the full test suite
cargo test

# Launch the interactive Zooming Canvas Studio at http://127.0.0.1:4321
cargo run -- serve 127.0.0.1:4321

# Generate a 50-frame benchmark archive (.prezi-rs) and inspect it
cargo run -- demo-50 showcase-50.prezi-rs
cargo run -- inspect showcase-50.prezi-rs
```
