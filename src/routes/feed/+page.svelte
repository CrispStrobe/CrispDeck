<script lang="ts">
  import { onMount } from 'svelte';
  import { Rss, Loader2, Inbox, EyeOff, User, Globe, SlidersHorizontal } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import Post from '$lib/components/Post.svelte';
  import CrosspostGroup from '$lib/components/CrosspostGroup.svelte';
  import AdvancedFilters from '$lib/components/AdvancedFilters.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { normalizePost, filterPosts, sortPosts, detectCrossposts } from '$lib/api/unified';
  import type { UnifiedPost, FeedItem, Filters, Account, CrosspostGroup as CrosspostGroupType } from '$lib/types';

  type FeedMode = 'timeline' | 'my-posts';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let initialLoading = $state(true);
  let error = $state('');
  let progress = $state(0);
  let hideMedia = $state(false);
  let feedMode: FeedMode = $state('timeline');
  let platformFilter: 'all' | 'bluesky' | 'mastodon' = $state('all');
  let showFilters = $state(false);

  let cursors: Record<number, string | undefined> = $state({});
  let loadingMore = $state(false);

  let filters: Filters = $state({
    searchTerm: '',
    sortBy: 'newest',
    hasMedia: false,
    hideReplies: false,
    hideReposts: false,
    minLikes: 0,
  });

  let clientEntries: Map<number, ClientEntry> = new Map();

  // Infinite scroll
  let scrollSentinel: HTMLDivElement | undefined = $state();
  let observer: IntersectionObserver | undefined;

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      if (accounts.length > 0) {
        await loadFeed();
      }
    } catch (e) {
      error = String(e);
    } finally {
      initialLoading = false;
    }

    // Poll for new posts every 60 seconds
    const pollInterval = setInterval(checkForNewPosts, 60000);
    return () => { observer?.disconnect(); clearInterval(pollInterval); };
  });

  let newPostsAvailable = $state(0);

  async function checkForNewPosts() {
    if (posts.length === 0 || loading) return;
    const newestDate = posts[0]?.createdAt;
    if (!newestDate) return;

    let count = 0;
    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;
      try {
        if (acct.platform === 'bluesky' && entry.oauthAgent) {
          const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 10 });
          count += r.data.feed.filter(p => {
            const record = p.post.record as any;
            return record?.createdAt > newestDate;
          }).length;
        } else if (acct.platform === 'mastodon') {
          const masto = entry.client as MastodonClient;
          try {
            const statuses = await masto.getHomeTimeline();
            count += statuses.filter((s: any) => s.createdAt > newestDate || s.created_at > newestDate).length;
          } catch {}
        }
      } catch {}
    }
    newPostsAvailable = count; // Replace, don't accumulate
  }

  async function loadNewPosts() {
    // Prepend new posts instead of reloading everything
    newPostsAvailable = 0;
    const newestDate = posts[0]?.createdAt;
    const newPosts: UnifiedPost[] = [];

    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;
      try {
        if (acct.platform === 'bluesky') {
          if (entry.oauthAgent) {
            const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50 });
            const newer = r.data.feed
              .map(p => normalizePost(p, 'bluesky'))
              .filter(p => !newestDate || p.createdAt > newestDate);
            newPosts.push(...newer);
          }
        } else {
          const masto = entry.client as MastodonClient;
          const statuses = await masto.getHomeTimeline();
          const newer = statuses
            .map((s: any) => normalizePost(s, 'mastodon'))
            .filter(p => !newestDate || p.createdAt > newestDate);
          newPosts.push(...newer);
        }
      } catch {}
    }

    if (newPosts.length > 0) {
      // Prepend new posts, deduplicating by URI
      const existingUris = new Set(posts.map(p => p.uri));
      const unique = newPosts.filter(p => !existingUris.has(p.uri));
      posts = sortPosts([...unique, ...posts], 'newest');
      progress = posts.length;
    }
  }

  // Reactive infinite scroll — observes sentinel whenever it appears in DOM
  $effect(() => {
    if (!scrollSentinel) return;
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loadingMore && hasMoreContent) {
        loadMore();
      }
    }, { rootMargin: '600px' });
    observer.observe(scrollSentinel);
  });

  async function loadFeed() {
    loading = true;
    posts = [];
    cursors = {};
    const allPosts: UnifiedPost[] = [];

    for (const acct of accounts) {
      try {
        const entry = clientEntries.get(acct.id);
        if (!entry) continue;

        if (acct.platform === 'bluesky') {
          if (feedMode === 'timeline') {
            // Use OAuth agent for timeline if available (has full access)
            if (entry.oauthAgent) {
              const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50 });
              allPosts.push(...r.data.feed.map(p => normalizePost(p, 'bluesky')));
              cursors[acct.id] = r.data.cursor;
            } else {
              const bsky = entry.client as BlueskyClient;
              try {
                const result = await bsky.getTimeline();
                allPosts.push(...result.feed.map(p => normalizePost(p, 'bluesky')));
                cursors[acct.id] = result.cursor;
              } catch {
                // Fall back to author feed if timeline auth fails
                const result = await bsky.getAuthorFeed(acct.handle);
                allPosts.push(...result.feed.map(p => normalizePost(p, 'bluesky')));
                cursors[acct.id] = result.cursor;
              }
            }
          } else {
            const bsky = entry.client as BlueskyClient;
            const result = await bsky.getAuthorFeed(acct.handle);
            allPosts.push(...result.feed.map(p => normalizePost(p, 'bluesky')));
            cursors[acct.id] = result.cursor;
          }
        } else {
          const masto = entry.client as MastodonClient;
          if (feedMode === 'timeline') {
            const statuses = await masto.getHomeTimeline();
            allPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
            cursors[acct.id] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
          } else {
            const account = await masto.getAccountByHandle(acct.handle);
            const statuses = await masto.getAccountStatuses(account.id);
            allPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
            cursors[acct.id] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
          }
        }
      } catch (e) {
        console.error(`Failed to load feed for ${acct.handle}:`, e);
        error = (error ? error + '\n' : '') + `${acct.platform}/${acct.handle}: ${e}`;
      }
    }

    posts = sortPosts(allPosts, 'newest');
    progress = posts.length;
    loading = false;
  }

  async function loadMore() {
    if (loadingMore || !hasMoreContent) return;
    loadingMore = true;

    const newPosts: UnifiedPost[] = [];

    for (const acct of accounts) {
      const cursor = cursors[acct.id];
      if (!cursor) continue;

      const entry = clientEntries.get(acct.id);
      if (!entry) continue;

      try {
        if (acct.platform === 'bluesky') {
          if (feedMode === 'timeline' && entry.oauthAgent) {
            const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50, cursor });
            newPosts.push(...r.data.feed.map(p => normalizePost(p, 'bluesky')));
            cursors[acct.id] = r.data.cursor;
          } else {
            const bsky = entry.client as BlueskyClient;
            const result = await bsky.getAuthorFeed(acct.handle, cursor);
            newPosts.push(...result.feed.map(p => normalizePost(p, 'bluesky')));
            cursors[acct.id] = result.cursor;
          }
        } else {
          const masto = entry.client as MastodonClient;
          if (feedMode === 'timeline') {
            const statuses = await masto.getHomeTimeline(cursor);
            newPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
            cursors[acct.id] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
          } else {
            const account = await masto.getAccountByHandle(acct.handle);
            const statuses = await masto.getAccountStatuses(account.id, cursor);
            newPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
            cursors[acct.id] = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
          }
        }
      } catch (e) {
        console.error(`Failed to load more from ${acct.handle}:`, e);
      }
    }

    if (newPosts.length > 0) {
      // Append older posts at the end — no re-sort needed since pagination
      // goes backward. Deduplicate by URI to avoid dupes across accounts.
      const existingUris = new Set(posts.map(p => p.uri));
      const unique = sortPosts(newPosts.filter(p => !existingUris.has(p.uri)), 'newest');
      posts = [...posts, ...unique];
      progress = posts.length;
    }
    loadingMore = false;
  }

  async function switchMode(mode: FeedMode) {
    if (mode === feedMode) return;
    feedMode = mode;
    await loadFeed();
  }

  async function handleLike(post: UnifiedPost) {
    for (const [, entry] of clientEntries) {
      if (entry.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          if (entry.oauthAgent) {
            await entry.oauthAgent.like(raw.post.uri, raw.post.cid);
          } else {
            await (entry.client as BlueskyClient).like(raw.post.uri, raw.post.cid);
          }
        } else {
          await (entry.client as MastodonClient).favourite((post.raw as any).id);
        }
        return;
      } catch (e) {
        console.error('Like failed:', e);
      }
    }
  }

  async function handleBoost(post: UnifiedPost) {
    for (const [, entry] of clientEntries) {
      if (entry.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          if (entry.oauthAgent) {
            await entry.oauthAgent.repost(raw.post.uri, raw.post.cid);
          } else {
            await (entry.client as BlueskyClient).repost(raw.post.uri, raw.post.cid);
          }
        } else {
          await (entry.client as MastodonClient).reblog((post.raw as any).id);
        }
        return;
      } catch (e) {
        console.error('Boost failed:', e);
      }
    }
  }

  function handleReply(post: UnifiedPost) {
    const replyTo = encodeURIComponent(post.uri);
    const author = encodeURIComponent(post.author.handle);
    window.location.href = `/compose?replyTo=${replyTo}&author=${author}&platform=${post.platform}`;
  }

  function handleQuote(post: UnifiedPost) {
    const quoteUri = encodeURIComponent(post.uri);
    const quoteCid = encodeURIComponent((post.raw as any)?.post?.cid ?? '');
    const author = encodeURIComponent(post.author.handle);
    const text = encodeURIComponent(post.text.substring(0, 100));
    window.location.href = `/compose?quoteUri=${quoteUri}&quoteCid=${quoteCid}&quoteAuthor=${author}&quoteText=${text}&platform=${post.platform}`;
  }

  function handleFilterChange(newFilters: Partial<Filters>) {
    filters = { ...filters, ...newFilters };
  }

  function isCrosspostGroup(item: FeedItem): item is CrosspostGroupType {
    return 'type' in item && item.type === 'crosspost';
  }

  const platformFiltered = $derived(
    platformFilter === 'all' ? posts : posts.filter(p => p.platform === platformFilter)
  );
  const filtered = $derived(filterPosts(platformFiltered, filters));
  const sorted = $derived(sortPosts(filtered, filters.sortBy));
  const finalFeed = $derived(detectCrossposts(sorted));
  const hasMoreContent = $derived(Object.values(cursors).some(c => !!c));
  const isLoading = $derived(loading || loadingMore);
