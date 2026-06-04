mod asr;
mod auth;
mod commands;
mod db;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Account commands
            commands::db_commands::db_list_accounts,
            commands::db_commands::db_add_account,
            commands::db_commands::db_update_account,
            commands::db_commands::db_delete_account,
            commands::db_commands::db_get_credentials,
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
            commands::auth_commands::auth_start_mastodon_oauth,
            commands::auth_commands::auth_complete_mastodon_oauth,
            commands::auth_commands::auth_wait_for_callback,
            // Identity detection
            commands::detect_commands::db_detect_identities,
            // CrispASR (translation, TTS, STT)
            asr::translate_text,
            asr::transcribe_audio,
            asr::synthesize_speech,
            asr::asr_backend_name,
            asr::asr_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrispDeck");
}
