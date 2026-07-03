<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Package, Loader2, UserPlus, Users, ExternalLink, Plus, Trash2 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { publishStarterPack, type StarterPackDraft } from '$lib/starter-pack-creator';
  import type { Account } from '$lib/types';

  interface StarterPack {
    uri: string;
    cid: string;
    creator: { handle: string; displayName?: string; avatar?: string };
    record: { name: string; description?: string };
    listItemCount?: number;
    joinedAllTimeCount?: number;
    joinedWeekCount?: number;
    indexedAt: string;
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let searchQuery = $state('');
  let searching = $state(false);
  let packs: StarterPack[] = $state([]);
  let myPacks: StarterPack[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let bskyEntry: ClientEntry | null = $state(null);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      const bskyAcct = accounts.find(a => a.platform === 'bluesky');
      if (bskyAcct) {
        bskyEntry = clientEntries.get(bskyAcct.id) ?? null;
        if (bskyEntry) {
          // Load user's own starter packs
          const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: bskyAcct.handle });
          myPacks = (resp.data.starterPacks ?? []) as unknown as StarterPack[];
        }
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function search() {
    if (!searchQuery.trim() || !bskyEntry) return;
    searching = true;
    error = '';
    try {
      const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
      const allPacks: StarterPack[] = [];
      const seen = new Set<string>();

      // Strategy 1: Direct handle lookup
      if (searchQuery.includes('.') || searchQuery.includes('@')) {
        const handle = searchQuery.replace(/^@/, '');
        try {
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: handle });
          for (const sp of resp.data.starterPacks ?? []) {
            const pack = sp as unknown as StarterPack;
            if (!seen.has(pack.uri)) { seen.add(pack.uri); allPacks.push(pack); }
          }
        } catch {}
      }

      // Strategy 2: Use the official searchStarterPacks API
      // Paginate to get comprehensive results
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        try {
          const resp = await agent.api.app.bsky.graph.searchStarterPacks({
            q: searchQuery.trim(),
            limit: 25,
            cursor,
          });
          for (const sp of resp.data.starterPacks ?? []) {
            const pack = sp as unknown as StarterPack;
            if (!seen.has(pack.uri)) { seen.add(pack.uri); allPacks.push(pack); }
          }
          cursor = resp.data.cursor;
          if (!cursor) break;
        } catch {
          break; // API not available, stop paginating
        }
      }

      // Sort by member count (API results are already relevance-sorted, but tie-break on size)
      const q = searchQuery.toLowerCase();
      allPacks.sort((a, b) => {
        const aName = a.record.name?.toLowerCase() ?? '';
        const aDesc = a.record.description?.toLowerCase() ?? '';
        const bName = b.record.name?.toLowerCase() ?? '';
        const bDesc = b.record.description?.toLowerCase() ?? '';
        const aMatch = (aName.includes(q) ? 4 : 0) + (aDesc.includes(q) ? 2 : 0);
        const bMatch = (bName.includes(q) ? 4 : 0) + (bDesc.includes(q) ? 2 : 0);
        if (aMatch !== bMatch) return bMatch - aMatch;
        return (b.listItemCount ?? 0) - (a.listItemCount ?? 0);
      });

      packs = allPacks;
      if (allPacks.length === 0) {
        error = `No starter packs found for "${searchQuery}". Try a different topic or creator handle.`;
      }
    } catch (e) {
      error = String(e);
    } finally {
      searching = false;
    }
  }

  // Create starter pack
  let showCreate = $state(false);
  let createName = $state('');
  let createDesc = $state('');
  let createHandles = $state('');
  let creating = $state(false);
  let createError = $state('');
  let createSuccess = $state('');

  async function handleCreatePack() {
    if (!createName.trim() || !createHandles.trim() || !bskyEntry) return;
    creating = true;
    createError = '';
    createSuccess = '';

    try {
      const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();

      // Resolve handles to DIDs
      const handles = createHandles.split(/[,\n]/).map(h => h.trim().replace(/^@/, '')).filter(Boolean);
      const members: StarterPackDraft['members'] = [];

      for (const handle of handles) {
        try {
          const profile = await agent.api.app.bsky.actor.getProfile({ actor: handle });
          members.push({
            did: profile.data.did,
            handle: profile.data.handle,
            displayName: profile.data.displayName,
            avatar: profile.data.avatar,
          });
        } catch {
          createError += `Could not resolve @${handle}. `;
        }
      }

      if (members.length === 0) {
        createError = 'No valid members found. Check the handles.';
        creating = false;
        return;
      }

      const draft: StarterPackDraft = {
        name: createName.trim(),
        description: createDesc.trim(),
        members,
      };

      const uri = await publishStarterPack(agent, draft);
      createSuccess = `Starter pack created with ${members.length} members!`;
      createName = '';
      createDesc = '';
      createHandles = '';
      showCreate = false;

      // Reload user's packs
      const bskyAcct = accounts.find(a => a.platform === 'bluesky');
      if (bskyAcct) {
        const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: bskyAcct.handle });
        myPacks = (resp.data.starterPacks ?? []) as unknown as StarterPack[];
      }
    } catch (e) {
      createError = String(e);
    } finally {
      creating = false;
    }
  }

  function getPackUrl(pack: StarterPack): string {
    const rkey = pack.uri.split('/').pop();
    const handle = pack.creator.handle;
    return `https://bsky.app/starter-pack/${handle}/${rkey}`;
  }
