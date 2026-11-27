use crate::scene::PresentationProject;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleManifest {
    pub format_version: String,
    pub engine: String,
    pub project_id: String,
    pub project_name: String,
    pub frame_count: usize,
    pub path_step_count: usize,
    pub assets: Vec<String>,
}

const MAX_UNDO_SNAPSHOTS: i64 = 200;

pub const DEFAULT_SVG_ASSET: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <rect x="8" y="8" width="224" height="104" rx="14" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="6 4"/>
  <circle cx="65" cy="60" r="26" fill="#38bdf8" fill-opacity="0.2" stroke="#38bdf8" stroke-width="2"/>
  <circle cx="175" cy="60" r="26" fill="#a855f7" fill-opacity="0.2" stroke="#a855f7" stroke-width="2"/>
  <path d="M 91 60 Q 120 25 149 60" fill="none" stroke="#f8fafc" stroke-width="2.5"/>
</svg>"##;

/// Exports `project` to a `.prezi-rs` / `.zpz` offline zip archive at `output_path`.
/// Contains `manifest.json`, `project.json`, and `assets/` so the presentation operates 100% offline.
pub fn export_offline_bundle(
    project: &PresentationProject,
    output_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let default_assets = [("assets/diagram.svg", DEFAULT_SVG_ASSET)];
    export_offline_bundle_with_assets(project, &default_assets, output_path)
}

/// Exports `project` and custom embedded `assets` into a deflated `.prezi-rs` / `.zpz` archive.
pub fn export_offline_bundle_with_assets(
    project: &PresentationProject,
    assets: &[(&str, &[u8])],
    output_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::create(output_path)?;
    write_bundle_to_writer(project, assets, file)
}

/// Exports `project` into an in-memory `.prezi-rs` / `.zpz` byte buffer (used for HTTP download and tests).
pub fn export_offline_bundle_to_bytes(
    project: &PresentationProject,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut cursor = Cursor::new(Vec::new());
    let default_assets = [("assets/diagram.svg", DEFAULT_SVG_ASSET)];
    write_bundle_to_writer(project, &default_assets, &mut cursor)?;
    Ok(cursor.into_inner())
}

fn write_bundle_to_writer<W: Write + Seek>(
    project: &PresentationProject,
    assets: &[(&str, &[u8])],
    writer: W,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut zip = ZipWriter::new(writer);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let asset_paths: Vec<String> = assets.iter().map(|(k, _)| (*k).to_string()).collect();
    let manifest = BundleManifest {
        format_version: "1.0.0".into(),
        engine: "prezi-rs/0.1.0".into(),
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        frame_count: project.frames.len(),
        path_step_count: project.presentation_path.len(),
        assets: asset_paths,
    };

    zip.start_file("manifest.json", options)?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    zip.write_all(&manifest_bytes)?;

    zip.start_file("project.json", options)?;
    let json_data = serde_json::to_vec_pretty(project)?;
    zip.write_all(&json_data)?;

    for (asset_path, bytes) in assets {
        let normalized = if asset_path.starts_with("assets/") {
            (*asset_path).to_string()
        } else {
            format!("assets/{}", asset_path)
        };
        zip.start_file(normalized, options)?;
        zip.write_all(bytes)?;
    }

    zip.finish()?;
    Ok(())
}

/// Imports a `PresentationProject` from a `.prezi-rs` or `.zpz` file on disk.
pub fn import_offline_bundle(
    input_path: &str,
) -> Result<PresentationProject, Box<dyn std::error::Error>> {
    let file = File::open(input_path)?;
    read_bundle_from_reader(file)
}

/// Imports a `PresentationProject` from an in-memory `.prezi-rs` / `.zpz` archive byte slice.
pub fn import_offline_bundle_from_bytes(
    bytes: &[u8],
) -> Result<PresentationProject, Box<dyn std::error::Error>> {
    let cursor = Cursor::new(bytes);
    read_bundle_from_reader(cursor)
}

fn read_bundle_from_reader<R: Read + Seek>(
    reader: R,
) -> Result<PresentationProject, Box<dyn std::error::Error>> {
    let mut archive = ZipArchive::new(reader)?;
    let mut project_file = archive.by_name("project.json")?;
    let mut contents = Vec::new();
    project_file.read_to_end(&mut contents)?;
    let project: PresentationProject = serde_json::from_slice(&contents)?;
    Ok(project)
}

/// Embedded SQLite storage engine providing offline project persistence, auto-saved drafts,
/// and deterministic Undo/Redo snapshot history.
pub struct OfflineDatabase {
    conn: Connection,
}

