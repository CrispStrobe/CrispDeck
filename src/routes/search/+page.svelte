<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Search, Loader2, Inbox } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { normalizePost } from '$lib/api/unified';
  import { searchMastodon, searchThreads, mergeSearchResults } from '$lib/universal-search';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let searching = $state(false);
  let error = $state('');
  let query = $state('');
  let results: UnifiedPost[] = $state([]);
  let hasSearched = $state(false);

  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      // Auto-search from URL params (e.g. /search?q=%23hashtag)
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) {
        query = q;
        await handleSearch();
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function handleSearch() {
    if (!query.trim()) return;
    searching = true;
    error = '';
    results = [];
    hasSearched = true;

    const resultsByPlatform = new Map<Platform, UnifiedPost[]>();

    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;

      try {
        if (acct.platform === 'bluesky') {
          const bsky = entry.client as BlueskyClient;
          const resp = await bsky.searchPosts(query.trim());
          const normalized = resp.posts.map(post => ({
            uri: post.uri,
            text: (post.record as any).text ?? '',
            author: {
              handle: post.author.handle,
              displayName: post.author.displayName,
              avatar: post.author.avatar,
            },
            createdAt: (post.record as any).createdAt ?? post.indexedAt,
            platform: 'bluesky' as const,
            replyCount: post.replyCount,
            repostCount: post.repostCount,
            likeCount: post.likeCount,
            isRepost: false,
            embeds: post.embed,
            raw: post,
          }));
          resultsByPlatform.set('bluesky', [...(resultsByPlatform.get('bluesky') ?? []), ...normalized]);
        } else if (acct.platform === 'mastodon') {
          const masto = entry.client as MastodonClient;
          const token = masto.getAccessToken();
          if (!token) continue;
          const statuses = await searchMastodon(query.trim(), masto.getInstanceUrl(), token, 40);
          const normalized = statuses.map((s: any) => normalizePost(s, 'mastodon'));
          resultsByPlatform.set('mastodon', [...(resultsByPlatform.get('mastodon') ?? []), ...normalized]);
        } else if (acct.platform === 'threads') {
          const threads = entry.client as ThreadsClient;
          const token = threads.getAccessToken?.();
          if (!token) continue;
          const threadsPosts = await searchThreads(query.trim(), token, 25);
          const normalized = threadsPosts.map((p: any) => threads.normalizePost(p));
          resultsByPlatform.set('threads', [...(resultsByPlatform.get('threads') ?? []), ...normalized]);
        }
      } catch (e) {
        console.error(`Search failed for ${acct.handle}:`, e);
      }
    }

    // Merge with engagement/recency scoring and URI dedup
    const merged = mergeSearchResults(resultsByPlatform);
    results = merged.posts;
    searching = false;
  }
</script>

<svelte:head><title>CrispDeck — Search</title><meta name="description" content="Search posts across all connected accounts" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Search size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.search.title}</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Search bar -->
  <form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} class="mb-6">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={query}
        placeholder={i18n.t.search.placeholder}
        class="flex-1 px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
      />
      <button
        type="submit"
        disabled={searching || !query.trim() || accounts.length === 0}
        class="flex items-center gap-2 px-5 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
      >
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}<Search size={14} />{/if}
        {i18n.t.search.button}
      </button>
    </div>
    {#if accounts.length > 0}
      <p class="text-xs text-[var(--color-text-muted)] mt-2">
        Searching across {accounts.length} connected account{accounts.length > 1 ? 's' : ''} ({accounts.map(a => i18n.t.common[a.platform] ?? a.platform).join(', ')})
      </p>
    {/if}
  </form>

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if searching}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      <p class="text-sm text-[var(--color-text-muted)] mt-2">{i18n.t.search.searching}</p>
    </div>
  {:else if hasSearched && results.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noResults}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.search.noPostsFor.replace('{query}', query)}</p>
    </div>
  {:else if results.length > 0}
    <p class="text-sm text-[var(--color-text-muted)] mb-4">{results.length} results (ranked by engagement + recency)</p>
    <div class="space-y-3">
      {#each results as post (post.uri)}
        <Post {post} />
      {/each}
    </div>
  {:else if accounts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Search size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noAccounts}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Add accounts in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to search.</p>
    </div>
  {:else}
    <!-- Pre-search suggestions -->
    <div class="text-center py-12">
      <Search size={40} class="text-[var(--color-text-muted)]/40 mx-auto mb-4" />
      <h3 class="text-base font-medium text-[var(--color-text-muted)] mb-3">Search across all your networks</h3>
      <div class="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
        {#each ['#news', '#photography', '#tech', '#fediverse', '#art'] as tag}
          <button
            onclick={() => { query = tag; handleSearch(); }}
            class="px-3 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]/50 transition-colors"
          >{tag}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>
