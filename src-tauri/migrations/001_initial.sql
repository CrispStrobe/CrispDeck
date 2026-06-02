-- CrispDeck initial schema

CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL CHECK (platform IN ('bluesky', 'mastodon')),
    handle          TEXT NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    did             TEXT,
    mastodon_id     TEXT,
    instance_url    TEXT,
    credentials_enc TEXT,
    is_primary      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, handle)
);

CREATE TABLE IF NOT EXISTS identities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name    TEXT,
    notes           TEXT,
    auto_detected   INTEGER NOT NULL DEFAULT 0,
    confirmed       INTEGER NOT NULL DEFAULT 0,
    confidence      REAL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS identity_links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id     INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL CHECK (platform IN ('bluesky', 'mastodon')),
    handle          TEXT NOT NULL,
    did             TEXT,
    mastodon_id     TEXT,
    instance_url    TEXT,
    display_name    TEXT,
    avatar_url      TEXT,
    bio             TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, handle, identity_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_links_identity ON identity_links(identity_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_platform_handle ON identity_links(platform, handle);

CREATE TABLE IF NOT EXISTS identity_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id     INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,
    UNIQUE(identity_id, tag)
);

CREATE TABLE IF NOT EXISTS crosspost_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id        INTEGER REFERENCES draft_posts(id) ON DELETE SET NULL,
    bluesky_uri     TEXT,
    bluesky_cid     TEXT,
    mastodon_uri    TEXT,
    mastodon_id     TEXT,
    text_preview    TEXT,
    media_count     INTEGER DEFAULT 0,
    posted_at       TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed'))
);

CREATE TABLE IF NOT EXISTS draft_posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    text            TEXT NOT NULL DEFAULT '',
    target_accounts TEXT NOT NULL DEFAULT '[]',
    media_paths     TEXT NOT NULL DEFAULT '[]',
    visibility      TEXT DEFAULT 'public',
    content_warning TEXT,
    is_sent         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follows_cache (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    handle           TEXT NOT NULL,
    did              TEXT,
    mastodon_id      TEXT,
    instance_url     TEXT,
    display_name     TEXT,
    avatar_url       TEXT,
    bio              TEXT,
    fetched_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_account_id, platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_follows_cache_owner ON follows_cache(owner_account_id);
