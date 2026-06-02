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
    // Clear old cache for this account
    conn.execute(
        "DELETE FROM follows_cache WHERE owner_account_id = ?1",
        params![owner_account_id],
    )?;

    let mut stmt = conn.prepare(
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
    })?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}
