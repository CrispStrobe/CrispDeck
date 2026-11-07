pub mod accounts;
pub mod crossposts;
pub mod drafts;
pub mod follows;
pub mod identities;

use anyhow::{bail, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

const MIGRATION_001: &str = include_str!("../../migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("../../migrations/002_threads_platform.sql");
const MIGRATION_003: &str = include_str!("../../migrations/003_app_settings.sql");
const MIGRATION_004: &str = include_str!("../../migrations/004_threads_identity_links.sql");

const MIGRATION_005: &str = include_str!("../../migrations/005_draft_schedule.sql");
const MIGRATION_006: &str = include_str!("../../migrations/006_identity_link_indexes.sql");

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "001_initial", MIGRATION_001),
    (2, "002_threads_platform", MIGRATION_002),
    (3, "003_app_settings", MIGRATION_003),
    (4, "004_threads_identity_links", MIGRATION_004),
    (5, "005_draft_schedule", MIGRATION_005),
    (6, "006_identity_link_indexes", MIGRATION_006),
];

pub fn open_and_migrate(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    apply_migrations(&conn)?;

    // Apply the stored macOS keychain choice for the rest of this process, so
    // the first credential written goes where the user asked rather than to
    // the default. A no-op on the other platforms.
    crate::auth::secret_store::set_mac_keychain_choice(&get_setting(&conn, "macos_keychain", "login"));

    Ok(conn)
}

/// Apply pending migrations and their version records in one transaction.
///
/// Table rebuilds must temporarily disable foreign-key enforcement before
/// starting the transaction. Dropping `accounts` with enforcement enabled
/// cascades into `follows_cache` and nulls `identity_links.account_id`, even
/// though the rebuilt accounts table contains the same rows. Validate the
/// references before committing, and restore enforcement on every exit path.
pub fn apply_migrations(conn: &Connection) -> Result<()> {
    apply_migration_set(conn, MIGRATIONS)
}

fn apply_migration_set(conn: &Connection, migrations: &[(i64, &str, &str)]) -> Result<()> {
    if !conn.is_autocommit() {
        bail!("database migrations cannot run inside another transaction");
    }
    let foreign_keys: bool = conn.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", false)?;

    let result = (|| -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        for &(id, name, sql) in migrations {
            let done: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM _migrations WHERE id = ?1)",
                [id],
                |row| row.get(0),
            )?;
            if done {
                continue;
            }
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO _migrations (id, name) VALUES (?1, ?2)",
                rusqlite::params![id, name],
            )?;
        }

        let invalid_table: Option<String> = tx
            .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
            .optional()?;
        if let Some(table) = invalid_table {
            bail!("database migration left an invalid foreign key in {table}");
        }
        tx.commit()?;
        Ok(())
    })();

    // The transaction guard has committed or rolled back before this runs.
    // SQLite ignores changes to foreign_keys while a transaction is active.
    let restored = conn.pragma_update(None, "foreign_keys", foreign_keys);
    result?;
    restored?;
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

    fn foreign_keys_enabled(conn: &Connection) -> bool {
        conn.pragma_query_value(None, "foreign_keys", |row| row.get(0)).unwrap()
    }

    #[test]
    fn fresh_database_and_version_records_are_created_together() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0)).unwrap();
        assert_eq!(count as usize, MIGRATIONS.len());
        assert!(!foreign_keys_enabled(&conn), "preserve the caller's original setting");
        set_setting(&conn, "created", "yes").unwrap();
    }

    #[test]
    fn rebuilding_accounts_preserves_cached_follows_and_identity_links() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        apply_migration_set(&conn, &MIGRATIONS[..1]).unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (id, platform, handle) VALUES (7, 'bluesky', 'owner.test');
             INSERT INTO identities (id, display_name) VALUES (4, 'Owner');
             INSERT INTO identity_links (identity_id, account_id, platform, handle)
                 VALUES (4, 7, 'bluesky', 'owner.test');
             INSERT INTO follows_cache (owner_account_id, platform, handle)
                 VALUES (7, 'bluesky', 'friend.test');",
        ).unwrap();

        apply_migrations(&conn).unwrap();

        let account_id: Option<i64> = conn.query_row(
            "SELECT account_id FROM identity_links WHERE identity_id = 4", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(account_id, Some(7), "DROP TABLE must not run ON DELETE SET NULL");
        let follows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM follows_cache WHERE owner_account_id = 7", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(follows, 1, "DROP TABLE must not cascade-delete cached follows");
        assert!(foreign_keys_enabled(&conn));

        // Enforcement is back on after migration, so real account deletion
        // must still execute the application's declared cascade behavior.
        conn.execute("DELETE FROM accounts WHERE id = 7", []).unwrap();
        let follows: i64 = conn.query_row("SELECT COUNT(*) FROM follows_cache", [], |row| row.get(0)).unwrap();
        assert_eq!(follows, 0);
    }

    #[test]
    fn interrupted_migration_rolls_back_schema_data_and_version_records() {
        let conn = db();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        set_setting(&conn, "keep", "original").unwrap();
        let result = apply_migration_set(&conn, &[
            (7, "test_first", "UPDATE app_settings SET value = 'changed' WHERE key = 'keep';"),
            (8, "test_interrupted", "CREATE TABLE interrupted (value TEXT); INSERT INTO missing_table VALUES (1);"),
        ]);
        assert!(result.is_err());
        assert_eq!(get_setting(&conn, "keep", ""), "original");
        let table_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'interrupted'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(table_count, 0);
        let version_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM _migrations WHERE id IN (7, 8)", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(version_count, 0);
        assert!(foreign_keys_enabled(&conn), "failed upgrades must restore enforcement too");
        assert!(conn.is_autocommit());
    }

    #[test]
    fn invalid_references_roll_back_instead_of_being_committed() {
        let conn = db();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        let result = apply_migration_set(&conn, &[(7, "test_invalid_reference",
            "INSERT INTO follows_cache (owner_account_id, platform, handle) VALUES (999, 'bluesky', 'orphan.test');")]);
        assert!(result.unwrap_err().to_string().contains("invalid foreign key"));
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM follows_cache", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        assert!(foreign_keys_enabled(&conn));
    }

    #[test]
    fn migration_inside_another_transaction_is_rejected_without_mutation() {
        let conn = db();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        assert!(apply_migrations(&conn).unwrap_err().to_string().contains("another transaction"));
        assert!(foreign_keys_enabled(&conn));
        tx.rollback().unwrap();
    }

    #[test]
    fn rebuilt_identity_table_has_its_lookup_indexes() {
        let conn = db();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN
             ('idx_identity_links_identity', 'idx_identity_links_platform_handle')", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }
}
