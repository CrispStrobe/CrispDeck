-- Migration 004 rebuilt identity_links, which also dropped its indexes.
-- Restore both access paths for existing installations and fresh databases.
CREATE INDEX IF NOT EXISTS idx_identity_links_identity ON identity_links(identity_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_platform_handle ON identity_links(platform, handle);
