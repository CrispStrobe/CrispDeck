import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  Identity,
  IdentityCandidate,
  CrosspostEntry,
  Draft,
  FollowEntry,
} from './types';

// ── Accounts ───────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<Account[]> {
  return invoke<Account[]>('db_list_accounts');
}

export async function addAccount(params: {
  platform: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  did?: string;
  mastodon_id?: string;
  instance_url?: string;
  credentials: string;
  is_primary?: boolean;
}): Promise<Account> {
  return invoke<Account>('db_add_account', params);
}

export async function updateAccount(params: {
  id: number;
  display_name?: string;
  avatar_url?: string;
  is_primary?: boolean;
}): Promise<void> {
  return invoke('db_update_account', params);
}

export async function deleteAccount(id: number): Promise<void> {
  return invoke('db_delete_account', { id });
}

export async function getDecryptedCredentials(accountId: number): Promise<string> {
  return invoke<string>('db_get_credentials', { id: accountId });
}

// ── Identities ─────────────────────────────────────────────────────────────

export async function listIdentities(filter?: {
  confirmed_only?: boolean;
  tag?: string;
}): Promise<Identity[]> {
  return invoke<Identity[]>('db_list_identities', { filter: filter ?? null });
}

export async function createIdentity(params: {
  display_name?: string;
  notes?: string;
}): Promise<Identity> {
  return invoke<Identity>('db_create_identity', params);
}

export async function updateIdentity(params: {
  id: number;
  display_name?: string;
  notes?: string;
}): Promise<void> {
  return invoke('db_update_identity', params);
}

export async function deleteIdentity(id: number): Promise<void> {
  return invoke('db_delete_identity', { id });
}

export async function linkToIdentity(params: {
  identity_id: number;
  platform: string;
  handle: string;
  did?: string;
  mastodon_id?: string;
  instance_url?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  account_id?: number;
}): Promise<void> {
  return invoke('db_link_to_identity', params);
}

export async function unlinkFromIdentity(linkId: number): Promise<void> {
  return invoke('db_unlink_from_identity', { link_id: linkId });
}

export async function confirmIdentity(id: number): Promise<void> {
  return invoke('db_confirm_identity', { id });
}

export async function resolveHandle(
  handle: string,
  targetPlatform: string
): Promise<string | null> {
  return invoke<string | null>('db_resolve_handle', {
    handle,
    target_platform: targetPlatform,
  });
}

// ── Tags ───────────────────────────────────────────────────────────────────

export async function addTag(identityId: number, tag: string): Promise<void> {
  return invoke('db_add_tag', { identity_id: identityId, tag });
}

export async function removeTag(identityId: number, tag: string): Promise<void> {
  return invoke('db_remove_tag', { identity_id: identityId, tag });
}

// ── Identity detection ─────────────────────────────────────────────────────

export async function detectIdentities(
  bskyFollows: FollowEntry[],
  mastoFollows: FollowEntry[]
): Promise<IdentityCandidate[]> {
  return invoke<IdentityCandidate[]>('db_detect_identities', {
    bsky_follows: bskyFollows,
    masto_follows: mastoFollows,
  });
}

// ── Follows cache ──────────────────────────────────────────────────────────

export async function cacheFollows(
  ownerAccountId: number,
  follows: FollowEntry[]
): Promise<void> {
  return invoke('db_cache_follows', {
    owner_account_id: ownerAccountId,
    follows,
  });
}

export async function getCachedFollows(ownerAccountId: number): Promise<FollowEntry[]> {
  return invoke<FollowEntry[]>('db_get_cached_follows', {
    owner_account_id: ownerAccountId,
  });
}

// ── Crosspost history ──────────────────────────────────────────────────────

export async function logCrosspost(params: {
  draft_id?: number;
  bluesky_uri?: string;
  bluesky_cid?: string;
  mastodon_uri?: string;
  mastodon_id?: string;
  text_preview?: string;
  media_count?: number;
  status: string;
}): Promise<number> {
  return invoke<number>('db_log_crosspost', params);
}

export async function listCrossposts(
  limit: number = 50,
  offset: number = 0
): Promise<CrosspostEntry[]> {
  return invoke<CrosspostEntry[]>('db_list_crossposts', { limit, offset });
}

// ── Drafts ─────────────────────────────────────────────────────────────────

export async function saveDraft(params: {
  text: string;
  target_accounts: number[];
  media_paths?: string[];
  visibility?: string;
  content_warning?: string;
}): Promise<number> {
  return invoke<number>('db_save_draft', params);
}

export async function listDrafts(): Promise<Draft[]> {
  return invoke<Draft[]>('db_list_drafts');
}

export async function deleteDraft(id: number): Promise<void> {
  return invoke('db_delete_draft', { id });
}

// ── Mastodon OAuth ─────────────────────────────────────────────────────────

export async function startMastodonOAuth(instanceUrl: string): Promise<{
  auth_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}> {
  return invoke('auth_start_mastodon_oauth', { instance_url: instanceUrl });
}

export async function completeMastodonOAuth(params: {
  instance_url: string;
  code: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}): Promise<{ access_token: string }> {
  return invoke('auth_complete_mastodon_oauth', params);
}
