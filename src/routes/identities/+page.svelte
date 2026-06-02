<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { Users, ScanSearch, Loader2, Check, X, Plus, Tag, Trash2, Link2 } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account, Identity, IdentityCandidate, FollowEntry } from '$lib/types';

  let accounts: Account[] = $state([]);
  let identities: Identity[] = $state([]);
  let candidates: IdentityCandidate[] = $state([]);
  let loading = $state(true);
  let scanning = $state(false);
  let scanProgress = $state('');
  let error = $state('');

  // Manual link form
  let showLinkForm = $state(false);
  let newIdentityName = $state('');

  // Tag form
  let tagInput: Record<number, string> = $state({});

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    try {
      accounts = await invoke<Account[]>('db_list_accounts');
      identities = await invoke<Identity[]>('db_list_identities', { filter: null });
      await initClients();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }

    // Auto-scan if URL has ?scan=1
    if (new URLSearchParams(window.location.search).get('scan') === '1') {
      scanForIdentities();
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await invoke<string>('db_get_credentials', { id: acct.id });
        const creds = JSON.parse(credsJson);
        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          clients.set(acct.id, client);
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch (e) {
        console.error(`Failed to init client for ${acct.handle}:`, e);
      }
    }
  }

  async function scanForIdentities() {
    scanning = true;
    error = '';
    candidates = [];

    try {
      const bskyFollows: FollowEntry[] = [];
      const mastoFollows: FollowEntry[] = [];

      // Fetch follows from all accounts
      for (const acct of accounts) {
        const client = clients.get(acct.id);
        if (!client) continue;

        if (acct.platform === 'bluesky') {
          scanProgress = `Fetching Bluesky follows for ${acct.handle}...`;
          const bsky = client as BlueskyClient;
          let cursor: string | undefined;
          do {
            const result = await bsky.getFollows(acct.handle, cursor);
            for (const f of result.follows) {
              bskyFollows.push({
                platform: 'bluesky',
                handle: f.handle,
                did: f.did,
                mastodon_id: null,
                instance_url: null,
                display_name: f.displayName ?? null,
                avatar_url: f.avatar ?? null,
                bio: f.description ?? null,
              });
            }
            cursor = result.cursor;
            scanProgress = `Bluesky: ${bskyFollows.length} follows...`;
          } while (cursor);

          // Cache follows
          await invoke('db_cache_follows', {
            owner_account_id: acct.id,
            follows_list: bskyFollows,
          });
        } else {
          scanProgress = `Fetching Mastodon follows for ${acct.handle}...`;
          const masto = client as MastodonClient;
          try {
            const me = await masto.verifyCredentials();
            let page = await masto.getFollowing(me.id);
            while (page.length > 0) {
              for (const f of page) {
                const instanceHost = new URL(f.url).hostname;
                mastoFollows.push({
                  platform: 'mastodon',
                  handle: `@${f.acct}@${instanceHost}`,
                  did: null,
                  mastodon_id: f.id,
                  instance_url: `https://${instanceHost}`,
                  display_name: f.displayName ?? null,
                  avatar_url: f.avatar ?? null,
                  bio: f.note ? f.note.replace(/<[^>]*>?/gm, '') : null,
                });
              }
              scanProgress = `Mastodon: ${mastoFollows.length} follows...`;
              if (page.length < 80) break;
              const lastId = page[page.length - 1].id;
              page = await masto.getFollowing(me.id, lastId);
            }
          } catch (e) {
            console.error(`Failed to fetch Mastodon follows:`, e);
          }

          await invoke('db_cache_follows', {
            owner_account_id: acct.id,
            follows_list: mastoFollows,
          });
        }
      }

      // Run identity detection in Rust
      scanProgress = `Matching ${bskyFollows.length} Bluesky × ${mastoFollows.length} Mastodon follows...`;
      candidates = await invoke<IdentityCandidate[]>('db_detect_identities', {
        bsky_follows: bskyFollows,
        masto_follows: mastoFollows,
      });

      scanProgress = `Found ${candidates.length} potential matches.`;
    } catch (e) {
      error = String(e);
    } finally {
      scanning = false;
    }
  }

  async function confirmCandidate(candidate: IdentityCandidate) {
    try {
      const displayName = candidate.bluesky_display_name || candidate.mastodon_display_name || 'Unknown';
      const identity = await invoke<Identity>('db_create_identity', {
        display_name: displayName,
      });

      await invoke('db_link_to_identity', {
        identity_id: identity.id,
        platform: 'bluesky',
        handle: candidate.bluesky_handle,
        did: candidate.bluesky_did,
        display_name: candidate.bluesky_display_name,
        avatar_url: candidate.bluesky_avatar,
        bio: candidate.bluesky_bio,
      });

      await invoke('db_link_to_identity', {
        identity_id: identity.id,
        platform: 'mastodon',
        handle: candidate.mastodon_handle,
        mastodon_id: candidate.mastodon_id,
        instance_url: candidate.mastodon_instance,
        display_name: candidate.mastodon_display_name,
        avatar_url: candidate.mastodon_avatar,
        bio: candidate.mastodon_bio,
      });

      await invoke('db_confirm_identity', { id: identity.id });

      // Remove from candidates, refresh identities
      candidates = candidates.filter(c => c !== candidate);
      identities = await invoke<Identity[]>('db_list_identities', { filter: null });
    } catch (e) {
      error = String(e);
    }
  }

  function dismissCandidate(candidate: IdentityCandidate) {
    candidates = candidates.filter(c => c !== candidate);
  }

  async function deleteIdentity(id: number) {
    try {
      await invoke('db_delete_identity', { id });
      identities = identities.filter(i => i.id !== id);
    } catch (e) {
      error = String(e);
    }
  }

  async function addTag(identityId: number) {
    const tag = tagInput[identityId]?.trim();
    if (!tag) return;
    try {
      await invoke('db_add_tag', { identity_id: identityId, tag });
      tagInput[identityId] = '';
      identities = await invoke<Identity[]>('db_list_identities', { filter: null });
    } catch (e) {
      error = String(e);
    }
  }

  async function removeTag(identityId: number, tag: string) {
    try {
      await invoke('db_remove_tag', { identity_id: identityId, tag });
      identities = await invoke<Identity[]>('db_list_identities', { filter: null });
    } catch (e) {
      error = String(e);
    }
  }

  async function createManualIdentity() {
    if (!newIdentityName.trim()) return;
    try {
      await invoke('db_create_identity', { display_name: newIdentityName.trim() });
      newIdentityName = '';
      showLinkForm = false;
      identities = await invoke<Identity[]>('db_list_identities', { filter: null });
    } catch (e) {
      error = String(e);
    }
  }

  const confirmedCount = $derived(identities.filter(i => i.confirmed).length);
  const pendingCount = $derived(identities.filter(i => !i.confirmed).length);
