//! Instagram's own website in a desktop child webview. The official API has
//! no home timeline: this view never reads cookies, injects feed scripts, or
//! passes the user's Instagram session through CrispDeck's API clients.
//!
//! The remote view has no Tauri capability. Only the bundled main webview may
//! manage it, and every navigation stays on an explicit HTTPS host allowlist.

use serde::Deserialize;
use tauri::{Manager, Webview};

const INSTAGRAM_HOME: &str = "https://www.instagram.com/";
const CHILD_LABEL: &str = "instagram-timeline";
const WINDOW_LABEL: &str = "instagram-window";

/// One child view is owned by one frontend mount. Serializing native mutations
/// and checking the owner prevents a late cleanup from closing a newer mount.
#[derive(Default)]
pub struct InstagramWebState {
    #[cfg(desktop)]
    owner: tokio::sync::Mutex<Option<String>>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct InstagramBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl InstagramBounds {
    fn validate(self) -> Result<Self, String> {
        // Bound values before converting to platform pixel coordinates. The
        // final rectangle is also intersected with the actual parent window.
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|value| !value.is_finite() || *value > 32_768.0)
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
        {
            return Err("Invalid Instagram viewport bounds.".into());
        }
        Ok(self)
    }

    /// A resize can reach the native window before the DOM observer reports
    /// its new rectangle. Clip stale geometry instead of covering app chrome
    /// or treating an ordinary resize/minimize as a fatal feed error.
    fn clipped(self, width: f64, height: f64) -> Option<Self> {
        if !width.is_finite() || !height.is_finite() {
            return None;
        }
        let clipped = Self {
            width: self.width.min(width - self.x),
            height: self.height.min(height - self.y),
            ..self
        };
        (clipped.width >= 1.0 && clipped.height >= 1.0).then_some(clipped)
    }

    #[cfg(desktop)]
    fn rect(self) -> tauri::Rect {
        tauri::Rect {
            position: tauri::LogicalPosition::new(self.x, self.y).into(),
            size: tauri::LogicalSize::new(self.width, self.height).into(),
        }
    }
}

fn is_main_caller(webview_label: &str, window_label: &str) -> bool {
    webview_label == "main" && window_label == "main"
}

fn is_app_origin(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let bundled = url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost"))
                | ("http" | "https", Some("tauri.localhost"))
        );
    bundled || dev_url.is_some_and(|dev| url.origin() == dev.origin())
}

fn require_main(caller: &Webview) -> Result<(), String> {
    if !is_main_caller(caller.label(), caller.window().label()) {
        return Err("Only CrispDeck's main view can manage Instagram.".into());
    }
    let url = caller
        .url()
        .map_err(|_| "Could not verify the CrispDeck view.".to_string())?;
    #[cfg(dev)]
    let dev_url = caller.app_handle().config().build.dev_url.as_ref();
    #[cfg(not(dev))]
    let dev_url = None;
    if !is_app_origin(&url, dev_url) {
        return Err("Only the bundled CrispDeck app can manage Instagram.".into());
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 100
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid Instagram view session.".into());
    }
    Ok(())
}

/// These are page-navigation hosts, not a network request filter. Instagram
/// still loads its images/video from its own CDN through normal browser rules.
fn is_service_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some(
                "instagram.com"
                    | "www.instagram.com"
                    | "accountscenter.instagram.com"
                    | "facebook.com"
                    | "www.facebook.com"
                    | "m.facebook.com"
                    | "accountscenter.facebook.com"
            )
        )
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    // Some system webviews create an empty initial document first. It has no
    // native capability, just like every other document in the remote view.
    url.as_str() == "about:blank" || is_service_url(url)
}

#[cfg(desktop)]
fn home_url() -> tauri::Url {
    INSTAGRAM_HOME.parse().expect("fixed Instagram HTTPS URL")
}

#[cfg(desktop)]
fn viewport(
    caller: &Webview,
    bounds: InstagramBounds,
) -> Result<Option<InstagramBounds>, String> {
    let bounds = bounds.validate()?;
    let window = caller.window();
    let scale = window
        .scale_factor()
        .map_err(|_| "Could not measure the Instagram viewport.".to_string())?;
    let size = window
        .inner_size()
        .map_err(|_| "Could not measure the Instagram viewport.".to_string())?
        .to_logical::<f64>(scale);
    Ok(bounds.clipped(size.width, size.height))
}

#[cfg(all(desktop, any(windows, target_os = "linux")))]
fn profile_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate Instagram's browser profile.".to_string())?
        .join("instagram-web");
    crate::app_data::prepare_directory(&directory)
        .map_err(|_| "Could not prepare Instagram's browser profile.".to_string())?;
    Ok(directory)
}

