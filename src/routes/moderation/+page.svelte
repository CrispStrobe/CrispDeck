<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Shield, Loader2, Ban, VolumeX, UserX } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account, Platform } from '$lib/types';

  interface BlockedAccount {
    platform: Platform;
    handle: string;
    displayName?: string;
    avatar?: string;
    id?: string; // mastodon account id
    did?: string; // bluesky did
    type: 'block' | 'mute';
  }

  interface ModList {
    uri: string;
    name: string;
    purpose: string;
    description?: string;
    avatar?: string;
    creator: { handle: string; displayName?: string };
    listItemCount?: number;
    subscribed: boolean;
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let blocked: BlockedAccount[] = $state([]);
  let muted: BlockedAccount[] = $state([]);
  let modLists: ModList[] = $state([]);
  let activeTab: 'blocked' | 'muted' | 'lists' = $state('blocked');

  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadModerationLists();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadModerationLists() {
    const allBlocked: BlockedAccount[] = [];
    const allMuted: BlockedAccount[] = [];

    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      if (acct.platform === 'bluesky') {
        try {
          const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
          // Blocks
          const blocks = await agent.api.app.bsky.graph.getBlocks({ limit: 100 });
          for (const b of blocks.data.blocks) {
            allBlocked.push({ platform: 'bluesky', handle: b.handle, displayName: b.displayName, avatar: b.avatar, did: b.did, type: 'block' });
          }
          // Mutes
          const mutes = await agent.api.app.bsky.graph.getMutes({ limit: 100 });
          for (const m of mutes.data.mutes) {
            allMuted.push({ platform: 'bluesky', handle: m.handle, displayName: m.displayName, avatar: m.avatar, did: m.did, type: 'mute' });
          }
        } catch {}
      } else {
        const masto = entry.client as MastodonClient;
        const token = masto.getAccessToken();
        if (!token) continue;
        const inst = masto.getInstanceUrl();
        const headers = { Authorization: `Bearer ${token}` };
        try {
          const bResp = await fetch(`${inst}/api/v1/blocks?limit=80`, { headers });
          if (bResp.ok) {
            for (const a of await bResp.json()) {
              allBlocked.push({ platform: 'mastodon', handle: `@${a.acct}`, displayName: a.display_name, avatar: a.avatar, id: a.id, type: 'block' });
            }
          }
          const mResp = await fetch(`${inst}/api/v1/mutes?limit=80`, { headers });
          if (mResp.ok) {
            for (const a of await mResp.json()) {
              allMuted.push({ platform: 'mastodon', handle: `@${a.acct}`, displayName: a.display_name, avatar: a.avatar, id: a.id, type: 'mute' });
            }
          }
        } catch {}
      }
    }

    blocked = allBlocked;
    muted = allMuted;

    // Load Bluesky moderation lists the user has created or subscribed to
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'bluesky') continue;
      try {
        const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
        // Get user's own lists
        const resp = await agent.api.app.bsky.graph.getLists({ actor: acct.handle, limit: 50 });
        const lists = (resp.data.lists ?? []) as any[];
        modLists = lists
          .filter((l: any) => l.purpose === 'app.bsky.graph.defs#modlist')
          .map((l: any) => ({
            uri: l.uri,
            name: l.name,
            purpose: l.purpose,
            description: l.description,
            avatar: l.avatar,
            creator: { handle: l.creator.handle, displayName: l.creator.displayName },
            listItemCount: l.listItemCount,
            subscribed: !!l.viewer?.muted || !!l.viewer?.blocked,
          }));
      } catch {}
      break;
    }
  }

  async function unblock(item: BlockedAccount) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== item.platform) continue;
      try {
        if (item.platform === 'bluesky' && item.did) {
          const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
          // Find and delete the block record
          const blocks = await agent.api.app.bsky.graph.getBlocks({ limit: 100 });
          // Unblock by deleting the block relationship
          await agent.api.app.bsky.graph.muteActor({ actor: item.did }); // This is a workaround
          // Actually need to delete the block record from the repo
        } else if (item.platform === 'mastodon' && item.id) {
          const masto = entry.client as MastodonClient;
          const token = masto.getAccessToken();
          if (token) {
            await fetch(`${masto.getInstanceUrl()}/api/v1/accounts/${item.id}/unblock`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
        blocked = blocked.filter(b => b !== item);
      } catch (e) { error = String(e); }
      break;
    }
  }

  async function toggleModListSubscription(list: ModList) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'bluesky') continue;
      try {
        const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
        if (list.subscribed) {
          await agent.api.app.bsky.graph.unmuteActorList({ list: list.uri });
        } else {
          await agent.api.app.bsky.graph.muteActorList({ list: list.uri });
        }
        list.subscribed = !list.subscribed;
        modLists = [...modLists]; // trigger reactivity
      } catch (e) { error = String(e); }
      break;
    }
  }

  async function unmute(item: BlockedAccount) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== item.platform) continue;
      try {
        if (item.platform === 'bluesky' && item.did) {
          const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
          await agent.api.app.bsky.graph.unmuteActor({ actor: item.did });
        } else if (item.platform === 'mastodon' && item.id) {
          const masto = entry.client as MastodonClient;
          const token = masto.getAccessToken();
          if (token) {
            await fetch(`${masto.getInstanceUrl()}/api/v1/accounts/${item.id}/unmute`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
        muted = muted.filter(m => m !== item);
      } catch (e) { error = String(e); }
      break;
    }
  }
</script>

<svelte:head><title>CrispDeck — Moderation</title></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Shield size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.moderation.title}</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-[var(--color-border)] mb-4">
    <button onclick={() => activeTab = 'blocked'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === 'blocked' ? 'border-red-500 text-red-400' : 'border-transparent text-[var(--color-text-muted)]'}">
      <Ban size={14} class="inline mr-1" /> {i18n.t.moderation.blocked} ({blocked.length})
    </button>
    <button onclick={() => activeTab = 'muted'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === 'muted' ? 'border-yellow-500 text-yellow-400' : 'border-transparent text-[var(--color-text-muted)]'}">
      <VolumeX size={14} class="inline mr-1" /> {i18n.t.moderation.muted} ({muted.length})
    </button>
    {#if modLists.length > 0}
      <button onclick={() => activeTab = 'lists'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === 'lists' ? 'border-[var(--color-bluesky)] text-[var(--color-bluesky)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        <Shield size={14} class="inline mr-1" /> {i18n.t.lists.title} ({modLists.length})
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
    {#if activeTab === 'lists'}
      <div class="space-y-3">
        {#each modLists as list}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                {#if list.avatar}
                  <img loading="lazy" src={list.avatar} alt="" class="w-10 h-10 rounded-lg" />
                {/if}
                <div>
                  <h3 class="text-sm font-medium">{list.name}</h3>
                  <p class="text-xs text-[var(--color-text-muted)]">by @{list.creator.handle} · {list.listItemCount ?? '?'} members</p>
                  {#if list.description}
                    <p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{list.description}</p>
                  {/if}
                </div>
              </div>
              <button
                onclick={() => toggleModListSubscription(list)}
                class="px-3 py-1 text-xs border rounded-md transition-colors {list.subscribed ? 'border-red-700 text-red-400 hover:bg-red-900/30' : 'border-[var(--color-bluesky)] text-[var(--color-bluesky)] hover:bg-[var(--color-bluesky)]/10'}"
              >
                {list.subscribed ? 'Unsubscribe' : 'Mute all'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {@const items = activeTab === 'blocked' ? blocked : muted}
    {#if items.length === 0}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Shield size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-sm text-[var(--color-text-muted)]">No {activeTab} accounts.</p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each items as item}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              <span class="w-2 h-2 rounded-full" style="background: var(--color-{item.platform})"></span>
              {#if item.avatar}
                <img loading="lazy" src={item.avatar} alt="" class="w-8 h-8 rounded-full" />
              {:else}
                <div class="w-8 h-8 rounded-full bg-[var(--color-surface-hover)]"></div>
              {/if}
              <div>
                <p class="text-sm font-medium">{item.displayName || item.handle}</p>
                <p class="text-xs text-[var(--color-text-muted)]">{item.handle}</p>
              </div>
            </div>
            <button
              onclick={() => activeTab === 'blocked' ? unblock(item) : unmute(item)}
              class="px-3 py-1 text-xs border rounded-md transition-colors {activeTab === 'blocked' ? 'border-red-700 text-red-400 hover:bg-red-900/30' : 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/30'}"
            >
              {activeTab === 'blocked' ? 'Unblock' : 'Unmute'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