</script>

<div class="p-6 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Users size={24} />
      <h1 class="text-2xl font-bold">Identities</h1>
      {#if identities.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">
          {confirmedCount} confirmed, {pendingCount} pending
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={() => showLinkForm = !showLinkForm}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md transition-colors"
      >
        <Plus size={14} />
        Manual
      </button>
      <button
        onclick={scanForIdentities}
        disabled={scanning || accounts.length < 2}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-md disabled:opacity-50 transition-colors"
      >
        {#if scanning}<Loader2 size={14} class="animate-spin" />{:else}<ScanSearch size={14} />{/if}
        Scan for Matches
      </button>
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if scanning}
    <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div class="flex items-center gap-3">
        <Loader2 size={18} class="animate-spin text-[var(--color-primary)]" />
        <span class="text-sm">{scanProgress}</span>
      </div>
    </div>
  {/if}

  <!-- Manual create form -->
  {#if showLinkForm}
    <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <h3 class="text-sm font-medium mb-3">Create Identity Group</h3>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={newIdentityName}
          placeholder="Display name (e.g. Alice)"
          class="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
        />
        <button onclick={createManualIdentity} class="px-3 py-2 bg-[var(--color-primary)] text-white text-sm rounded-md">Create</button>
        <button onclick={() => showLinkForm = false} class="px-3 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
      </div>
      <p class="text-xs text-[var(--color-text-muted)] mt-2">After creating, you can link accounts from the identity card.</p>
    </div>
  {/if}

  <!-- Auto-detected candidates -->
  {#if candidates.length > 0}
    <div class="mb-8">
      <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
        <ScanSearch size={18} />
        Detected Matches ({candidates.length})
      </h2>
      <div class="space-y-3">
        {#each candidates as candidate}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-yellow-700/50">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs px-2 py-0.5 bg-yellow-900/50 text-yellow-300 rounded">
                {(candidate.confidence * 100).toFixed(0)}% confidence
              </span>
              <div class="flex items-center gap-1">
                <button
                  onclick={() => confirmCandidate(candidate)}
                  class="flex items-center gap-1 px-3 py-1 text-xs bg-[var(--color-success)] text-white rounded-md hover:opacity-90"
                >
                  <Check size={12} /> Confirm
                </button>
                <button
                  onclick={() => dismissCandidate(candidate)}
                  class="flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-md"
                >
                  <X size={12} /> Dismiss
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <!-- Bluesky side -->
              <div class="flex items-center gap-3">
                <div class="w-2 h-full rounded-full bg-[var(--color-bluesky)] flex-shrink-0"></div>
                {#if candidate.bluesky_avatar}
                  <img src={candidate.bluesky_avatar} alt="" class="w-10 h-10 rounded-full" />
                {:else}
                  <div class="w-10 h-10 rounded-full bg-[var(--color-bluesky)]/20 flex items-center justify-center text-xs">BS</div>
                {/if}
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{candidate.bluesky_display_name || candidate.bluesky_handle}</p>
                  <p class="text-xs text-[var(--color-text-muted)] truncate">{candidate.bluesky_handle}</p>
                </div>
              </div>

              <!-- Mastodon side -->
              <div class="flex items-center gap-3">
                <div class="w-2 h-full rounded-full bg-[var(--color-mastodon)] flex-shrink-0"></div>
                {#if candidate.mastodon_avatar}
                  <img src={candidate.mastodon_avatar} alt="" class="w-10 h-10 rounded-full" />
                {:else}
                  <div class="w-10 h-10 rounded-full bg-[var(--color-mastodon)]/20 flex items-center justify-center text-xs">M</div>
                {/if}
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{candidate.mastodon_display_name || candidate.mastodon_handle}</p>
                  <p class="text-xs text-[var(--color-text-muted)] truncate">{candidate.mastodon_handle}</p>
                </div>
              </div>
            </div>

            {#if candidate.match_reasons.length > 0}
              <div class="mt-2 flex flex-wrap gap-1">
                {#each candidate.match_reasons as reason}
                  <span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] rounded text-[var(--color-text-muted)]">{reason}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Confirmed identities -->
  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if identities.length === 0 && candidates.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Users size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Identities Yet</h3>
      <p class="text-sm text-[var(--color-text-muted)]">
        {accounts.length < 2
          ? 'Add accounts on both platforms in Settings first, then scan.'
          : 'Click "Scan for Matches" to find cross-platform identities.'}
      </p>
    </div>
  {:else}
    <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
      <Link2 size={18} />
      Linked Identities ({identities.length})
    </h2>
    <div class="space-y-3">
      {#each identities as identity}
        <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">{identity.display_name || `Identity #${identity.id}`}</span>
              {#if identity.confirmed}
                <span class="text-[10px] px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">confirmed</span>
              {:else}
                <span class="text-[10px] px-1.5 py-0.5 bg-yellow-900/50 text-yellow-300 rounded">pending</span>
              {/if}
              {#if identity.confidence}
                <span class="text-[10px] text-[var(--color-text-muted)]">{(identity.confidence * 100).toFixed(0)}%</span>
              {/if}
            </div>
            <button
              onclick={() => deleteIdentity(identity.id)}
              class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
              title="Delete identity"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <!-- Linked accounts -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            {#each identity.links as link}
              <div class="flex items-center gap-2 p-2 bg-[var(--color-bg)] rounded-md">
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  style="background: {link.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"
                ></div>
                {#if link.avatar_url}
                  <img src={link.avatar_url} alt="" class="w-6 h-6 rounded-full" />
                {/if}
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium truncate">{link.display_name || link.handle}</p>
                  <p class="text-[10px] text-[var(--color-text-muted)] truncate">{link.handle}</p>
                </div>
              </div>
            {/each}
          </div>

          <!-- Tags -->
          <div class="flex items-center gap-2 flex-wrap">
            <Tag size={12} class="text-[var(--color-text-muted)]" />
            {#each identity.tags as tag}
              <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded">
                {tag}
                <button onclick={() => removeTag(identity.id, tag)} class="hover:text-[var(--color-danger)]">
                  <X size={10} />
                </button>
              </span>
            {/each}
            <form onsubmit={(e) => { e.preventDefault(); addTag(identity.id); }} class="inline-flex">
              <input
                type="text"
                bind:value={tagInput[identity.id]}
                placeholder="+ tag"
                class="w-16 px-1.5 py-0.5 text-[10px] bg-transparent border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] focus:w-24 transition-all"
              />
            </form>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
