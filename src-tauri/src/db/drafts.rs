use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub id: i64,
    pub text: String,
    pub target_accounts: String, // JSON array
    pub media_paths: String,     // JSON array
    pub visibility: String,
    pub content_warning: Option<String>,
    pub is_sent: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn save(
    conn: &Connection,
    text: &str,
    target_accounts: &str,
    media_paths: &str,
    visibility: &str,
    content_warning: Option<&str>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO draft_posts (text, target_accounts, media_paths, visibility, content_warning)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![text, target_accounts, media_paths, visibility, content_warning],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list(conn: &Connection) -> Result<Vec<Draft>> {
    let mut stmt = conn.prepare(
        "SELECT id, text, target_accounts, media_paths, visibility, content_warning,
                is_sent, created_at, updated_at
         FROM draft_posts WHERE is_sent = 0 ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Draft {
            id: row.get(0)?,
            text: row.get(1)?,
            target_accounts: row.get(2)?,
            media_paths: row.get(3)?,
            visibility: row.get(4)?,
            content_warning: row.get(5)?,
            is_sent: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM draft_posts WHERE id = ?1", params![id])?;
    Ok(())
}
