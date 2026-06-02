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