// A stable service profile, shared only by the inline and popout Instagram
// views. Wry uses this separate store on macOS >=14; older macOS versions use
// the app's default, origin-isolated WebKit store. Never clear that shared
// store as a way to sign out: Instagram's own Log out control is the right UI.
#[cfg(all(desktop, target_os = "macos"))]
const INSTAGRAM_DATA_STORE: [u8; 16] = *b"CrispDeck-IG-Web";

#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstagramOrigin {
    session_id: String,
    origin: String,
}

#[cfg(desktop)]
fn emit_origin(app: &tauri::AppHandle, session_id: &str, url: &tauri::Url) {
    use tauri::Emitter;
    if is_service_url(url) {
        // Send only a known HTTPS origin, never a URL path, login code,
        // account ID, cookie, or query string. Scope the event to the main UI.
        let _ = app.emit_to(
            tauri::EventTarget::webview("main"),
            "instagram-web-origin",
            InstagramOrigin {
                session_id: session_id.to_string(),
                origin: url.origin().ascii_serialization(),
            },
        );
    }
}

#[cfg(desktop)]
fn popup_handler(
    app: tauri::AppHandle,
    label: &'static str,
    session_id: Option<String>,
) -> impl Fn(tauri::Url, tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<tauri::Wry>
       + Send
       + 'static {
    move |url, _features| {
        // Never let window.open create an unmanaged browser with different
        // navigation/security rules. Approved links stay in the managed view;
        // unsupported flows can be opened in the user's browser from the UI.
        if let Some(view) = app.get_webview(label).filter(|_| is_service_url(&url)) {
            let app = app.clone();
            let session_id = session_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(session_id) = session_id {
                    let state = app.state::<InstagramWebState>();
                    let owner = state.owner.lock().await;
                    if owner.as_deref() != Some(session_id.as_str()) {
                        return;
                    }
                    // Keep the ownership lock through navigation. A popup
                    // from a previous route mount cannot affect a replacement.
                    let _ = view.navigate(url);
                } else {
                    // Capture the original handle before spawning: looking
                    // up a fixed label later could select a newer window.
                    let _ = view.navigate(url);
                }
            });
        }
        tauri::webview::NewWindowResponse::Deny
    }
}

#[cfg(desktop)]
fn child_builder(
    app: &tauri::AppHandle,
    session_id: String,
) -> Result<tauri::webview::WebviewBuilder<tauri::Wry>, String> {
    let origin_app = app.clone();
    let load_app = app.clone();
    let load_session = session_id.clone();
    let popup_session = session_id.clone();
    let builder = tauri::webview::WebviewBuilder::new(
        CHILD_LABEL,
        tauri::WebviewUrl::External(home_url()),
    )
    .focused(false)
    .on_navigation(move |url| {
        let allowed = allowed_navigation(url);
        if allowed {
            emit_origin(&origin_app, &session_id, url);
        }
        allowed
    })
    .on_page_load(move |_, payload| {
        emit_origin(&load_app, &load_session, payload.url());
    })
    .on_new_window(popup_handler(app.clone(), CHILD_LABEL, Some(popup_session)))
    .on_download(|_, _| false);

    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.data_directory(profile_directory(app)?);
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(INSTAGRAM_DATA_STORE);
    Ok(builder)
}

#[tauri::command]
pub fn instagram_web_supported(webview: Webview) -> bool {
    cfg!(desktop) && is_main_caller(webview.label(), webview.window().label())
}

#[tauri::command]
pub async fn instagram_web_open(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
    session_id: String,
    bounds: InstagramBounds,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_session_id(&session_id)?;
    bounds.validate()?;
    #[cfg(desktop)]
    {
        let mut owner = state.owner.lock().await;
        if let Some(existing) = app.get_webview(CHILD_LABEL) {
            existing
                .hide()
                .map_err(|_| "Could not hide the previous Instagram view.".to_string())?;
            if owner.as_deref() == Some(session_id.as_str()) {
                if let Some(bounds) = viewport(&webview, bounds)? {
                    existing
                        .set_bounds(bounds.rect())
                        .map_err(|_| "Could not resize Instagram.".to_string())?;
                }
                return Ok(());
            }
            existing
                .close()
                .map_err(|_| "Could not close the previous Instagram view.".to_string())?;
            *owner = None;
        }

        let child = webview
            .window()
            .add_child(
                child_builder(&app, session_id.clone())?,
                // WebviewBuilder has no initially-hidden option. Create well
                // outside the window, then hide before assigning real bounds.
                tauri::LogicalPosition::new(-10_000.0, -10_000.0),
                tauri::LogicalSize::new(1.0, 1.0),
            )
            .map_err(|_| "Could not open Instagram in the app. Try the browser instead.".to_string())?;
        let ready = (|| {
            child
                .hide()
                .map_err(|_| "Could not prepare the Instagram view.".to_string())?;
            if let Some(bounds) = viewport(&webview, bounds)? {
                child
                    .set_bounds(bounds.rect())
                    .map_err(|_| "Could not position Instagram.".to_string())?;
            }
            Ok(())
        })();
        if let Err(error) = ready {
            let _ = child.close();
            return Err(error);
        }
        *owner = Some(session_id);
        // The frontend explicitly shows it after checking route/overlay
        // visibility. Finishing a slow open must not flash over a dialog.
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state, bounds);
        Err("Instagram's in-app timeline is available on desktop. Use Open in browser.".into())
    }
}

