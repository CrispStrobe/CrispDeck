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

    // Put the secret in the OS store when the user wants that and the
    // platform has one; otherwise the local encrypted blob. `stored` is what
    // goes in the column either way — a reference or the blob itself.
    let preferred = preferred_backend(&conn);
    let (stored, used) = secret_store::store(
        preferred,
        &secret_store::OsSecretStore,
        &platform,
        &handle,
        &credentials,
    )
    .map_err(|e| e.to_string())?;
    if preferred == secret_store::Backend::Keychain && used == secret_store::Backend::Local {
        log::warn!("no OS secret store available; {handle} was saved with the local blob");
    }

    accounts::insert(
        &conn,
        &platform,
        &handle,
        display_name.as_deref(),
        avatar_url.as_deref(),
        did.as_deref(),
        mastodon_id.as_deref(),
        instance_url.as_deref(),
        &stored,
        is_primary.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
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
    // Drop the keychain entry too, or it outlives the account that owned it.
    // Best effort: failing to tidy up must not block removing the account.
    if let Ok(column) = accounts::get_credentials_enc(&conn, id) {
        if let Err(e) = secret_store::forget(&secret_store::OsSecretStore, &column) {
            log::warn!("could not remove the stored secret for account {id}: {e}");
        }
    }
    accounts::delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_credentials(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let column = accounts::get_credentials_enc(&conn, id).map_err(|e| e.to_string())?;
    // Dispatches on what is in the column, not on the current preference, so
    // rows written by either backend keep working after a switch.
    secret_store::load(&secret_store::OsSecretStore, &column).map_err(|e| e.to_string())
}

/// The backend the user asked for, defaulting to the OS store where there is
/// one to default to.
fn preferred_backend(conn: &rusqlite::Connection) -> secret_store::Backend {
    let default = if secret_store::os_store_compiled_in() { "keychain" } else { "local" };
    secret_store::Backend::parse(&crate::db::get_setting(conn, CREDENTIAL_BACKEND_KEY, default))
}

const CREDENTIAL_BACKEND_KEY: &str = "credential_backend";

/// What the settings screen needs: which backend is in use, and whether this
/// build has an OS store to offer at all.
#[tauri::command]
pub fn credential_backend_get(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "backend": preferred_backend(&conn).as_str(),
        "osStoreAvailable": secret_store::os_store_compiled_in(),
    }))
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
