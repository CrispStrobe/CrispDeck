use crate::auth::secret_store;
use crate::db::{accounts, crossposts, drafts, follows, identities};
use crate::AppState;
use serde::Deserialize;
use tauri::State;

// ── Accounts ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_accounts(state: State<'_, AppState>) -> Result<Vec<accounts::Account>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    accounts::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_add_account(
    state: State<'_, AppState>,
    platform: String,
    handle: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
    did: Option<String>,
    mastodon_id: Option<String>,
    instance_url: Option<String>,
    credentials: String,
    is_primary: Option<bool>,
) -> Result<accounts::Account, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    add_account_impl(
        &conn,
        &secret_store::OsSecretStore,
        &platform,
        &handle,
        display_name.as_deref(),
        avatar_url.as_deref(),
        did.as_deref(),
        mastodon_id.as_deref(),
        instance_url.as_deref(),
        &credentials,
        is_primary.unwrap_or(false),
    )
}

/// The part of `db_add_account` that does not need a Tauri app: where the
/// secret goes, and what ends up in the column.
#[allow(clippy::too_many_arguments)]
fn add_account_impl(
    conn: &rusqlite::Connection,
    secrets: &dyn secret_store::SecretStore,
    platform: &str,
    handle: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    did: Option<&str>,
    mastodon_id: Option<&str>,
    instance_url: Option<&str>,
    credentials: &str,
    is_primary: bool,
) -> Result<accounts::Account, String> {
    // Checked before anything is written. The keychain key is derived from
    // platform and handle, so a second account on the same handle overwrites
    // the first one's secret — and then, when the insert is refused, cleaning
    // up after the failure would delete the secret the first account is still
    // using. Refusing here keeps both problems from arising, and says what
    // happened better than a UNIQUE constraint message does.
    let already_connected: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM accounts WHERE platform = ?1 AND handle = ?2",
            rusqlite::params![platform, handle],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if already_connected > 0 {
        return Err(format!("{handle} is already connected."));
    }

    // Put the secret in the OS store when the user wants that and the
    // platform has one; otherwise the local encrypted blob. `stored` is what
    // goes in the column either way — a reference or the blob itself.
    let preferred = preferred_backend(conn);
    let (stored, used) =
        secret_store::store(preferred, secrets, platform, handle, credentials)
            .map_err(|e| e.to_string())?;
    if preferred == secret_store::Backend::Keychain && used == secret_store::Backend::Local {
        log::warn!("no OS secret store available; {handle} was saved with the local blob");
    }

    let account = accounts::insert(
        conn,
        platform,
        handle,
        display_name,
        avatar_url,
        did,
        mastodon_id,
        instance_url,
        &stored,
        is_primary,
    );

    // The secret is written before the row, so a rejected insert used to
    // leave a secret in the keychain with no account pointing at it. Safe to
    // do unconditionally now: the duplicate-handle case, the one where the
    // key belongs to somebody else, was turned away above.
    if account.is_err() {
        if let Err(e) = secret_store::forget(secrets, &stored) {
            log::warn!("could not remove the secret for the account that failed to save: {e}");
        }
    }

    account.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_account(
    state: State<'_, AppState>,
    id: i64,
    display_name: Option<String>,
    avatar_url: Option<String>,
    is_primary: Option<bool>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    accounts::update(
        &conn,
        id,
        display_name.as_deref(),
        avatar_url.as_deref(),
        is_primary,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_account(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_account_impl(&conn, &secret_store::OsSecretStore, id)
}

fn delete_account_impl(
    conn: &rusqlite::Connection,
    secrets: &dyn secret_store::SecretStore,
    id: i64,
) -> Result<(), String> {
    // Drop the keychain entry too, or it outlives the account that owned it.
    // Best effort: failing to tidy up must not block removing the account.
    if let Ok(column) = accounts::get_credentials_enc(conn, id) {
        if let Err(e) = secret_store::forget(secrets, &column) {
            log::warn!("could not remove the stored secret for account {id}: {e}");
        }
    }
    accounts::delete(conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_credentials(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    get_credentials_impl(&conn, &secret_store::OsSecretStore, id)
}

fn get_credentials_impl(
    conn: &rusqlite::Connection,
    secrets: &dyn secret_store::SecretStore,
    id: i64,
) -> Result<String, String> {
    let column = accounts::get_credentials_enc(conn, id).map_err(|e| e.to_string())?;
    // Dispatches on what is in the column, not on the current preference, so
    // rows written by either backend keep working after a switch.
    secret_store::load(secrets, &column).map_err(|e| e.to_string())
}

/// The backend the user asked for, defaulting to the OS store where there is
/// one to default to.
fn preferred_backend(conn: &rusqlite::Connection) -> secret_store::Backend {
    let default = if secret_store::os_store_compiled_in() { "keychain" } else { "local" };
    secret_store::Backend::parse(&crate::db::get_setting(conn, CREDENTIAL_BACKEND_KEY, default))
}

const CREDENTIAL_BACKEND_KEY: &str = "credential_backend";
/// Which macOS keychain: "login", "data-protection", or a path to one the
/// user manages. Ignored on other platforms.
const MAC_KEYCHAIN_KEY: &str = "macos_keychain";

/// What the settings screen needs: which backend is in use, whether this build
/// has an OS store to offer at all, and on macOS which keychain.
#[tauri::command]
pub fn credential_backend_get(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(backend_info(&conn))
}

fn backend_info(conn: &rusqlite::Connection) -> serde_json::Value {
    serde_json::json!({
        "backend": preferred_backend(conn).as_str(),
        "osStoreAvailable": secret_store::os_store_compiled_in(),
        "macosKeychain": crate::db::get_setting(conn, MAC_KEYCHAIN_KEY, "login"),
        // The data protection keychain needs a keychain-access-groups
        // entitlement, so an unsigned build cannot use it. CI proved that:
        // "A required entitlement isn't present." Offering it there would be
        // offering a switch that silently falls back to the weaker store.
        "macosKeychainChoices": mac_keychain_choices(),
    })
}

/// Which macOS keychains this build can actually use.
fn mac_keychain_choices() -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        // data-protection is listed; whether it works depends on signing, and
        // store() reports the backend it really used so the UI can say so.
        vec!["login", "data-protection", "path"]
    } else {
        vec![]
    }
}

/// Choose which macOS keychain new credentials go to.
///
/// Accepts "login", "data-protection", or a path. Existing accounts stay
/// where they are — load() dispatches on what wrote each row.
#[tauri::command]
pub fn macos_keychain_set(state: State<'_, AppState>, keychain: String) -> Result<(), String> {
    // Checked here rather than at the next account save. A mistyped path was
    // stored happily and only surfaced later, as a keychain error on a save
    // the user had no reason to connect to a setting they changed earlier.
    validate_mac_keychain(&keychain)?;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::db::set_setting(&conn, MAC_KEYCHAIN_KEY, &keychain).map_err(|e| e.to_string())?;
    }
    secret_store::set_mac_keychain_choice(&keychain);
    Ok(())
}

/// "login", "data-protection", or a keychain that is actually there.
///
/// A path is accepted with or without the `-db` suffix, because that is how
/// `security` treats it and so how the user will have typed it.
fn validate_mac_keychain(choice: &str) -> Result<(), String> {
    match choice {
        "login" | "data-protection" => return Ok(()),
        "" => return Err("Choose a keychain.".into()),
        _ => {}
    }
    if !choice.contains('/') {
        return Err(format!(
            "{choice:?} is not a keychain. Use \"login\", \"data-protection\", \
             or the full path to a keychain you created."
        ));
    }
    let path = std::path::Path::new(choice);
    if path.exists() || std::path::Path::new(&format!("{choice}-db")).exists() {
        Ok(())
    } else {
        Err(format!(
            "There is no keychain at {choice}. Create it first — \
             `security create-keychain <path>` — then point CrispDeck at it."
        ))
    }
}

/// Choose where new credentials are written.
///
/// Existing accounts are left where they are: re-homing them would mean
/// decrypting every secret and writing it somewhere else, which is a thing to
/// do deliberately rather than as a side effect of flicking a switch.
#[tauri::command]
pub fn credential_backend_set(state: State<'_, AppState>, backend: String) -> Result<(), String> {
    let parsed = secret_store::Backend::parse(&backend);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, parsed.as_str()).map_err(|e| e.to_string())
}

// ── Identities ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_identities(
    state: State<'_, AppState>,
    filter: Option<identities::IdentityFilter>,
) -> Result<Vec<identities::Identity>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::list(&conn, filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_create_identity(
    state: State<'_, AppState>,
    display_name: Option<String>,
    notes: Option<String>,
) -> Result<identities::Identity, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::create(&conn, display_name.as_deref(), notes.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_identity(
    state: State<'_, AppState>,
    id: i64,
    display_name: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::update(&conn, id, display_name.as_deref(), notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_identity(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_link_to_identity(
    state: State<'_, AppState>,
    identity_id: i64,
    platform: String,
    handle: String,
    did: Option<String>,
    mastodon_id: Option<String>,
    instance_url: Option<String>,
    display_name: Option<String>,
    avatar_url: Option<String>,
    bio: Option<String>,
    account_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::link(
        &conn,
        identity_id,
        account_id,
        &platform,
        &handle,
        did.as_deref(),
        mastodon_id.as_deref(),
        instance_url.as_deref(),
        display_name.as_deref(),
        avatar_url.as_deref(),
        bio.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_unlink_from_identity(state: State<'_, AppState>, link_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::unlink(&conn, link_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_confirm_identity(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::confirm(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_resolve_handle(
    state: State<'_, AppState>,
    handle: String,
    target_platform: String,
) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::resolve_handle(&conn, &handle, &target_platform).map_err(|e| e.to_string())
}

// ── Tags ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_add_tag(
    state: State<'_, AppState>,
    identity_id: i64,
    tag: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::add_tag(&conn, identity_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_remove_tag(
    state: State<'_, AppState>,
    identity_id: i64,
    tag: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    identities::remove_tag(&conn, identity_id, &tag).map_err(|e| e.to_string())
}

// ── Crosspost history ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LogCrosspostParams {
    pub draft_id: Option<i64>,
    pub bluesky_uri: Option<String>,
    pub bluesky_cid: Option<String>,
    pub mastodon_uri: Option<String>,
    pub mastodon_id: Option<String>,
    pub text_preview: Option<String>,
    pub media_count: Option<i64>,
    pub status: String,
}

#[tauri::command]
pub fn db_log_crosspost(
    state: State<'_, AppState>,
    draft_id: Option<i64>,
    bluesky_uri: Option<String>,
    bluesky_cid: Option<String>,
    mastodon_uri: Option<String>,
    mastodon_id: Option<String>,
    text_preview: Option<String>,
    media_count: Option<i64>,
    status: String,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crossposts::log_crosspost(
        &conn,
        draft_id,
        bluesky_uri.as_deref(),
        bluesky_cid.as_deref(),
        mastodon_uri.as_deref(),
        mastodon_id.as_deref(),
        text_preview.as_deref(),
        media_count.unwrap_or(0),
        &status,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_list_crossposts(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<crossposts::CrosspostEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crossposts::list(&conn, limit.unwrap_or(50), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

// ── Drafts ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_save_draft(
    state: State<'_, AppState>,
    text: String,
    target_accounts: Vec<i64>,
    media_paths: Option<Vec<String>>,
    visibility: Option<String>,
    content_warning: Option<String>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ta_json = serde_json::to_string(&target_accounts).map_err(|e| e.to_string())?;
    let mp_json =
        serde_json::to_string(&media_paths.unwrap_or_default()).map_err(|e| e.to_string())?;
    drafts::save(
        &conn,
        &text,
        &ta_json,
        &mp_json,
        &visibility.unwrap_or_else(|| "public".to_string()),
        content_warning.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_list_drafts(state: State<'_, AppState>) -> Result<Vec<drafts::Draft>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    drafts::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_draft(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    drafts::delete(&conn, id).map_err(|e| e.to_string())
}

// ── Follows cache ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_cache_follows(
    state: State<'_, AppState>,
    owner_account_id: i64,
    follows_list: Vec<follows::FollowEntry>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    follows::cache_follows(&conn, owner_account_id, &follows_list).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_cached_follows(
    state: State<'_, AppState>,
    owner_account_id: i64,
) -> Result<Vec<follows::FollowEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    follows::get_cached(&conn, owner_account_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secret_store::{Backend, SecretStore};
    use crate::db::apply_migrations;
    use rusqlite::Connection;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// A secret store that keeps everything in a map, so the dispatch above it
    /// can be exercised without touching the developer's real keychain.
    #[derive(Default)]
    struct FakeStore {
        entries: RefCell<HashMap<String, String>>,
        fail_writes: bool,
    }

    impl FakeStore {
        fn len(&self) -> usize {
            self.entries.borrow().len()
        }
    }

    impl SecretStore for FakeStore {
        fn set(&self, key: &str, secret: &str) -> anyhow::Result<()> {
            if self.fail_writes {
                anyhow::bail!("no secret store here");
            }
            self.entries.borrow_mut().insert(key.into(), secret.into());
            Ok(())
        }
        fn get(&self, key: &str) -> anyhow::Result<String> {
            self.entries
                .borrow()
                .get(key)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("not found"))
        }
        fn delete(&self, key: &str) -> anyhow::Result<()> {
            self.entries.borrow_mut().remove(key);
            Ok(())
        }
    }

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

    fn add(
        conn: &Connection,
        store: &FakeStore,
        handle: &str,
        creds: &str,
    ) -> Result<accounts::Account, String> {
        add_account_impl(
            conn, store, "mastodon", handle,
            Some("Name"), None, None, None, Some("https://x.social"),
            creds, false,
        )
    }

    #[test]
    fn a_keychain_account_stores_a_reference_not_the_secret() {
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let store = FakeStore::default();

        let account = add(&conn, &store, "@me@x.social", "the-token").unwrap();

        let column = accounts::get_credentials_enc(&conn, account.id).unwrap();
        assert!(
            secret_store::is_keychain_ref(&column),
            "the column should hold a reference, not the secret: {column}"
        );
        assert!(!column.contains("the-token"), "the secret leaked into the database");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn a_local_account_keeps_the_secret_out_of_the_keychain() {
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "local").unwrap();
        let store = FakeStore::default();

        let account = add(&conn, &store, "@me@x.social", "the-token").unwrap();

        assert_eq!(store.len(), 0, "nothing should have gone to the OS store");
        let column = accounts::get_credentials_enc(&conn, account.id).unwrap();
        assert!(!secret_store::is_keychain_ref(&column));
        assert!(!column.contains("the-token"), "the blob is not encrypted");
    }

    #[test]
    fn a_secret_store_that_will_not_write_falls_back_rather_than_losing_the_account() {
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let store = FakeStore { fail_writes: true, ..Default::default() };

        let account = add(&conn, &store, "@me@x.social", "the-token").unwrap();

        let column = accounts::get_credentials_enc(&conn, account.id).unwrap();
        assert!(!secret_store::is_keychain_ref(&column), "should have fallen back to the blob");
        assert_eq!(get_credentials_impl(&conn, &store, account.id).unwrap(), "the-token");
    }

    #[test]
    fn credentials_come_back_whichever_backend_wrote_them() {
        // The point of dispatching on the column: switching the preference
        // must not orphan the accounts that are already connected.
        let conn = test_db();
        let store = FakeStore::default();

        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let in_keychain = add(&conn, &store, "@a@x.social", "token-a").unwrap();

        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "local").unwrap();
        let in_blob = add(&conn, &store, "@b@x.social", "token-b").unwrap();

        assert_eq!(get_credentials_impl(&conn, &store, in_keychain.id).unwrap(), "token-a");
        assert_eq!(get_credentials_impl(&conn, &store, in_blob.id).unwrap(), "token-b");
    }

    #[test]
    fn an_account_that_fails_to_save_leaves_no_secret_behind() {
        // The secret is written before the row, keyed on platform and handle.
        // A second account on the same handle is refused by the table — but
        // the secret written for it had already overwritten the first
        // account's, under the same key. So the refusal has to come before
        // anything is stored, not after.
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let store = FakeStore::default();

        add(&conn, &store, "@me@x.social", "first").unwrap();
        assert_eq!(store.len(), 1);

        let second = add_account_impl(
            &conn, &store, "mastodon", "@me@x.social",
            None, None, None, None, None, "second", false,
        );
        let err = second.unwrap_err();
        assert!(err.contains("already connected"), "unexpected message: {err}");
        assert_eq!(store.len(), 1, "the refused save disturbed the keychain");

        // And the first account is untouched by the attempt.
        let first_id = accounts::list(&conn).unwrap()[0].id;
        assert_eq!(get_credentials_impl(&conn, &store, first_id).unwrap(), "first");
    }

    #[test]
    fn deleting_an_account_takes_its_keychain_entry_with_it() {
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let store = FakeStore::default();
        let account = add(&conn, &store, "@me@x.social", "the-token").unwrap();
        assert_eq!(store.len(), 1);

        delete_account_impl(&conn, &store, account.id).unwrap();

        assert_eq!(store.len(), 0, "the secret outlived the account that owned it");
        assert!(accounts::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn deleting_an_account_whose_secret_is_already_gone_still_removes_it() {
        // Tidying up is best effort; it must not be what blocks a removal.
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        let store = FakeStore::default();
        let account = add(&conn, &store, "@me@x.social", "the-token").unwrap();
        store.entries.borrow_mut().clear();

        delete_account_impl(&conn, &store, account.id).unwrap();
        assert!(accounts::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn the_preferred_backend_defaults_to_whatever_this_build_can_offer() {
        let conn = test_db();
        let expected = if secret_store::os_store_compiled_in() {
            Backend::Keychain
        } else {
            Backend::Local
        };
        assert_eq!(preferred_backend(&conn), expected);
    }

    #[test]
    fn a_stored_preference_wins_over_the_default() {
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "local").unwrap();
        assert_eq!(preferred_backend(&conn), Backend::Local);
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "keychain").unwrap();
        assert_eq!(preferred_backend(&conn), Backend::Keychain);
    }

    #[test]
    fn a_setting_left_over_from_somewhere_else_reads_as_local() {
        // Backend::parse falls back rather than panicking, and falling back to
        // the store that always works is the safe direction.
        let conn = test_db();
        crate::db::set_setting(&conn, CREDENTIAL_BACKEND_KEY, "nonsense").unwrap();
        assert_eq!(preferred_backend(&conn), Backend::Local);
    }

    #[test]
    fn the_settings_screen_is_told_what_this_build_can_do() {
        let conn = test_db();
        let info = backend_info(&conn);

        assert!(info["backend"].is_string());
        assert_eq!(info["osStoreAvailable"], secret_store::os_store_compiled_in());
        assert_eq!(info["macosKeychain"], "login");
        // The choices offered have to match the platform, or the settings
        // screen shows a keychain picker on Linux.
        let choices = info["macosKeychainChoices"].as_array().unwrap();
        assert_eq!(choices.is_empty(), !cfg!(target_os = "macos"));
    }

    #[test]
    fn the_named_keychains_are_accepted() {
        assert!(validate_mac_keychain("login").is_ok());
        assert!(validate_mac_keychain("data-protection").is_ok());
    }

    #[test]
    fn a_keychain_that_is_not_there_is_refused_now_rather_than_at_the_next_save() {
        // What made this worth adding: the path was stored as typed, and the
        // failure showed up later as a keychain error during an account save,
        // with nothing to connect it to the setting.
        let err = validate_mac_keychain("/tmp/definitely-no-keychain-here.keychain").unwrap_err();
        assert!(err.contains("no keychain at"), "unexpected message: {err}");
        assert!(err.contains("create-keychain"), "should say how to fix it: {err}");
    }

    #[test]
    fn a_bare_word_is_not_mistaken_for_a_path() {
        let err = validate_mac_keychain("mykeychain").unwrap_err();
        assert!(err.contains("full path"), "unexpected message: {err}");
        assert!(validate_mac_keychain("").is_err());
    }

    #[test]
    fn a_keychain_that_exists_is_accepted_with_or_without_the_db_suffix() {
        // `security` resolves "foo.keychain" to "foo.keychain-db", so the user
        // will type it either way.
        let dir = std::env::temp_dir().join(format!("crispdeck-kc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let with_suffix = dir.join("mine.keychain-db");
        std::fs::write(&with_suffix, b"not really a keychain").unwrap();

        assert!(validate_mac_keychain(with_suffix.to_str().unwrap()).is_ok());
        assert!(validate_mac_keychain(dir.join("mine.keychain").to_str().unwrap()).is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }
}
