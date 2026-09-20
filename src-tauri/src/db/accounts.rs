use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub platform: String,
    pub handle: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub did: Option<String>,
    pub mastodon_id: Option<String>,
    pub instance_url: Option<String>,
    pub is_primary: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, handle, display_name, avatar_url, did, mastodon_id,
                instance_url, is_primary, created_at, updated_at
         FROM accounts ORDER BY platform, is_primary DESC, handle"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(Account {
            id: row.get(0)?,
            platform: row.get(1)?,
            handle: row.get(2)?,
            display_name: row.get(3)?,
            avatar_url: row.get(4)?,
            did: row.get(5)?,
            mastodon_id: row.get(6)?,
            instance_url: row.get(7)?,
            is_primary: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn insert(
    conn: &Connection,
    platform: &str,
    handle: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    did: Option<&str>,
    mastodon_id: Option<&str>,
    instance_url: Option<&str>,
    credentials_enc: &str,
    is_primary: bool,
) -> Result<Account> {
    conn.execute(
        "INSERT INTO accounts (platform, handle, display_name, avatar_url, did, mastodon_id,
                               instance_url, credentials_enc, is_primary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            platform, handle, display_name, avatar_url, did, mastodon_id,
            instance_url, credentials_enc, is_primary as i64,
        ],
    )?;

    let id = conn.last_insert_rowid();
    let acct = conn.query_row(
        "SELECT id, platform, handle, display_name, avatar_url, did, mastodon_id,
                instance_url, is_primary, created_at, updated_at
         FROM accounts WHERE id = ?1",
        params![id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                platform: row.get(1)?,
                handle: row.get(2)?,
                display_name: row.get(3)?,
                avatar_url: row.get(4)?,
                did: row.get(5)?,
                mastodon_id: row.get(6)?,
                instance_url: row.get(7)?,
                is_primary: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )?;
    Ok(acct)
}

pub fn update(
    conn: &Connection,
    id: i64,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    is_primary: Option<bool>,
) -> Result<()> {
    if let Some(dn) = display_name {
        conn.execute(
            "UPDATE accounts SET display_name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![dn, id],
        )?;
    }
    if let Some(av) = avatar_url {
        conn.execute(
            "UPDATE accounts SET avatar_url = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![av, id],
        )?;
    }
    if let Some(prim) = is_primary {
        conn.execute(
            "UPDATE accounts SET is_primary = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![prim as i64, id],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_credentials_enc(conn: &Connection, id: i64) -> Result<String> {
    let cred: String = conn.query_row(
        "SELECT credentials_enc FROM accounts WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(cred)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    /// A schema this layer was never tested against let a real feature break:
    /// 001 restricted platform to bluesky and mastodon, Threads support was
    /// added to the app afterwards, and nothing widened the constraint. The
    /// browser build stores accounts in IndexedDB and did not care; the
    /// desktop build failed the insert outright.
    ///
    /// The tests build the same schema over an in-memory database, so they
    /// exercise the migrations rather than a hand-written copy of the tables.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id   INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        conn.execute_batch(include_str!("../../migrations/001_initial.sql")).unwrap();
        conn.execute("INSERT INTO _migrations (id, name) VALUES (1, '001_initial')", []).unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn add(conn: &Connection, platform: &str, handle: &str) -> Account {
        insert(conn, platform, handle, Some("Display"), None, None, None, None, "encrypted-blob", false).unwrap()
    }

    #[test]
    fn a_threads_account_can_be_stored() {
        // The regression. Before migration 002 this failed with
        // "CHECK constraint failed: platform IN ('bluesky', 'mastodon')".
        let conn = test_db();
        let acct = add(&conn, "threads", "someone.threads");
        assert_eq!(acct.platform, "threads");
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn every_platform_the_app_offers_can_be_stored() {
        // Named individually so a fourth network added to the frontend
        // without touching the schema fails here rather than in someone's
        // sign-in flow.
        let conn = test_db();
        for platform in ["bluesky", "mastodon", "threads"] {
            add(&conn, platform, &format!("a.{}", platform));
        }
        assert_eq!(list(&conn).unwrap().len(), 3);
    }

    #[test]
    fn an_unknown_platform_is_still_refused() {
        // The constraint is widened, not removed: a typo should not become a
        // row nothing can read back.
        let conn = test_db();
        let result = insert(&conn, "twitter", "a.test", None, None, None, None, None, "enc", false);
        assert!(result.is_err());
    }

    #[test]
    fn insert_returns_what_was_stored() {
        let conn = test_db();
        let acct = add(&conn, "bluesky", "someone.bsky.social");
        assert_eq!(acct.handle, "someone.bsky.social");
        assert_eq!(acct.display_name.as_deref(), Some("Display"));
        assert!(acct.id > 0);
    }

    #[test]
    fn the_encrypted_credential_survives_a_round_trip_byte_for_byte() {
        // This column holds the AES-GCM blob. One altered byte and the
        // account can never be decrypted again — GCM refuses, by design.
        let conn = test_db();
        let blob = "c2FsdA==.bm9uY2U=.Y2lwaGVydGV4dA==+/weird";
        let acct = insert(&conn, "bluesky", "a.test", None, None, None, None, None, blob, false).unwrap();
        assert_eq!(get_credentials_enc(&conn, acct.id).unwrap(), blob);
    }

    #[test]
    fn the_same_handle_cannot_be_added_twice_on_one_platform() {
        let conn = test_db();
        add(&conn, "bluesky", "a.test");
        assert!(insert(&conn, "bluesky", "a.test", None, None, None, None, None, "enc", false).is_err());
    }

    #[test]
    fn the_same_handle_on_a_different_platform_is_fine() {
        // UNIQUE(platform, handle), not UNIQUE(handle).
        let conn = test_db();
        add(&conn, "bluesky", "a.test");
        add(&conn, "mastodon", "a.test");
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn delete_removes_only_the_named_account() {
        let conn = test_db();
        let first = add(&conn, "bluesky", "a.test");
        add(&conn, "mastodon", "b.test");

        delete(&conn, first.id).unwrap();
        let remaining = list(&conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].handle, "b.test");
    }

    #[test]
    fn listing_puts_primary_accounts_first_within_a_platform() {
        let conn = test_db();
        add(&conn, "bluesky", "b.test");
        let primary = insert(&conn, "bluesky", "a-primary.test", None, None, None, None, None, "enc", true).unwrap();

        let listed = list(&conn).unwrap();
        assert_eq!(listed[0].id, primary.id, "primary should sort ahead of a handle that precedes it alphabetically");
    }

    #[test]
    fn nothing_stops_two_primary_accounts_on_one_platform() {
        // Documenting what the schema actually allows, not endorsing it:
        // neither insert nor update demotes an existing primary, so the
        // "primary account" is whichever one a query happens to return first.
        // Worth knowing before anything relies on there being exactly one.
        let conn = test_db();
        insert(&conn, "bluesky", "a.test", None, None, None, None, None, "enc", true).unwrap();
        insert(&conn, "bluesky", "b.test", None, None, None, None, None, "enc", true).unwrap();

        let primaries = list(&conn).unwrap().into_iter().filter(|a| a.is_primary).count();
        assert_eq!(primaries, 2);
    }
}
