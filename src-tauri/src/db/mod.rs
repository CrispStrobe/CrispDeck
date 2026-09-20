pub mod accounts;
pub mod crossposts;
pub mod drafts;
pub mod follows;
pub mod identities;

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

const MIGRATION_001: &str = include_str!("../../migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("../../migrations/002_threads_platform.sql");

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

    apply_migrations(&conn)?;

    Ok(conn)
}

/// Apply every migration after 001 that has not run yet.
///
/// Split out so tests can build the same schema over an in-memory database:
/// open_and_migrate takes a path, and a migration that is only ever exercised
/// against a real file is a migration nobody checks.
pub fn apply_migrations(conn: &Connection) -> Result<()> {
    for (id, name, sql) in [(2i64, "002_threads_platform", MIGRATION_002)] {
        let done: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if done {
            continue;
        }
        conn.execute_batch(sql)?;
        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (?1, ?2)",
            rusqlite::params![id, name],
        )?;
        log::info!("Applied migration {}", name);
    }
    Ok(())
}