#[tauri::command]
pub async fn instagram_web_update(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
    session_id: String,
    bounds: Option<InstagramBounds>,
    visible: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_session_id(&session_id)?;
    #[cfg(desktop)]
    {
        let owner = state.owner.lock().await;
        if owner.as_deref() != Some(session_id.as_str()) {
            return Ok(());
        }
        let child = app
            .get_webview(CHILD_LABEL)
            .ok_or_else(|| "Instagram is no longer open. Open the timeline again.".to_string())?;
        if visible {
            let bounds = bounds.ok_or_else(|| "Instagram needs visible viewport bounds.".to_string())?;
            if let Some(bounds) = viewport(&webview, bounds)? {
                child
                    .set_bounds(bounds.rect())
                    .map_err(|_| "Could not resize Instagram.".to_string())?;
                return child.show().map_err(|_| "Could not show Instagram.".to_string());
            }
        }
        child.hide().map_err(|_| "Could not hide Instagram.".to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state, bounds, visible);
        Err("Instagram's in-app timeline is available on desktop.".into())
    }
}

#[tauri::command]
pub async fn instagram_web_navigate(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
    session_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_session_id(&session_id)?;
    #[cfg(desktop)]
    {
        let owner = state.owner.lock().await;
        if owner.as_deref() != Some(session_id.as_str()) {
            return Ok(());
        }
        app.get_webview(CHILD_LABEL)
            .ok_or_else(|| "Instagram is no longer open. Open the timeline again.".to_string())?
            .navigate(home_url())
            .map_err(|_| "Could not return to Instagram's home feed.".to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state);
        Err("Instagram's in-app timeline is available on desktop.".into())
    }
}

#[tauri::command]
pub async fn instagram_web_reload(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
    session_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_session_id(&session_id)?;
    #[cfg(desktop)]
    {
        let owner = state.owner.lock().await;
        if owner.as_deref() != Some(session_id.as_str()) {
            return Ok(());
        }
        let child = app
            .get_webview(CHILD_LABEL)
            .ok_or_else(|| "Instagram is no longer open. Open the timeline again.".to_string())?;
        let url = child.url().map_err(|_| "Could not reload Instagram.".to_string())?;
        if !is_service_url(&url) {
            return Err("Return to Instagram's home feed before reloading.".into());
        }
        child.reload().map_err(|_| "Could not reload Instagram.".to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state);
        Err("Instagram's in-app timeline is available on desktop.".into())
    }
}

#[tauri::command]
pub async fn instagram_web_close(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
    session_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_session_id(&session_id)?;
    #[cfg(desktop)]
    {
        let mut owner = state.owner.lock().await;
        if owner.as_deref() != Some(session_id.as_str()) {
            return Ok(());
        }
        if let Some(child) = app.get_webview(CHILD_LABEL) {
            // Hide first, even if the runtime later fails to close it.
            let _ = child.hide();
            child.close().map_err(|_| "Could not close Instagram.".to_string())?;
        }
        *owner = None;
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state);
        Ok(())
    }
}

