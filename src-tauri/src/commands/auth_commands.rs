/// Run an OAuth authorization in a CrispDeck window of its own and return the
/// redirect's query string.
///
/// The window is pointed at `auth_url`. When the authorization server
/// redirects to the exact callback URI (apart from its query and fragment),
/// navigation is cancelled before it loads, its query is handed back, and the
/// window closes. Every other authorization-page navigation must stay HTTPS.
/// The redirect URI (app.vercel.crispdeck:...) is never actually loaded.
///
/// Closing the window counts as cancelling.
#[cfg(desktop)]
#[tauri::command]
pub async fn auth_in_app_window(
    app: tauri::AppHandle,
    auth_url: String,
    redirect_prefix: String,
    timeout_secs: u64,
) -> Result<String, String> {
    use std::sync::{Arc, Mutex};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
    use tokio::sync::oneshot;

    let url: tauri::Url = auth_url.parse().map_err(|e| format!("invalid authorization URL: {e}"))?;
    if !is_secure_authorization_page(&url) {
        return Err("sign-in requires an HTTPS URL without embedded credentials".into());
    }
    let redirect: tauri::Url = redirect_prefix.parse().map_err(|e| format!("invalid redirect URL: {e}"))?;
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = {
        let tx = tx.clone();
        move |outcome: Result<String, String>| {
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(outcome);
            }
        }
    };

    let label = format!(
        "oauth-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );
    let title = sign_in_title(&url);
    let on_redirect = send.clone();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        // No address bar, so the title carries the domain: the user can see
        // whose page is asking for their password. Kept current on every load,
        // since a sign-in can hop hosts (bsky.social -> the user's PDS).
        .title(&title)
        .on_page_load(|window, payload| {
            let _ = window.set_title(&sign_in_title(payload.url()));
        })
        .inner_size(520.0, 720.0)
        .visible(true)
        .focused(true)
        .on_navigation(move |nav| {
            if is_oauth_callback(nav, &redirect) {
                on_redirect(Ok(nav.query().unwrap_or("").to_string()));
                return false;
            }
            // Some webviews create an empty document before loading the
            // requested URL. It contains no remote sign-in form.
            if nav.as_str() == "about:blank" {
                return true;
            }
            if !is_secure_authorization_page(nav) {
                on_redirect(Err("the sign-in page attempted an unsafe navigation; use an HTTPS sign-in service".into()));
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("could not open the sign-in window: {e}"))?;

    let on_close = send.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            on_close(Err("the sign-in window was closed".into()));
        }
    });

    let outcome = match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err("the sign-in window went away".into()),
        Err(_) => Err("timed out waiting for the sign-in to finish".into()),
    };
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
    outcome
}

#[cfg(any(desktop, test))]
fn is_secure_authorization_page(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some() &&
        url.username().is_empty() && url.password().is_none()
}

#[cfg(any(desktop, test))]
fn is_oauth_callback(url: &tauri::Url, redirect: &tauri::Url) -> bool {
    let mut target = url.clone();
    target.set_query(None);
    target.set_fragment(None);
    target == *redirect
}

/// "Sign in — mastodon.social (secure)". The host is the one fact a user
/// needs to judge the page; the scheme is spelled out because there is no
/// padlock to look at.
#[cfg(desktop)]
fn sign_in_title(url: &tauri::Url) -> String {
    let host = url.host_str().unwrap_or("unknown site");
    let security = if url.scheme() == "https" { "secure" } else { "NOT SECURE" };
    format!("Sign in — {host} ({security})")
}

/// Mobile has no secondary windows; the frontend uses the system browser
/// and a deep link.
#[cfg(mobile)]
#[tauri::command]
pub async fn auth_in_app_window(
    auth_url: String,
    redirect_prefix: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let _ = (auth_url, redirect_prefix, timeout_secs);
    Err("in-app sign-in windows are not available on mobile".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_can_hop_between_secure_providers() {
        for value in ["https://bsky.social/oauth/authorize?state=123", "https://pds.example/oauth/login"] {
            assert!(is_secure_authorization_page(&value.parse().unwrap()));
        }
    }

    #[test]
    fn authorization_never_downgrades_or_loads_a_local_document() {
        for value in [
            "http://pds.example/oauth/login",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "https://trusted.example@attacker.example/login",
            "https://user:password@pds.example/login",
        ] {
            assert!(!is_secure_authorization_page(&value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn captures_only_the_exact_registered_custom_callback() {
        for redirect in ["app.vercel.crispdeck:/oauth/callback", "app.vercel.crispdeck://oauth/mastodon"] {
            let expected = redirect.parse().unwrap();
            assert!(is_oauth_callback(&format!("{redirect}?code=abc&state=xyz#ignored").parse().unwrap(), &expected));
            assert!(!is_oauth_callback(&format!("{redirect}/other?code=abc").parse().unwrap(), &expected));
            assert!(!is_oauth_callback(&format!("{redirect}-attacker?code=abc").parse().unwrap(), &expected));
            assert!(!is_oauth_callback(&"https://attacker.example/oauth/callback?code=abc".parse().unwrap(), &expected));
        }
    }
}
