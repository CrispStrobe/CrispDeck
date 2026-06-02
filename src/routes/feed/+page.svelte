<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Rss, Loader2, Inbox, EyeOff } from '@lucide/svelte';
  import Post from '$lib/components/Post.svelte';
  import CrosspostGroup from '$lib/components/CrosspostGroup.svelte';
  import AdvancedFilters from '$lib/components/AdvancedFilters.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, filterPosts, sortPosts, detectCrossposts } from '$lib/api/unified';
  import type { UnifiedPost, FeedItem, Filters, Account, CrosspostGroup as CrosspostGroupType } from '$lib/types';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let initialLoading = $state(true);
  let error = $state('');
  let progress = $state(0);
  let hideMedia = $state(false);

  let cursors: Record<number, string | undefined> = $state({});
  let loadingMore: Record<number, boolean> = $state({});
  let loadingAll = $state(false);

  let filters: Filters = $state({
    searchTerm: '',
    sortBy: 'newest',
    hasMedia: false,
    hideReplies: false,
    hideReposts: false,
    minLikes: 0,
  });

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    try {
      accounts = await listAccounts();
      if (accounts.length > 0) {
        await initClients();
        await loadInitialFeeds();
      }
    } catch (e) {
      error = String(e);
    } finally {
      initialLoading = false;
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);

        if (acct.platform === 'bluesky') {
          clients.set(acct.id, new BlueskyClient(acct.handle, creds.app_password));
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

  async function loadInitialFeeds() {
    loading = true;
    const allPosts: UnifiedPost[] = [];

    for (const acct of accounts) {
      try {
        const client = clients.get(acct.id);
        if (!client) continue;

        if (acct.platform === 'bluesky') {
          const bsky = client as BlueskyClient;
          const result = await bsky.getAuthorFeed(acct.handle);
          const normalized = result.feed.map(p => normalizePost(p, 'bluesky'));
          allPosts.push(...normalized);
          cursors[acct.id] = result.cursor;
        } else {
          const masto = client as MastodonClient;
          const account = await masto.getAccountByHandle(acct.handle);
          const statuses = await masto.getAccountStatuses(account.id);
          const normalized = statuses.map(p => normalizePost(p, 'mastodon'));
          allPosts.push(...normalized);
          cursors[acct.id] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
        }
      } catch (e) {
        console.error(`Failed to load feed for ${acct.handle}:`, e);
      }
    }

    posts = allPosts.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    progress = posts.length;
    loading = false;
  }

  async function loadMore(accountId: number) {
    const cursor = cursors[accountId];
    if (!cursor) return;

    const acct = accounts.find(a => a.id === accountId);
    const client = clients.get(accountId);
    if (!acct || !client) return;

    loadingMore[accountId] = true;
    try {
      let newPosts: UnifiedPost[] = [];

      if (acct.platform === 'bluesky') {
        const bsky = client as BlueskyClient;
        const result = await bsky.getAuthorFeed(acct.handle, cursor);
        newPosts = result.feed.map(p => normalizePost(p, 'bluesky'));
        cursors[accountId] = result.cursor;
      } else {
        const masto = client as MastodonClient;
        const account = await masto.getAccountByHandle(acct.handle);
        const statuses = await masto.getAccountStatuses(account.id, cursor);
        newPosts = statuses.map(p => normalizePost(p, 'mastodon'));
        cursors[accountId] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
      }

      posts = [...posts, ...newPosts].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      progress = posts.length;
    } catch (e) {
      error = `Failed to load more from ${acct.handle}: ${e}`;
    } finally {
      loadingMore[accountId] = false;
    }
  }

  async function loadAll() {
    loadingAll = true;
    for (const acct of accounts) {
      let cursor = cursors[acct.id];
      const client = clients.get(acct.id);
      if (!client) continue;

      while (cursor) {
        try {
          let newPosts: UnifiedPost[] = [];

          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            const result = await bsky.getAuthorFeed(acct.handle, cursor);
            newPosts = result.feed.map(p => normalizePost(p, 'bluesky'));
            cursor = result.cursor;
            cursors[acct.id] = cursor;
          } else {
            const masto = client as MastodonClient;
            const account = await masto.getAccountByHandle(acct.handle);
            const statuses = await masto.getAccountStatuses(account.id, cursor);
            newPosts = statuses.map(p => normalizePost(p, 'mastodon'));
            cursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
            cursors[acct.id] = cursor;
          }

          posts = [...posts, ...newPosts].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          progress = posts.length;
        } catch {
          cursor = undefined;
        }
      }
    }
    loadingAll = false;
  }

  function handleFilterChange(newFilters: Partial<Filters>) {
    filters = { ...filters, ...newFilters };
  }

  function isCrosspostGroup(item: FeedItem): item is CrosspostGroupType {
    return 'type' in item && item.type === 'crosspost';
  }

  const filtered = $derived(filterPosts(posts, filters));
  const sorted = $derived(sortPosts(filtered, filters.sortBy));
  const finalFeed = $derived(detectCrossposts(sorted));
  const hasMoreContent = $derived(Object.values(cursors).some(c => !!c));
  const isLoading = $derived(loading || loadingAll || Object.values(loadingMore).some(v => v));
</script>

<div class="p-6">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <Rss size={24} />
      <h1 class="text-2xl font-bold">Feed</h1>
      {#if posts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({progress} posts loaded)</span>
      {/if}
    </div>
    <label class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
      <input type="checkbox" bind:checked={hideMedia} class="rounded" />
      <EyeOff size={14} />
      Hide Media
    </label>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if initialLoading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if accounts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Accounts Connected</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Add accounts in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> first.</p>
    </div>
  {:else}
    <AdvancedFilters {filters} onchange={handleFilterChange} />

    {#if isLoading && posts.length === 0}
      <div class="text-center py-12">
        <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
        <p class="text-sm text-[var(--color-text-muted)] mt-2">Loading feeds...</p>
      </div>
    {:else if finalFeed.length === 0}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">
          {posts.length > 0 ? 'No Posts Match Your Filters' : 'No Posts Found'}
        </h3>
      </div>
    {:else}
      <div class="space-y-3">
        {#each finalFeed as item (isCrosspostGroup(item) ? item.id : item.uri)}
          {#if isCrosspostGroup(item)}
            <CrosspostGroup group={item} {hideMedia} />
          {:else}
            <Post post={item} {hideMedia} />
          {/if}
        {/each}
      </div>
    {/if}

    {#if hasMoreContent && !initialLoading}
      <div class="text-center mt-6 flex flex-wrap items-center justify-center gap-3">
        {#each accounts as acct}
          {#if cursors[acct.id]}
            <button
              onclick={() => loadMore(acct.id)}
              disabled={loadingMore[acct.id] || loadingAll}
              class="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 flex items-center gap-2"
              style="background: {acct.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"
            >
              {#if loadingMore[acct.id]}<Loader2 size={14} class="animate-spin" />{/if}
              More ({acct.handle})
            </button>
          {/if}
        {/each}
        <button
          onclick={loadAll}
          disabled={loadingAll || !hasMoreContent}
          class="px-4 py-2 text-sm font-medium text-white bg-[var(--color-success)] rounded-md disabled:opacity-50 flex items-center gap-2"
        >
          {#if loadingAll}<Loader2 size={14} class="animate-spin" />{/if}
          {loadingAll ? `Loading... (${progress})` : 'Load All Posts'}
        </button>
      </div>
    {/if}
  {/if}
</div>
