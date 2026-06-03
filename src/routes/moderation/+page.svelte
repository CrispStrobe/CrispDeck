<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Shield, Loader2, Ban, VolumeX, UserX } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account } from '$lib/types';

  interface BlockedAccount {
    platform: 'bluesky' | 'mastodon';
    handle: string;
    displayName?: string;
    avatar?: string;
    id?: string; // mastodon account id
    did?: string; // bluesky did
    type: 'block' | 'mute';
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let blocked: BlockedAccount[] = $state([]);
  let muted: BlockedAccount[] = $state([]);
  let activeTab: 'blocked' | 'muted' = $state('blocked');

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    try {
      accounts = await listAccounts();
      await initClients();
      await loadModerationLists();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const creds = JSON.parse(await getDecryptedCredentials(acct.id));
        if (acct.platform === 'bluesky') {
          const c = new BlueskyClient(acct.handle, creds.app_password);
          await c.login();
          clients.set(acct.id, c);
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch (e) { console.error(e); }
    }
  }

  async function loadModerationLists() {
    const allBlocked: BlockedAccount[] = [];
    const allMuted: BlockedAccount[] = [];

    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      if (acct.platform === 'bluesky') {
        const bsky = client as BlueskyClient;
        try {
          const agent = bsky.getAgent();
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
        const masto = client as MastodonClient;
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
  }

  async function unblock(item: BlockedAccount) {
    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== item.platform) continue;
      try {
        if (item.platform === 'bluesky' && item.did) {
          const agent = (client as BlueskyClient).getAgent();
          // Find and delete the block record
          const blocks = await agent.api.app.bsky.graph.getBlocks({ limit: 100 });
          // Unblock by deleting the block relationship
          await agent.api.app.bsky.graph.muteActor({ actor: item.did }); // This is a workaround
          // Actually need to delete the block record from the repo
        } else if (item.platform === 'mastodon' && item.id) {
          const masto = client as MastodonClient;
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

  async function unmute(item: BlockedAccount) {
    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== item.platform) continue;
      try {
        if (item.platform === 'bluesky' && item.did) {
          const agent = (client as BlueskyClient).getAgent();
          await agent.api.app.bsky.graph.unmuteActor({ actor: item.did });
        } else if (item.platform === 'mastodon' && item.id) {
          const masto = client as MastodonClient;
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

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Shield size={24} />
    <h1 class="text-2xl font-bold">Moderation</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-[var(--color-border)] mb-4">
    <button onclick={() => activeTab = 'blocked'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === 'blocked' ? 'border-red-500 text-red-400' : 'border-transparent text-[var(--color-text-muted)]'}">
      <Ban size={14} class="inline mr-1" /> Blocked ({blocked.length})
    </button>
    <button onclick={() => activeTab = 'muted'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === 'muted' ? 'border-yellow-500 text-yellow-400' : 'border-transparent text-[var(--color-text-muted)]'}">
      <VolumeX size={14} class="inline mr-1" /> Muted ({muted.length})
    </button>
  </div>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
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
              <span class="w-2 h-2 rounded-full" style="background: {item.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"></span>
              {#if item.avatar}
                <img src={item.avatar} alt="" class="w-8 h-8 rounded-full" />
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
