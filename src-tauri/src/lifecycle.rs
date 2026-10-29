//! Fixed lifecycle receipts only. Never accept callback URLs or credentials.

pub fn started() {
    record("CrispDeck native startup complete");
}

pub fn oauth_callback() {
    record("OAuth callback delivered to the running app");
}

fn record(message: &'static str) {
    #[cfg(target_os = "ios")]
    {
        // Tauri redirects stdout/stderr through a Swift logger that is disabled
        // in release builds. Use Apple's native logger for these two receipts.
        static LOGGER: std::sync::OnceLock<oslog::OsLog> = std::sync::OnceLock::new();
        LOGGER
            .get_or_init(|| oslog::OsLog::new("com.christianstrobele.crispdeck", "lifecycle"))
            .default(message);
    }
    #[cfg(not(target_os = "ios"))]
    log::info!("{message}");
}
