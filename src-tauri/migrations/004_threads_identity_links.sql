-- Allow 'threads' in identity_links, as 002 did for accounts.
--
-- 002 rebuilt the accounts table and stopped there. identity_links carries the
-- same CHECK from 001, so once a Threads account could be saved it still could
-- not be linked to an identity — the feature that exists to say "these accounts
-- are the same person" refused the third platform.
--
-- Found by writing the first tests for db/identities.rs. The lesson is the
-- ordinary one: a constraint copied into two tables has to be widened in both,
-- and grepping for the constraint rather than fixing the table in front of you
-- is what catches that.
--
-- Same 12-step rebuild as 002. The foreign key to identities is recreated with
-- the table; identity_tags references identities, not this table, so nothing
-- else needs fixing up.

CREATE TABLE identity_links_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id     INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL CHECK (platform IN ('bluesky', 'mastodon', 'threads')),
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

INSERT INTO identity_links_new (id, identity_id, account_id, platform, handle,
                                did, mastodon_id, instance_url, display_name,
                                avatar_url, bio, created_at)
SELECT id, identity_id, account_id, platform, handle,
       did, mastodon_id, instance_url, display_name,
       avatar_url, bio, created_at
FROM identity_links;

DROP TABLE identity_links;

ALTER TABLE identity_links_new RENAME TO identity_links;
