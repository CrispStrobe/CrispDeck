use crate::auth::mastodon_oauth;

#[tauri::command]
pub async fn auth_start_mastodon_oauth(
    instance_url: String,
) -> Result<mastodon_oauth::OAuthStartResult, String> {
    mastodon_oauth::start_oauth(&instance_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_complete_mastodon_oauth(
    instance_url: String,
    code: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
) -> Result<mastodon_oauth::TokenResult, String> {
    mastodon_oauth::complete_oauth(&instance_url, &code, &client_id, &client_secret, &redirect_uri)
        .await
        .map_err(|e| e.to_string())
}

/// Wait for the OAuth callback on the localhost redirect server.
/// This should be called after opening the auth URL in the browser.
#[tauri::command]
pub async fn auth_wait_for_callback(redirect_uri: String) -> Result<String, String> {
    // Run the blocking listener in a spawned blocking task
    tokio::task::spawn_blocking(move || mastodon_oauth::wait_for_oauth_callback(&redirect_uri))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