#[tauri::command]
pub async fn instagram_web_popout(
    app: tauri::AppHandle,
    webview: Webview,
    state: tauri::State<'_, InstagramWebState>,
) -> Result<(), String> {
    require_main(&webview)?;
    #[cfg(desktop)]
    {
        let _owner = state.owner.lock().await;
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            let _ = window.unminimize();
            window.show().map_err(|_| "Could not show the Instagram window.".to_string())?;
            return window.set_focus().map_err(|_| "Could not focus the Instagram window.".to_string());
        }
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            WINDOW_LABEL,
            tauri::WebviewUrl::External(home_url()),
        )
        .title("Instagram — www.instagram.com (secure)")
        .inner_size(1000.0, 800.0)
        .min_inner_size(360.0, 420.0)
        .on_navigation(allowed_navigation)
        .on_new_window(popup_handler(app.clone(), WINDOW_LABEL, None))
        .on_download(|_, _| false)
        .on_page_load(|window, payload| {
            if is_service_url(payload.url()) {
                let host = payload.url().host_str().unwrap_or("www.instagram.com");
                let _ = window.set_title(&format!("Instagram — {host} (secure)"));
            }
        });
        #[cfg(any(windows, target_os = "linux"))]
        let builder = builder.data_directory(profile_directory(&app)?);
        #[cfg(target_os = "macos")]
        let builder = builder.data_store_identifier(INSTAGRAM_DATA_STORE);
        builder
            .build()
            .map(|_| ())
            .map_err(|_| "Could not open the Instagram window. Try the browser instead.".to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, state);
        Err("Instagram windows are available on desktop. Use Open in browser.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> tauri::Url {
        value.parse().unwrap()
    }

    #[test]
    fn real_instagram_pages_and_exact_login_hosts_are_allowed() {
        for value in [
            INSTAGRAM_HOME,
            "https://instagram.com/accounts/login/",
            "https://www.instagram.com:443/direct/inbox/",
            "https://www.instagram.com/p/post/?next=%2F",
            "https://accountscenter.instagram.com/password_and_security/",
            "https://www.facebook.com/login/",
            "https://m.facebook.com/login/",
            "https://accountscenter.facebook.com/",
        ] {
            assert!(is_service_url(&url(value)), "{value}");
        }
        assert!(allowed_navigation(&url("about:blank")));
        assert!(!is_service_url(&url("about:blank")));
    }

    #[test]
    fn service_navigation_rejects_host_confusion_and_local_protocols() {
        for value in [
            "https://www.instagram.com.evil.example/",
            "https://evilinstagram.com/",
            "https://user@www.instagram.com/",
            "https://www.instagram.com@evil.example/",
            "https://www.instagram.com:444/",
            "https://www.instagram.com./",
            "https://not-login.facebook.com/",
            "http://www.instagram.com/",
            "https://127.0.0.1/",
            "https://tauri.localhost/",
            "tauri://localhost/",
            "app.vercel.crispdeck:/oauth/callback",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "about:blank#payload",
        ] {
            assert!(!allowed_navigation(&url(value)), "{value}");
        }
    }

    #[test]
    fn only_bundled_main_view_is_an_authorized_controller() {
        assert!(is_main_caller("main", "main"));
        for (view, window) in [
            (CHILD_LABEL, "main"),
            (WINDOW_LABEL, WINDOW_LABEL),
            ("main", "other-window"),
            ("main-other", "main"),
        ] {
            assert!(!is_main_caller(view, window));
        }
        for value in ["tauri://localhost/instagram", "http://tauri.localhost/instagram", "https://tauri.localhost/instagram"] {
            assert!(is_app_origin(&url(value), None), "{value}");
        }
        for value in [INSTAGRAM_HOME, "https://tauri.localhost.evil.example/", "tauri://evil/", "https://user@tauri.localhost/"] {
            assert!(!is_app_origin(&url(value), None), "{value}");
        }
        let dev = url("http://localhost:1420/");
        assert!(is_app_origin(&url("http://localhost:1420/instagram"), Some(&dev)));
        assert!(!is_app_origin(&url("http://localhost:1421/instagram"), Some(&dev)));
        assert!(!is_app_origin(&url("https://localhost:1420/instagram"), Some(&dev)));
    }

    #[test]
    fn viewport_rejects_nonfinite_negative_and_overflowing_values() {
        let valid = InstagramBounds { x: 200.0, y: 120.0, width: 900.0, height: 650.0 };
        assert_eq!(valid.validate().unwrap(), valid);
        for invalid in [
            InstagramBounds { x: f64::NAN, ..valid },
            InstagramBounds { y: f64::INFINITY, ..valid },
            InstagramBounds { x: -1.0, ..valid },
            InstagramBounds { width: 0.0, ..valid },
            InstagramBounds { height: -1.0, ..valid },
            InstagramBounds { width: 1e30, ..valid },
        ] {
            assert!(invalid.validate().is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn viewport_clips_stale_resize_geometry_and_hides_offscreen_views() {
        let bounds = InstagramBounds { x: 200.0, y: 120.0, width: 900.0, height: 650.0 };
        assert_eq!(bounds.clipped(800.0, 600.0), Some(InstagramBounds { width: 600.0, height: 480.0, ..bounds }));
        assert_eq!(bounds.clipped(100.0, 600.0), None);
        assert_eq!(bounds.clipped(800.0, 100.0), None);
        assert_eq!(bounds.clipped(0.0, 0.0), None);
        assert_eq!(bounds.clipped(f64::NAN, 600.0), None);
    }

    #[test]
    fn session_ids_are_bounded_and_never_paths_or_urls() {
        assert!(validate_session_id("7d62458b-9961-49eb-94ab-1a70b8467770").is_ok());
        for value in ["", "../../main", "https://instagram.com", "has spaces", "\nmain"] {
            assert!(validate_session_id(value).is_err(), "{value}");
        }
        assert!(validate_session_id(&"x".repeat(101)).is_err());
    }
}