impl OfflineDatabase {
    pub fn open(db_path: &str) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(db_path)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, rusqlite::Error> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), rusqlite::Error> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                json_payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS undo_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                json_payload TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS undo_cursor (
                project_id TEXT PRIMARY KEY,
                current_step INTEGER NOT NULL
            );
            ",
        )
    }

    /// Saves or updates a project in SQLite and records an undo snapshot if changed.
    pub fn save_project(&self, project: &PresentationProject) -> Result<(), Box<dyn std::error::Error>> {
        let json_payload = serde_json::to_string(project)?;
        self.conn.execute(
            "INSERT INTO projects (id, name, json_payload, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                json_payload = excluded.json_payload,
                updated_at = excluded.updated_at",
            params![project.id, project.name, json_payload],
        )?;
        self.record_snapshot(project)?;
        Ok(())
    }

    /// Loads a project by ID from SQLite.
    pub fn load_project(
        &self,
        project_id: &str,
    ) -> Result<Option<PresentationProject>, Box<dyn std::error::Error>> {
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT json_payload FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?;

        match payload {
            Some(json) => Ok(Some(serde_json::from_str(&json)?)),
            None => Ok(None),
        }
    }

    /// Lists all saved `(id, name)` pairs in the local database.
    pub fn list_projects(&self) -> Result<Vec<(String, String)>, rusqlite::Error> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name FROM projects ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// Pushes a new undo/redo snapshot for `project`, truncating any forward redo branch.
    pub fn record_snapshot(
        &self,
        project: &PresentationProject,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        let payload = serde_json::to_string(project)?;
        let current_step: Option<i64> = self
            .conn
            .query_row(
                "SELECT current_step FROM undo_cursor WHERE project_id = ?1",
                params![project.id],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(step) = current_step {
            let existing: Option<String> = self
                .conn
                .query_row(
                    "SELECT json_payload FROM undo_history WHERE project_id = ?1 AND step_index = ?2",
                    params![project.id, step],
                    |row| row.get(0),
                )
                .optional()?;
            if existing.as_deref() == Some(payload.as_str()) {
                return Ok(step as usize);
            }
            // Truncate any redo steps after `step`
            self.conn.execute(
                "DELETE FROM undo_history WHERE project_id = ?1 AND step_index > ?2",
                params![project.id, step],
            )?;
        }

        let next_step = current_step.map(|s| s + 1).unwrap_or(0);
        self.conn.execute(
            "INSERT INTO undo_history (project_id, step_index, json_payload) VALUES (?1, ?2, ?3)",
            params![project.id, next_step, payload],
        )?;
        self.conn.execute(
            "INSERT INTO undo_cursor (project_id, current_step) VALUES (?1, ?2)
             ON CONFLICT(project_id) DO UPDATE SET current_step = excluded.current_step",
            params![project.id, next_step],
        )?;

        Ok(next_step as usize)
    }

    /// Steps backward in the undo stack for `project_id` and updates the active project row.
    pub fn undo(
        &self,
        project_id: &str,
    ) -> Result<Option<PresentationProject>, Box<dyn std::error::Error>> {
        let current_step: Option<i64> = self
            .conn
            .query_row(
                "SELECT current_step FROM undo_cursor WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?;

        let Some(step) = current_step else {
            return Ok(None);
        };
        if step <= 0 {
            return Ok(None);
        }

        let prev_step = step - 1;
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT json_payload FROM undo_history WHERE project_id = ?1 AND step_index = ?2",
                params![project_id, prev_step],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(json) = payload {
            let project: PresentationProject = serde_json::from_str(&json)?;
            self.conn.execute(
                "UPDATE undo_cursor SET current_step = ?2 WHERE project_id = ?1",
                params![project_id, prev_step],
            )?;
            self.conn.execute(
                "UPDATE projects SET name = ?2, json_payload = ?3, updated_at = strftime('%s','now') WHERE id = ?1",
                params![project.id, project.name, json],
            )?;
            Ok(Some(project))
        } else {
            Ok(None)
        }
    }

    /// Steps forward in the redo stack for `project_id` and updates the active project row.
    pub fn redo(
        &self,
        project_id: &str,
    ) -> Result<Option<PresentationProject>, Box<dyn std::error::Error>> {
        let current_step: Option<i64> = self
            .conn
            .query_row(
                "SELECT current_step FROM undo_cursor WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?;

        let Some(step) = current_step else {
            return Ok(None);
        };

        let next_step = step + 1;
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT json_payload FROM undo_history WHERE project_id = ?1 AND step_index = ?2",
                params![project_id, next_step],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(json) = payload {
            let project: PresentationProject = serde_json::from_str(&json)?;
            self.conn.execute(
                "UPDATE undo_cursor SET current_step = ?2 WHERE project_id = ?1",
                params![project_id, next_step],
            )?;
            self.conn.execute(
                "UPDATE projects SET name = ?2, json_payload = ?3, updated_at = strftime('%s','now') WHERE id = ?1",
                params![project.id, project.name, json],
            )?;
            Ok(Some(project))
        } else {
            Ok(None)
        }
    }
}
