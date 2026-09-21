use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrosspostEntry {
    pub id: i64,
    pub draft_id: Option<i64>,
    pub bluesky_uri: Option<String>,
    pub bluesky_cid: Option<String>,
    pub mastodon_uri: Option<String>,
    pub mastodon_id: Option<String>,
    pub text_preview: Option<String>,
    pub media_count: i64,
    pub posted_at: String,
    pub status: String,
}

pub fn log_crosspost(
    conn: &Connection,
    draft_id: Option<i64>,
    bluesky_uri: Option<&str>,
    bluesky_cid: Option<&str>,
    mastodon_uri: Option<&str>,
    mastodon_id: Option<&str>,
    text_preview: Option<&str>,
    media_count: i64,
    status: &str,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO crosspost_history
            (draft_id, bluesky_uri, bluesky_cid, mastodon_uri, mastodon_id,
             text_preview, media_count, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            draft_id, bluesky_uri, bluesky_cid, mastodon_uri, mastodon_id,
            text_preview, media_count, status,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<CrosspostEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, draft_id, bluesky_uri, bluesky_cid, mastodon_uri, mastodon_id,
                text_preview, media_count, posted_at, status
         FROM crosspost_history ORDER BY posted_at DESC, id DESC LIMIT ?1 OFFSET ?2"
    )?;
    let rows = stmt.query_map(params![limit, offset], |row| {
        Ok(CrosspostEntry {
            id: row.get(0)?,
            draft_id: row.get(1)?,
            bluesky_uri: row.get(2)?,
            bluesky_cid: row.get(3)?,
            mastodon_uri: row.get(4)?,
            mastodon_id: row.get(5)?,
            text_preview: row.get(6)?,
            media_count: row.get(7)?,
            posted_at: row.get(8)?,
            status: row.get(9)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

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
        conn
    }

    fn log_one(conn: &Connection, preview: &str, status: &str) -> i64 {
        log_crosspost(
            conn, None,
            Some("at://did:plc:x/app.bsky.feed.post/1"), Some("bafy1"),
            Some("https://x.social/@me/1"), Some("1"),
            Some(preview), 0, status,
        )
        .unwrap()
    }

    #[test]
    fn a_logged_crosspost_comes_back() {
        let conn = test_db();
        let id = log_one(&conn, "hello", "success");
        assert!(id > 0);

        let rows = list(&conn, 10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].text_preview.as_deref(), Some("hello"));
        assert_eq!(rows[0].status, "success");
    }

    #[test]
    fn a_partial_crosspost_records_which_half_landed() {
        // One platform accepted the post and the other did not. The row has to
        // keep the URI that exists, or the user cannot find what did get sent.
        let conn = test_db();
        log_crosspost(
            &conn, None,
            Some("at://did:plc:x/app.bsky.feed.post/1"), Some("bafy1"),
            None, None,
            Some("half sent"), 2, "partial",
        )
        .unwrap();

        let rows = list(&conn, 10, 0).unwrap();
        assert_eq!(rows[0].status, "partial");
        assert!(rows[0].bluesky_uri.is_some());
        assert!(rows[0].mastodon_uri.is_none());
        assert_eq!(rows[0].media_count, 2);
    }

    #[test]
    fn an_unknown_status_is_refused() {
        // The CHECK is the only thing keeping the history readable — the UI
        // branches on these three values.
        let conn = test_db();
        let result = log_crosspost(&conn, None, None, None, None, None, Some("x"), 0, "maybe");
        assert!(result.is_err());
    }

    #[test]
    fn paging_walks_the_whole_history_without_repeating_a_row() {
        // posted_at defaults to datetime('now'), which has second resolution,
        // so a burst of crossposts all carry the same timestamp. Ordering by
        // that alone leaves ties for SQLite to break however it likes, and
        // LIMIT/OFFSET over an unstable order can show a row twice and skip
        // another. The id tie-break is what makes paging total.
        let conn = test_db();
        for i in 0..5 {
            log_one(&conn, &format!("post {i}"), "success");
        }

        let mut seen = Vec::new();
        for page in 0..3 {
            for row in list(&conn, 2, page * 2).unwrap() {
                seen.push(row.id);
            }
        }
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), 5, "every row should appear exactly once across the pages");
    }

    #[test]
    fn the_newest_crosspost_is_listed_first() {
        let conn = test_db();
        let first = log_one(&conn, "older", "success");
        let second = log_one(&conn, "newer", "success");

        let rows = list(&conn, 10, 0).unwrap();
        assert_eq!(rows[0].id, second);
        assert_eq!(rows[1].id, first);
    }

    #[test]
    fn a_row_that_cannot_be_read_is_reported_rather_than_dropped() {
        // list() collected with filter_map(|r| r.ok()), so a row whose columns
        // did not fit the struct disappeared from the history with nothing
        // logged — the same silent-drop pattern being removed everywhere else.
        // SQLite's typing is per-value, so text in media_count is storable and
        // then fails to come back as i64.
        let conn = test_db();
        log_one(&conn, "fine", "success");
        conn.execute(
            "INSERT INTO crosspost_history (text_preview, media_count, status)
             VALUES ('broken', 'not a number', 'success')",
            [],
        )
        .unwrap();

        let result = list(&conn, 10, 0);
        assert!(result.is_err(), "an unreadable row should surface, not vanish");
    }

    #[test]
    fn deleting_a_draft_keeps_its_crosspost_in_the_history() {
        // ON DELETE SET NULL: the post went out, so the record of it outlives
        // the draft it came from.
        let conn = test_db();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute("INSERT INTO draft_posts (id, text) VALUES (7, 'draft')", []).unwrap();
        log_crosspost(&conn, Some(7), None, None, None, None, Some("sent"), 0, "success").unwrap();

        conn.execute("DELETE FROM draft_posts WHERE id = 7", []).unwrap();

        let rows = list(&conn, 10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].draft_id, None);
    }

    #[test]
    fn an_empty_history_is_an_empty_list() {
        assert!(list(&test_db(), 10, 0).unwrap().is_empty());
    }
}
