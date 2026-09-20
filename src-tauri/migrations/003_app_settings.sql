-- A place for settings the Rust side needs before the frontend has loaded.
--
-- The first of them is which secret store credentials go to. That has to be
-- known at the moment an account is added, which is inside a Tauri command —
-- too early to ask the web layer.
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
