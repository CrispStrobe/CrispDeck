/**
 * Database abstraction layer.
 * In Tauri: delegates to Rust backend via invoke().
 * In browser: delegates to IndexedDB via browser-db.ts.
 */

import { isTauri } from './platform';
import * as browserDb from './browser-db';
import type {
  Account,
  Identity,
  IdentityCandidate,
  CrosspostEntry,
  Draft,
  FollowEntry,
} from './types';

/**
 * snake_case -> camelCase for one key.
 *
 * Tauri v2 renames command arguments to camelCase on the JS side unless the
 * command opts out with `rename_all`. None of ours do — and the rest of the
 * app (asr.rs's callers) already passes camelCase — but this module was
 * written against Tauri v1, where the Rust names were used verbatim, and the
 * migration missed it. The failure is silent in the browser build, which never
 * reaches invoke() at all, and in the desktop build it surfaces only as
 * "missing required key <camelName>" from whichever command you happened to
 * call.
 */
export function toCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Argument names only — never values, and never nested keys. Tauri renames the
 * command's parameters; anything inside them is deserialized by serde using the
 * Rust field names, which are snake_case here (that is why `Account` comes back
 * with `display_name` intact).
 */
export function toCamelArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!args) return args;
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [toCamelKey(k), v]),
  );
}

// Lazy-load Tauri invoke to avoid import errors in browser
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, toCamelArgs(args));
}

// ── Accounts ───────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<Account[]> {
  if (!isTauri()) return browserDb.listAccounts();
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
  if (!isTauri()) return browserDb.addAccount(params);
  return invoke<Account>('db_add_account', params);
}

export async function updateAccount(params: {
  id: number;
  display_name?: string;
  avatar_url?: string;
  is_primary?: boolean;
}): Promise<void> {
  if (!isTauri()) return browserDb.updateAccount(params);
  return invoke('db_update_account', params);
}

export async function deleteAccount(id: number): Promise<void> {
  if (!isTauri()) return browserDb.deleteAccount(id);
  return invoke('db_delete_account', { id });
}

export async function getDecryptedCredentials(accountId: number): Promise<string> {
  if (!isTauri()) return browserDb.getDecryptedCredentials(accountId);
  return invoke<string>('db_get_credentials', { id: accountId });
}

// ── Identities ─────────────────────────────────────────────────────────────

export async function listIdentities(filter?: {
  confirmed_only?: boolean;
  tag?: string;
}): Promise<Identity[]> {
  if (!isTauri()) return browserDb.listIdentities(filter);
  return invoke<Identity[]>('db_list_identities', { filter: filter ?? null });
}

export async function createIdentity(params: {
  display_name?: string;
  notes?: string;
}): Promise<Identity> {
  if (!isTauri()) return browserDb.createIdentity(params);
  return invoke<Identity>('db_create_identity', params);
}

export async function updateIdentity(params: {
  id: number;
  display_name?: string;
  notes?: string;
}): Promise<void> {
  if (!isTauri()) return browserDb.updateIdentity(params);
  return invoke('db_update_identity', params);
}

export async function deleteIdentity(id: number): Promise<void> {
  if (!isTauri()) return browserDb.deleteIdentity(id);
  return invoke('db_delete_identity', { id });
}

export async function linkToIdentity(params: {
  identity_id: number;
  platform: string;
  handle: string;
  // Nullable columns: a row read back from the DB carries `null`, not
  // `undefined`, and callers relink straight from such a row.
  did?: string | null;
  mastodon_id?: string | null;
  instance_url?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  account_id?: number | null;
}): Promise<void> {
  if (!isTauri()) return browserDb.linkToIdentity(params);
  return invoke('db_link_to_identity', params);
}

export async function unlinkFromIdentity(linkId: number): Promise<void> {
  if (!isTauri()) return browserDb.unlinkFromIdentity(linkId);
  return invoke('db_unlink_from_identity', { link_id: linkId });
}