</script>

<svelte:head><title>CrispDeck — Starter Packs</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Lists & Feeds tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/lists" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Lists</a>
    <a href="/starterpacks" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Starter Packs</a>
    <a href="/feed-builder" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Feed Builder</a>
  </div>

  <div class="flex items-center gap-2 mb-6">
    <Package size={24} />
    <h1 class="text-2xl font-bold">Starter Packs</h1>
    <span class="text-xs px-2 py-0.5 bg-[var(--color-bluesky)]/20 text-[var(--color-bluesky)] rounded">Bluesky</span>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}
  {#if createError}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{createError}</div>
  {/if}
  {#if createSuccess}
    <div class="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm">{createSuccess}</div>
  {/if}

  <!-- Create starter pack -->
  {#if bskyEntry}
    <div class="mb-6">
      {#if showCreate}
        <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-3">
          <h3 class="text-sm font-semibold">Create Starter Pack</h3>
          <input type="text" bind:value={createName} placeholder="Pack name" class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]" />
          <input type="text" bind:value={createDesc} placeholder="Description (optional)" class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]" />
          <textarea bind:value={createHandles} placeholder="Handles (one per line or comma-separated)&#10;alice.bsky.social&#10;bob.bsky.social" rows="4" class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)] font-mono"></textarea>
          <div class="flex gap-2">
            <button onclick={handleCreatePack} disabled={creating || !createName.trim() || !createHandles.trim()} class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-bluesky)] text-white rounded-md disabled:opacity-50">
              {#if creating}<Loader2 size={14} class="animate-spin" />{:else}<Plus size={14} />{/if}
              Create
            </button>
            <button onclick={() => showCreate = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md">Cancel</button>
          </div>
        </div>
      {:else}
        <button onclick={() => showCreate = true} class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-bluesky)] text-white rounded-md hover:opacity-90">
          <Plus size={14} /> Create Starter Pack
        </button>
      {/if}
    </div>
  {/if}

  <!-- Search -->
  <form onsubmit={(e) => { e.preventDefault(); search(); }} class="mb-6">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search for starter packs by creator..."
        class="flex-1 px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]"
      />
      <button type="submit" disabled={searching || !bskyEntry} class="px-5 py-3 bg-[var(--color-bluesky)] text-white text-sm font-medium rounded-lg disabled:opacity-50">
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}Search{/if}
      </button>
    </div>
  </form>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
    <!-- My starter packs -->
    {#if myPacks.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">{i18n.t.starterPacks.yourPacks}</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {#each myPacks as pack}
          <a href={getPackUrl(pack)} target="_blank" rel="noopener noreferrer" class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-medium text-sm">{pack.record.name}</h3>
              <ExternalLink size={12} class="text-[var(--color-text-muted)]" />
            </div>
            {#if pack.record.description}
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-2 mb-2">{pack.record.description}</p>
            {/if}
            <div class="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
              <span class="flex items-center gap-1"><Users size={10} /> {pack.listItemCount ?? '?'} members</span>
              {#if pack.joinedAllTimeCount}
                <span class="flex items-center gap-1"><UserPlus size={10} /> {pack.joinedAllTimeCount} joined</span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}

    <!-- Search results -->
    {#if packs.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">{i18n.t.starterPacks.searchResults}</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each packs as pack}
          <a href={getPackUrl(pack)} target="_blank" rel="noopener noreferrer" class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors">
            <div class="flex items-start gap-3">
              {#if pack.creator.avatar}
                <img loading="lazy" src={pack.creator.avatar} alt="" class="w-8 h-8 rounded-full" />
              {/if}
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm">{pack.record.name}</h3>
                <p class="text-xs text-[var(--color-text-muted)]">by @{pack.creator.handle}</p>
                {#if pack.record.description}
                  <p class="text-xs text-[var(--color-text-muted)] line-clamp-2 mt-1">{pack.record.description}</p>
                {/if}
                <div class="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
                  <span><Users size={10} class="inline" /> {pack.listItemCount ?? '?'} members</span>
                  {#if pack.joinedAllTimeCount}<span><UserPlus size={10} class="inline" /> {pack.joinedAllTimeCount} joined</span>{/if}
                </div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

    {#if !loading && !bskyEntry}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Package size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-sm text-[var(--color-text-muted)]">Add a Bluesky account in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to browse starter packs.</p>
      </div>
    {/if}
  {/if}
</div>
