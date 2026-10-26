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
    pub scheduled_at: Option<String>,
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
    scheduled_at: Option<&str>,
    id: Option<i64>,
) -> Result<i64> {
    if let Some(id) = id {
        let changed = conn.execute(
            "UPDATE draft_posts SET text=?1, target_accounts=?2, media_paths=?3, visibility=?4,
             content_warning=?5, scheduled_at=?6, updated_at=datetime('now') WHERE id=?7",
            params![text, target_accounts, media_paths, visibility, content_warning, scheduled_at, id],
        )?;
        anyhow::ensure!(changed == 1, "Draft no longer exists");
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO draft_posts (text, target_accounts, media_paths, visibility, content_warning, scheduled_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![text, target_accounts, media_paths, visibility, content_warning, scheduled_at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list(conn: &Connection) -> Result<Vec<Draft>> {
    let mut stmt = conn.prepare(
        "SELECT id, text, target_accounts, media_paths, visibility, content_warning,
                is_sent, created_at, updated_at, scheduled_at
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
            scheduled_at: row.get(9)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM draft_posts WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/001_initial.sql")).unwrap();
        conn.execute_batch("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO _migrations VALUES (1, '001_initial');").unwrap();
        crate::db::apply_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn scheduled_time_survives_save_list_and_update() {
        let conn = database();
        let id = save(&conn, "first", "[1,2]", "[\"draft-payload\"]", "private", Some("CW"), Some("2026-12-01T12:00:00Z"), None).unwrap();
        let saved = list(&conn).unwrap().remove(0);
        assert_eq!(saved.scheduled_at.as_deref(), Some("2026-12-01T12:00:00Z"));
        let updated_id = save(&conn, "updated", "[2]", "[]", "public", None, None, Some(id)).unwrap();
        assert_eq!(updated_id, id);
        let drafts = list(&conn).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].text, "updated");
        assert!(drafts[0].scheduled_at.is_none());
        assert_eq!(drafts[0].created_at, saved.created_at);
    }

    #[test]
    fn updating_a_missing_draft_does_not_create_another() {
        let conn = database();
        assert!(save(&conn, "lost", "[]", "[]", "public", None, None, Some(999)).is_err());
        assert!(list(&conn).unwrap().is_empty());
        crate::db::apply_migrations(&conn).unwrap();
    }
}
