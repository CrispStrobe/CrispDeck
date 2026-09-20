-- Allow 'threads' as a platform.
--
-- 001 wrote CHECK (platform IN ('bluesky', 'mastodon')). Threads support was
-- added to the app afterwards and the constraint was never widened, so
-- connecting a Threads account worked in the browser build — which stores
-- accounts in IndexedDB with no such check — and failed on the desktop build
-- with "CHECK constraint failed". Nothing in the Rust side mentioned threads
-- at all, and no test touched this table.
--
-- SQLite cannot alter a CHECK constraint in place, so this is the documented
-- 12-step table rebuild: create the replacement, copy the rows, drop the old
-- one, rename. Foreign keys are off during a migration script run by
-- execute_batch inside the implicit transaction, and no other table
-- references accounts by id, so no reference needs fixing up.

CREATE TABLE accounts_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL CHECK (platform IN ('bluesky', 'mastodon', 'threads')),
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

INSERT INTO accounts_new (id, platform, handle, display_name, avatar_url, did,
                          mastodon_id, instance_url, credentials_enc,
                          is_primary, created_at, updated_at)
SELECT id, platform, handle, display_name, avatar_url, did,
       mastodon_id, instance_url, credentials_enc,
       is_primary, created_at, updated_at
FROM accounts;

DROP TABLE accounts;

ALTER TABLE accounts_new RENAME TO accounts;
