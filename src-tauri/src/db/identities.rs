use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityLink {
    pub id: i64,
    pub identity_id: i64,
    pub account_id: Option<i64>,
    pub platform: String,
    pub handle: String,
    pub did: Option<String>,
    pub mastodon_id: Option<String>,
    pub instance_url: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub id: i64,
    pub display_name: Option<String>,
    pub notes: Option<String>,
    pub auto_detected: bool,
    pub confirmed: bool,
    pub confidence: Option<f64>,
    pub tags: Vec<String>,
    pub links: Vec<IdentityLink>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityFilter {
    pub confirmed_only: Option<bool>,
    pub tag: Option<String>,
}

pub fn list(conn: &Connection, filter: Option<IdentityFilter>) -> Result<Vec<Identity>> {
    let base_query = if let Some(ref f) = filter {
        if let Some(ref tag) = f.tag {
            format!(
                "SELECT i.id, i.display_name, i.notes, i.auto_detected, i.confirmed,
                        i.confidence, i.created_at, i.updated_at
                 FROM identities i
                 JOIN identity_tags t ON t.identity_id = i.id AND t.tag = '{}'
                 {}
                 ORDER BY i.confirmed DESC, i.confidence DESC NULLS LAST, i.display_name",
                tag.replace('\'', "''"),
                if f.confirmed_only.unwrap_or(false) { "WHERE i.confirmed = 1" } else { "" }
            )
        } else if f.confirmed_only.unwrap_or(false) {
            "SELECT id, display_name, notes, auto_detected, confirmed, confidence,
                    created_at, updated_at
             FROM identities WHERE confirmed = 1
             ORDER BY display_name".to_string()
        } else {
            "SELECT id, display_name, notes, auto_detected, confirmed, confidence,
                    created_at, updated_at
             FROM identities
             ORDER BY confirmed DESC, confidence DESC NULLS LAST, display_name".to_string()
        }
    } else {
        "SELECT id, display_name, notes, auto_detected, confirmed, confidence,
                created_at, updated_at
         FROM identities
         ORDER BY confirmed DESC, confidence DESC NULLS LAST, display_name".to_string()
    };

    let mut stmt = conn.prepare(&base_query)?;
    let identity_rows: Vec<(i64, Option<String>, Option<String>, bool, bool, Option<f64>, String, String)> =
        stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(4)? != 0,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })?.filter_map(|r| r.ok()).collect();

    let mut identities = Vec::new();
    for (id, display_name, notes, auto_detected, confirmed, confidence, created_at, updated_at) in identity_rows {
        let tags = get_tags(conn, id)?;
        let links = get_links(conn, id)?;
        identities.push(Identity {
            id, display_name, notes, auto_detected, confirmed, confidence,
            tags, links, created_at, updated_at,
        });
    }
    Ok(identities)
}

pub fn create(conn: &Connection, display_name: Option<&str>, notes: Option<&str>) -> Result<Identity> {
    conn.execute(
        "INSERT INTO identities (display_name, notes) VALUES (?1, ?2)",
        params![display_name, notes],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Identity {
        id,
        display_name: display_name.map(String::from),
        notes: notes.map(String::from),
        auto_detected: false,
        confirmed: false,
        confidence: None,
        tags: vec![],
        links: vec![],
        created_at: String::new(),
        updated_at: String::new(),
    })
}

pub fn create_auto_detected(conn: &Connection, display_name: Option<&str>, confidence: f64) -> Result<i64> {
    conn.execute(
        "INSERT INTO identities (display_name, auto_detected, confidence) VALUES (?1, 1, ?2)",
        params![display_name, confidence],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, display_name: Option<&str>, notes: Option<&str>) -> Result<()> {
    if let Some(dn) = display_name {
        conn.execute(
            "UPDATE identities SET display_name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![dn, id],
        )?;
    }
    if let Some(n) = notes {
        conn.execute(
            "UPDATE identities SET notes = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![n, id],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM identities WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn confirm(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE identities SET confirmed = 1, updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn link(
    conn: &Connection,
    identity_id: i64,
    account_id: Option<i64>,
    platform: &str,
    handle: &str,
    did: Option<&str>,
    mastodon_id: Option<&str>,
    instance_url: Option<&str>,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    bio: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO identity_links
            (identity_id, account_id, platform, handle, did, mastodon_id,
             instance_url, display_name, avatar_url, bio)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            identity_id, account_id, platform, handle, did, mastodon_id,
            instance_url, display_name, avatar_url, bio,
        ],
    )?;
    Ok(())
}

pub fn unlink(conn: &Connection, link_id: i64) -> Result<()> {
    conn.execute("DELETE FROM identity_links WHERE id = ?1", params![link_id])?;
    Ok(())
}

/// Given a handle on one platform, find the linked handle on the target platform.
pub fn resolve_handle(conn: &Connection, handle: &str, target_platform: &str) -> Result<Option<String>> {
    // Find which identity this handle belongs to
    let identity_id: Option<i64> = conn
        .query_row(
            "SELECT identity_id FROM identity_links WHERE handle = ?1",
            params![handle],
            |row| row.get(0),
        )
        .ok();

    let Some(identity_id) = identity_id else {
        return Ok(None);
    };

    // Find the handle on the target platform within that identity
    let resolved: Option<String> = conn
        .query_row(
            "SELECT handle FROM identity_links
             WHERE identity_id = ?1 AND platform = ?2
             LIMIT 1",
            params![identity_id, target_platform],
            |row| row.get(0),
        )
        .ok();

    Ok(resolved)
}

fn get_tags(conn: &Connection, identity_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tag FROM identity_tags WHERE identity_id = ?1 ORDER BY tag")?;
    let tags = stmt.query_map(params![identity_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

fn get_links(conn: &Connection, identity_id: i64) -> Result<Vec<IdentityLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, identity_id, account_id, platform, handle, did, mastodon_id,
                instance_url, display_name, avatar_url, bio, created_at
         FROM identity_links WHERE identity_id = ?1 ORDER BY platform, handle"
    )?;
    let links = stmt.query_map(params![identity_id], |row| {
        Ok(IdentityLink {
            id: row.get(0)?,
            identity_id: row.get(1)?,
            account_id: row.get(2)?,
            platform: row.get(3)?,
            handle: row.get(4)?,
            did: row.get(5)?,
            mastodon_id: row.get(6)?,
            instance_url: row.get(7)?,
            display_name: row.get(8)?,
            avatar_url: row.get(9)?,
            bio: row.get(10)?,
            created_at: row.get(11)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(links)
}

pub fn add_tag(conn: &Connection, identity_id: i64, tag: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO identity_tags (identity_id, tag) VALUES (?1, ?2)",
        params![identity_id, tag],
    )?;
    Ok(())
}

pub fn remove_tag(conn: &Connection, identity_id: i64, tag: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM identity_tags WHERE identity_id = ?1 AND tag = ?2",
        params![identity_id, tag],
    )?;
    Ok(())
}
