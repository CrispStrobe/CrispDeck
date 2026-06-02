pub mod accounts;
pub mod crossposts;
pub mod drafts;
pub mod follows;
pub mod identities;

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

const MIGRATION_001: &str = include_str!("../../migrations/001_initial.sql");

pub fn open_and_migrate(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    // Simple migration tracking
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );"
    )?;

    let applied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE id = 1)",
        [],
        |row| row.get(0),
    )?;

    if !applied {
        conn.execute_batch(MIGRATION_001)?;
        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (1, '001_initial')",
            [],
        )?;
        log::info!("Applied migration 001_initial");
    }

    Ok(conn)
}
