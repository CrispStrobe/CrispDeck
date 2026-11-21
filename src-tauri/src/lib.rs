mod app_data;
mod asr;
mod auth;
mod commands;
mod db;
mod lifecycle;
mod system_bars;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Listener, Manager};

pub struct AppState {
    pub db: Mutex<Connection>,
}

/// A custom About item instead of the native predefined panel, so the desktop
/// menu opens the same page as Tools & settings → About.
#[cfg(desktop)]
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = MenuItem::with_id(app, "about", "About CrispDeck", true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "CrispDeck",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_id(app, "help", "Help", true)?;
    #[cfg(not(target_os = "macos"))]
    let help_menu = Submenu::with_items(app, "Help", true, &[&about])?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &app_menu,
            &file_menu,
            &edit_menu,
            #[cfg(target_os = "macos")]
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let builder = tauri::Builder::default();

    // Must be the first plugin. With its deep-link feature, a sign-in return
    // (app.vercel.crispdeck:/...) that launched a second process is passed to
    // the running app's deep-link listener, and the main window is raised.
    #[cfg(all(desktop, feature = "desktop"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init());

    // shell and process plugins are desktop-only (not supported on iOS/Android)
    #[cfg(feature = "desktop")]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "about" {
                use tauri::Emitter;
                let _ = app.emit("crispdeck:menu", "about");
            }
        });

    builder
        .setup(|app| {
            // Never log callback URLs: their query can contain authorization
            // codes. A fixed lifecycle message also lets native smoke checks
            // confirm the plugin delivered an OS callback to this process.
            app.listen("deep-link://new-url", |_| {
                lifecycle::oauth_callback();
            });
            // macOS and mobile register the scheme from the bundle; Windows
            // and Linux only at runtime (and not at all in `tauri dev`
            // otherwise).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("could not register the sign-in URL scheme: {e}");
                }
            }

            let app_dir = app.path().app_data_dir()?;
            app_data::prepare_directory(&app_dir)?;

            let db_path = app_dir.join("crispdeck.db");
            log::info!("Opening database at {:?}", db_path);

            let conn =
                db::open_and_migrate(&db_path).expect("failed to open/migrate database");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            // CrispASR handle — lazy-loads model on first translate/transcribe/synthesize call
            let models_dir = app_dir.join("models");
            std::fs::create_dir_all(&models_dir).ok();
            app.manage(asr::AsrHandle::new(models_dir));

            log::info!(
                "CrispDeck v{} started",
                env!("CARGO_PKG_VERSION")
            );
            lifecycle::started();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_bars::set_system_bar_theme,
            // Account commands
            commands::db_commands::db_list_accounts,
            commands::db_commands::db_add_account,
            commands::db_commands::db_update_account,
            commands::db_commands::db_delete_account,
            commands::db_commands::db_get_credentials,
            commands::db_commands::db_rebind_oauth_account,
            commands::db_commands::credential_backend_get,
            commands::db_commands::credential_backend_set,
            commands::db_commands::macos_keychain_set,
            commands::db_commands::oauth_session_get,
            commands::db_commands::oauth_session_set,
            commands::db_commands::oauth_session_delete,
            commands::db_commands::wallabag_session_get,
            commands::db_commands::wallabag_session_set,
            commands::db_commands::wallabag_session_delete,
            // Identity commands
            commands::db_commands::db_list_identities,
            commands::db_commands::db_create_identity,
            commands::db_commands::db_update_identity,
            commands::db_commands::db_delete_identity,
            commands::db_commands::db_link_to_identity,
            commands::db_commands::db_unlink_from_identity,
            commands::db_commands::db_confirm_identity,
            commands::db_commands::db_resolve_handle,
            // Tag commands
            commands::db_commands::db_add_tag,
            commands::db_commands::db_remove_tag,
            // Crosspost history
            commands::db_commands::db_log_crosspost,
            commands::db_commands::db_list_crossposts,
            // Drafts
            commands::db_commands::db_save_draft,
            commands::db_commands::db_list_drafts,
            commands::db_commands::db_delete_draft,
            // Follows cache
            commands::db_commands::db_cache_follows,
            commands::db_commands::db_get_cached_follows,
            // Auth
            commands::auth_commands::auth_in_app_window,
            // Identity detection
            commands::detect_commands::db_detect_identities,
            // CrispASR (translation, TTS, STT)
            asr::translate_text,
            asr::transcribe_audio,
            asr::synthesize_speech,
            asr::asr_backend_name,
            asr::asr_available,
            asr::asr_list_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrispDeck");
}