export async function confirmIdentity(id: number): Promise<void> {
  if (!isTauri()) return browserDb.confirmIdentity(id);
  return invoke('db_confirm_identity', { id });
}

export async function resolveHandle(
  handle: string,
  targetPlatform: string
): Promise<string | null> {
  if (!isTauri()) return browserDb.resolveHandle(handle, targetPlatform);
  return invoke<string | null>('db_resolve_handle', {
    handle,
    target_platform: targetPlatform,
  });
}

// ── Tags ───────────────────────────────────────────────────────────────────

export async function addTag(identityId: number, tag: string): Promise<void> {
  if (!isTauri()) return browserDb.addTag(identityId, tag);
  return invoke('db_add_tag', { identity_id: identityId, tag });
}

export async function removeTag(identityId: number, tag: string): Promise<void> {
  if (!isTauri()) return browserDb.removeTag(identityId, tag);
  return invoke('db_remove_tag', { identity_id: identityId, tag });
}

// ── Identity detection ─────────────────────────────────────────────────────

export async function detectIdentities(
  bskyFollows: FollowEntry[],
  mastoFollows: FollowEntry[]
): Promise<IdentityCandidate[]> {
  if (!isTauri()) return browserDb.detectIdentities(bskyFollows, mastoFollows);
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
  if (!isTauri()) return browserDb.cacheFollows(ownerAccountId, follows);
  return invoke('db_cache_follows', {
    owner_account_id: ownerAccountId,
    follows,
  });
}

export async function getCachedFollows(ownerAccountId: number): Promise<FollowEntry[]> {
  if (!isTauri()) return browserDb.getCachedFollows(ownerAccountId);
  return invoke<FollowEntry[]>('db_get_cached_follows', {
    owner_account_id: ownerAccountId,
  });
}

// ── Crosspost history ──────────────────────────────────────────────────────

export async function logCrosspost(params: {
  draft_id?: number;
  bluesky_uri?: string | null;
  bluesky_cid?: string | null;
  mastodon_uri?: string | null;
  mastodon_id?: string | null;
  threads_uri?: string | null;
  threads_id?: string | null;
  text_preview?: string;
  media_count?: number;
  status: string;
}): Promise<number> {
  if (!isTauri()) return browserDb.logCrosspost(params);
  return invoke<number>('db_log_crosspost', params);
}

export async function listCrossposts(
  limit: number = 50,
  offset: number = 0
): Promise<CrosspostEntry[]> {
  if (!isTauri()) return browserDb.listCrossposts(limit, offset);
  return invoke<CrosspostEntry[]>('db_list_crossposts', { limit, offset });
}

// ── Drafts ─────────────────────────────────────────────────────────────────

export async function saveDraft(params: {
  text: string;
  target_accounts: number[];
  media_paths?: string[];
  visibility?: string;
  // `null` is the stored "no content warning" / "not scheduled" value, and
  // rescheduling an existing draft passes it straight back in.
  content_warning?: string | null;
  scheduled_at?: string | null;
}): Promise<number> {
  if (!isTauri()) return browserDb.saveDraft(params);
  return invoke<number>('db_save_draft', params);
}

export async function listDrafts(): Promise<Draft[]> {
  if (!isTauri()) return browserDb.listDrafts();
  return invoke<Draft[]>('db_list_drafts');
}

export async function deleteDraft(id: number): Promise<void> {
  if (!isTauri()) return browserDb.deleteDraft(id);
  return invoke('db_delete_draft', { id });
}

// ── Mastodon OAuth ─────────────────────────────────────────────────────────

export async function startMastodonOAuth(instanceUrl: string): Promise<{
  auth_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}> {
  if (!isTauri()) return browserDb.startMastodonOAuth(instanceUrl);
  return invoke('auth_start_mastodon_oauth', { instance_url: instanceUrl });
}

export async function completeMastodonOAuth(params: {
  instance_url: string;
  code: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}): Promise<{ access_token: string }> {
  if (!isTauri()) return browserDb.completeMastodonOAuth(params);
  return invoke('auth_complete_mastodon_oauth', params);
}
