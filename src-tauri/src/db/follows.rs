use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowEntry {
    pub platform: String,
    pub handle: String,
    pub did: Option<String>,
    pub mastodon_id: Option<String>,
    pub instance_url: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
}

pub fn cache_follows(conn: &Connection, owner_account_id: i64, follows: &[FollowEntry]) -> Result<()> {
    // One transaction, because a refresh is a replacement. The delete and the
    // inserts used to be separate statements, so a row the platform sent that
    // SQLite would not take — a duplicate, a value too long — left the cache
    // holding whatever part of the refresh had landed, with the previous
    // contents already gone. Identity detection reads this table, so a
    // half-written cache means suggestions silently stop appearing.
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "DELETE FROM follows_cache WHERE owner_account_id = ?1",
        params![owner_account_id],
    )?;

    {
        let mut stmt = tx.prepare(
            "INSERT INTO follows_cache
                (owner_account_id, platform, handle, did, mastodon_id,
                 instance_url, display_name, avatar_url, bio)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        )?;

        for f in follows {
            stmt.execute(params![
                owner_account_id,
                f.platform,
                f.handle,
                f.did,
                f.mastodon_id,
                f.instance_url,
                f.display_name,
                f.avatar_url,
                f.bio,
            ])?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn get_cached(conn: &Connection, owner_account_id: i64) -> Result<Vec<FollowEntry>> {
    let mut stmt = conn.prepare(
        "SELECT platform, handle, did, mastodon_id, instance_url,
                display_name, avatar_url, bio
         FROM follows_cache WHERE owner_account_id = ?1 ORDER BY handle"
    )?;
    let rows = stmt.query_map(params![owner_account_id], |row| {
        Ok(FollowEntry {
            platform: row.get(0)?,
            handle: row.get(1)?,
            did: row.get(2)?,
            mastodon_id: row.get(3)?,
            instance_url: row.get(4)?,
            display_name: row.get(5)?,
            avatar_url: row.get(6)?,
            bio: row.get(7)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    /// The follows cache is what identity detection reads. Refreshing it
    /// deletes the old rows and inserts new ones, and those were two separate
    /// statements — so a failure partway left the cache emptied and the new
    /// data incomplete. A refresh should replace the cache or leave it alone.

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
        )
        .unwrap();
        conn.execute_batch(include_str!("../../migrations/001_initial.sql")).unwrap();
        conn.execute("INSERT INTO _migrations (id, name) VALUES (1, '001_initial')", []).unwrap();
        apply_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO accounts (id, platform, handle, credentials_enc) VALUES (1, 'bluesky', 'me.bsky.social', 'enc')",
            [],
        )
        .unwrap();
        conn
    }

    fn follow(platform: &str, handle: &str) -> FollowEntry {
        FollowEntry {
            platform: platform.to_string(),
            handle: handle.to_string(),
            did: None,
            mastodon_id: None,
            instance_url: None,
            display_name: Some(handle.to_string()),
            avatar_url: None,
            bio: None,
        }
    }

    #[test]
    fn caching_then_reading_round_trips() {
        let conn = test_db();
        cache_follows(&conn, 1, &[follow("bluesky", "a.test"), follow("mastodon", "@b@x.social")]).unwrap();

        let cached = get_cached(&conn, 1).unwrap();
        assert_eq!(cached.len(), 2);
    }

    #[test]
    fn a_threads_follow_can_be_cached() {
        // follows_cache has no platform CHECK, unlike accounts and
        // identity_links — worth a test so it stays that way.
        let conn = test_db();
        cache_follows(&conn, 1, &[follow("threads", "someone.threads")]).unwrap();
        assert_eq!(get_cached(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn refreshing_replaces_rather_than_appends() {
        let conn = test_db();
        cache_follows(&conn, 1, &[follow("bluesky", "old.test")]).unwrap();
        cache_follows(&conn, 1, &[follow("bluesky", "new.test")]).unwrap();

        let cached = get_cached(&conn, 1).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].handle, "new.test");
    }

    #[test]
    fn a_failed_refresh_leaves_the_previous_cache_intact() {
        // The one this exists for. Two entries with the same platform and
        // handle violate UNIQUE on the second insert. Before the transaction,
        // the delete had already run and the first insert had landed, so the
        // cache ended up holding one row of a refresh that failed — with the
        // previous contents gone.
        let conn = test_db();
        cache_follows(&conn, 1, &[follow("bluesky", "known.test")]).unwrap();

        let result = cache_follows(
            &conn,
            1,
            &[follow("bluesky", "dupe.test"), follow("bluesky", "dupe.test")],
        );
        assert!(result.is_err(), "a duplicate should fail the refresh");

        let cached = get_cached(&conn, 1).unwrap();
        assert_eq!(cached.len(), 1, "the old cache should survive a failed refresh");
        assert_eq!(cached[0].handle, "known.test");
    }

    #[test]
    fn one_accounts_cache_does_not_disturb_anothers() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO accounts (id, platform, handle, credentials_enc) VALUES (2, 'mastodon', '@me@x.social', 'enc')",
            [],
        )
        .unwrap();
        cache_follows(&conn, 1, &[follow("bluesky", "a.test")]).unwrap();
        cache_follows(&conn, 2, &[follow("mastodon", "@b@x.social")]).unwrap();

        assert_eq!(get_cached(&conn, 1).unwrap().len(), 1);
        assert_eq!(get_cached(&conn, 2).unwrap().len(), 1);
    }

    #[test]
    fn an_empty_refresh_clears_the_cache() {
        // Following nobody is a legitimate answer, not a reason to keep stale
        // rows that identity detection would then match against.
        let conn = test_db();
        cache_follows(&conn, 1, &[follow("bluesky", "a.test")]).unwrap();
        cache_follows(&conn, 1, &[]).unwrap();

        assert!(get_cached(&conn, 1).unwrap().is_empty());
    }

    #[test]
    fn reading_an_account_with_nothing_cached_is_empty_not_an_error() {
        assert!(get_cached(&test_db(), 99).unwrap().is_empty());
    }
}
