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
const MIGRATION_003: &str = include_str!("../../migrations/003_app_settings.sql");
const MIGRATION_004: &str = include_str!("../../migrations/004_threads_identity_links.sql");

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

    // Apply the stored macOS keychain choice for the rest of this process, so
    // the first credential written goes where the user asked rather than to
    // the default. A no-op on the other platforms.
    crate::auth::secret_store::set_mac_keychain_choice(&get_setting(&conn, "macos_keychain", "login"));

    Ok(conn)
}

/// Apply every migration after 001 that has not run yet.
///
/// Split out so tests can build the same schema over an in-memory database:
/// open_and_migrate takes a path, and a migration that is only ever exercised
/// against a real file is a migration nobody checks.
pub fn apply_migrations(conn: &Connection) -> Result<()> {
    for (id, name, sql) in [
        (2i64, "002_threads_platform", MIGRATION_002),
        (3i64, "003_app_settings", MIGRATION_003),
        (4i64, "004_threads_identity_links", MIGRATION_004),
    ] {
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

/// Read an app setting, or the default when it has never been written.
pub fn get_setting(conn: &Connection, key: &str, default: &str) -> String {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

/// Write an app setting.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
        )
        .unwrap();
        conn.execute_batch(MIGRATION_001).unwrap();
        conn.execute("INSERT INTO _migrations (id, name) VALUES (1, '001_initial')", []).unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn a_setting_round_trips() {
        let conn = db();
        set_setting(&conn, "credential_backend", "keychain").unwrap();
        assert_eq!(get_setting(&conn, "credential_backend", "local"), "keychain");
    }

    #[test]
    fn an_unset_key_gives_the_default() {
        // Not an error: a fresh install has written nothing yet.
        assert_eq!(get_setting(&db(), "never-written", "local"), "local");
    }

    #[test]
    fn writing_twice_updates_rather_than_failing_on_the_primary_key() {
        let conn = db();
        set_setting(&conn, "k", "one").unwrap();
        set_setting(&conn, "k", "two").unwrap();
        assert_eq!(get_setting(&conn, "k", ""), "two");
    }

    #[test]
    fn migrations_are_idempotent() {
        // apply_migrations runs on every open; a second pass must not fail or
        // re-run 002's table rebuild.
        let conn = db();
        set_setting(&conn, "k", "survives").unwrap();
        apply_migrations(&conn).unwrap();
        assert_eq!(get_setting(&conn, "k", ""), "survives");
    }
}
