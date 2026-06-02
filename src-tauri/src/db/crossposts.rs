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
         FROM crosspost_history ORDER BY posted_at DESC LIMIT ?1 OFFSET ?2"
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
    })?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}