</script>

<div class="p-6">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <Rss size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.feed.title}</h1>
      {#if posts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({progress} posts)</span>
      {/if}
    </div>
    <div class="flex items-center gap-3">
      <!-- Feed mode toggle -->
      <div class="flex items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
        <button
          onclick={() => switchMode('timeline')}
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'timeline' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          <Globe size={12} />
          {i18n.t.feed.timeline}
        </button>
        <button
          onclick={() => switchMode('my-posts')}
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'my-posts' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          <User size={12} />
          {i18n.t.feed.myPosts}
        </button>
      </div>

      <!-- Platform filter -->
      <div class="flex items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
        <button
          onclick={() => platformFilter = 'all'}
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors {platformFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
        >{i18n.t.feed.all}</button>
        <button
          onclick={() => platformFilter = 'bluesky'}
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'bluesky' ? 'bg-[var(--color-bluesky)] text-white' : 'text-[var(--color-text-muted)]'}"
        ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-bluesky)]"></span> Bsky</button>
        <button
          onclick={() => platformFilter = 'mastodon'}
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'mastodon' ? 'bg-[var(--color-mastodon)] text-white' : 'text-[var(--color-text-muted)]'}"
        ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-mastodon)]"></span> Masto</button>
      </div>

      <button
        onclick={() => showFilters = !showFilters}
        class="p-1.5 rounded-md transition-colors {showFilters ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        title="Filters & Sort"
      >
        <SlidersHorizontal size={16} />
      </button>

      <button
        onclick={() => hideMedia = !hideMedia}
        class="p-1.5 rounded-md transition-colors {hideMedia ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        title="Hide media"
      >
        <EyeOff size={14} />
      </button>
    </div>
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
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.feed.noAccounts}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.feed.addAccountsFirst}</p>
    </div>
  {:else}
    {#if showFilters}
      <AdvancedFilters {filters} onchange={handleFilterChange} startOpen={true} />
    {/if}

    <!-- New posts banner -->
    {#if newPostsAvailable > 0}
      <button
        onclick={loadNewPosts}
        class="w-full mb-3 py-2 bg-[var(--color-primary)]/20 text-[var(--color-primary)] text-sm font-medium rounded-lg hover:bg-[var(--color-primary)]/30 transition-colors"
      >
        {newPostsAvailable} new post{newPostsAvailable > 1 ? 's' : ''} available — click to refresh
      </button>
    {/if}

    {#if loading && posts.length === 0}
      <div class="text-center py-12">
        <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
        <p class="text-sm text-[var(--color-text-muted)] mt-2">
          {feedMode === 'timeline' ? i18n.t.feed.loadingTimeline : i18n.t.feed.loadingYourPosts}
        </p>
      </div>
    {:else if finalFeed.length === 0}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">
          {posts.length > 0 ? i18n.t.feed.noPostsMatch : i18n.t.feed.noPostsFound}
        </h3>
      </div>
    {:else}
      <div class="space-y-3">
        {#each finalFeed as item (isCrosspostGroup(item) ? item.id : item.uri)}
          {#if isCrosspostGroup(item)}
            <CrosspostGroup group={item} {hideMedia} />
          {:else}
            <Post post={item} {hideMedia} onlike={handleLike} onboost={handleBoost} onreply={handleReply} onquote={handleQuote} />
          {/if}
        {/each}
      </div>

      <!-- Infinite scroll sentinel + loading indicator -->
      <div bind:this={scrollSentinel} class="py-6 text-center">
        {#if loadingMore}
          <Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
          <p class="text-xs text-[var(--color-text-muted)] mt-2">{i18n.t.feed.loadingMore}</p>
        {:else if hasMoreContent}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.scrollMore}</p>
        {:else}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.endOfFeed}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>
