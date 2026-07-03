<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Rss, Loader2, Inbox, EyeOff, User, Globe, SlidersHorizontal, RefreshCw } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import Post from '$lib/components/Post.svelte';
  import CrosspostGroup from '$lib/components/CrosspostGroup.svelte';
  import SkeletonPost from '$lib/components/SkeletonPost.svelte';
  import AdvancedFilters from '$lib/components/AdvancedFilters.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { notifyNewPosts, getPermission } from '$lib/push-notifications';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { normalizePost, filterPosts, sortPosts, detectCrossposts, buildIdentityPairs } from '$lib/api/unified';
  import { listIdentities } from '$lib/db';
  import type { UnifiedPost, FeedItem, Filters, Account, Platform, CrosspostGroup as CrosspostGroupType } from '$lib/types';
  import { buildAffinityMap, rankForYou } from '$lib/for-you';
  import { syncMutedWordsFromServer } from '$lib/bluesky-prefs';
  import { searchArchive } from '$lib/archive';
  import { jetstream } from '$lib/jetstream';
  import { applyMuteFilter } from '$lib/muted-words';
  import { saveReadPosition, getReadPosition } from '$lib/read-position';
  import { getCached, setCache } from '$lib/view-cache';

  type FeedMode = 'timeline' | 'my-posts' | 'for-you';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let initialLoading = $state(true);
  let error = $state('');
  let progress = $state(0);
  let hideMedia = $state(false);
  let feedMode: FeedMode = $state('timeline');
  let platformFilter: 'all' | Platform = $state('all');
  let showFilters = $state(false);
  const connectedPlatforms = $derived(new Set(accounts.map(a => a.platform)));
  const multiPlatform = $derived(connectedPlatforms.size > 1);

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
  let identityPairs: Set<string> = $state(new Set());
  let affinityMap: Map<string, number> = $state(new Map());

  // Infinite scroll
  let scrollSentinel: HTMLDivElement | undefined = $state();
  let observer: IntersectionObserver | undefined;

  // Pull-to-refresh
  let pullStartY = 0;
  let pullDistance = $state(0);
  let isPulling = $state(false);
  let pullRefreshing = $state(false);

  const multiAccount = $derived(accounts.length > 1);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      // Sync Bluesky server muted words (non-blocking)
      for (const [, entry] of clientEntries) {
        if (entry.oauthAgent) syncMutedWordsFromServer(entry.oauthAgent);
      }
      // Load confirmed identities for crosspost dedup + affinity for "For You"
      try {
        const ids = await listIdentities({ confirmed_only: true });
        identityPairs = buildIdentityPairs(ids);
      } catch { /* non-critical */ }
      try {
        const [liked, reposted, replied] = await Promise.all([
          searchArchive({ type: 'like', limit: 500 }),
          searchArchive({ type: 'repost', limit: 500 }),
          searchArchive({ type: 'reply', limit: 500 }),
        ]);
        affinityMap = buildAffinityMap(liked, reposted, replied);
      } catch { /* archive may not exist yet */ }
      // Start Jetstream if enabled
      if (localStorage.getItem('crispdeck-live-counters') === 'true') {
        jetstream.setEnabled(true);
      }
      // Show cached feed instantly while fresh data loads
      const cached = getCached<UnifiedPost[]>('feed-' + feedMode);
      if (cached) {
        posts = cached.data;
        initialLoading = false;
      }
      if (accounts.length > 0) {
        await loadFeed();
        // Restore scroll position after feed loads
        requestAnimationFrame(() => {
          const saved = getReadPosition('feed');
          if (saved?.scrollY) {
            const main = document.getElementById('main-content');
            if (main) main.scrollTop = saved.scrollY;
          }
        });
      }
    } catch (e) {
      error = String(e);
    } finally {
      initialLoading = false;
    }

    // Poll for new posts every 60 seconds, skip when tab is hidden
    const pollInterval = setInterval(() => {
      if (!document.hidden) checkForNewPosts();
    }, 60000);
    return () => { observer?.disconnect(); clearInterval(pollInterval); };
  });

  onDestroy(() => {
    const main = document.getElementById('main-content');
    const topPost = posts[0]?.uri;
    if (topPost) {
      saveReadPosition('feed', topPost, main?.scrollTop);
    }
  });

  let newPostsAvailable = $state(0);

  async function checkForNewPosts() {
    if (posts.length === 0 || loading) return;
    const newestDate = posts[0]?.createdAt;
    if (!newestDate) return;

    const results = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return 0;
      if (acct.platform === 'bluesky' && entry.oauthAgent) {
        const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 10 });
        return r.data.feed.filter(p => {
          const record = p.post.record as any;
          return record?.createdAt > newestDate;
        }).length;
      } else if (acct.platform === 'mastodon') {
        const masto = entry.client as MastodonClient;
        const statuses = await masto.getHomeTimeline();
        return statuses.filter((s: any) => s.createdAt > newestDate || s.created_at > newestDate).length;
      } else if (acct.platform === 'threads') {
        const threads = entry.client as ThreadsClient;
        const posts = await threads.getOwnPosts(10);
        return posts.filter(p => p.timestamp > newestDate).length;
      }
      return 0;
    }));
    const count = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
    newPostsAvailable = count; // Replace, don't accumulate

    // Send push notification if page is not visible and we have new posts
    if (count > 0 && document.hidden) {
      const perm = await getPermission();
      if (perm === 'granted') {
        notifyNewPosts(count);
      }
    }
  }

  async function loadNewPosts() {
    // Prepend new posts instead of reloading everything
    newPostsAvailable = 0;
    const newestDate = posts[0]?.createdAt;
    const results = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return [];
      if (acct.platform === 'bluesky' && entry.oauthAgent) {
        const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50 });
        return r.data.feed
          .map(p => normalizePost(p, 'bluesky'))
          .filter(p => !newestDate || p.createdAt > newestDate);
      } else if (acct.platform === 'mastodon') {
        const masto = entry.client as MastodonClient;
        const statuses = await masto.getHomeTimeline();
        return statuses
          .map((s: any) => normalizePost(s, 'mastodon'))
          .filter(p => !newestDate || p.createdAt > newestDate);
      } else if (acct.platform === 'threads') {
        const threads = entry.client as ThreadsClient;
        const threadsPosts = await threads.getOwnPosts(25);
        return threadsPosts.map(p => normalizePost(p, 'threads')).filter(p => !newestDate || p.createdAt > newestDate);
      }
      return [];
    }));
    const newPosts = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

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
    // Don't clear posts — keep cached content visible while fresh data loads
    cursors = {};
    const allPosts: UnifiedPost[] = [];

    const feedResults = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined };

      const tag = (p: UnifiedPost) => { p.sourceAccount = acct.handle; return p; };
      const acctPosts: UnifiedPost[] = [];
      let cursor: string | undefined;

      if (acct.platform === 'bluesky') {
        if (feedMode === 'timeline' || feedMode === 'for-you') {
          if (entry.oauthAgent) {
            const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50 });
            acctPosts.push(...r.data.feed.map(p => tag(normalizePost(p, 'bluesky'))));
            cursor = r.data.cursor;
          } else {
            const bsky = entry.client as BlueskyClient;
            try {
              const result = await bsky.getTimeline();
              acctPosts.push(...result.feed.map(p => tag(normalizePost(p, 'bluesky'))));
              cursor = result.cursor;
            } catch {
              const result = await bsky.getAuthorFeed(acct.handle);
              acctPosts.push(...result.feed.map(p => tag(normalizePost(p, 'bluesky'))));
              cursor = result.cursor;
            }
          }
        } else {
          const bsky = entry.client as BlueskyClient;
          const result = await bsky.getAuthorFeed(acct.handle);
          acctPosts.push(...result.feed.map(p => tag(normalizePost(p, 'bluesky'))));
          cursor = result.cursor;
        }
      } else if (acct.platform === 'threads') {
        const threads = entry.client as ThreadsClient;
        let posts = await threads.getOwnPosts(50);
        posts = await threads.resolveReposts(posts);
        acctPosts.push(...posts.map(p => tag(normalizePost(p, 'threads'))));
      } else {
        const masto = entry.client as MastodonClient;
        if (feedMode === 'timeline' || feedMode === 'for-you') {
          const statuses = await masto.getHomeTimeline();
          acctPosts.push(...statuses.map(p => tag(normalizePost(p, 'mastodon'))));
          cursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
        } else {
          const account = await masto.getAccountByHandle(acct.handle);
          const statuses = await masto.getAccountStatuses(account.id);
          acctPosts.push(...statuses.map(p => tag(normalizePost(p, 'mastodon'))));
          cursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
        }
      }
      return { posts: acctPosts, acct, cursor };
    }));

    for (const result of feedResults) {
      if (result.status === 'fulfilled') {
        allPosts.push(...result.value.posts);
        if (result.value.cursor) cursors[result.value.acct.id] = result.value.cursor;
      } else {
        console.error('Failed to load feed for account:', result.reason);
        error = (error ? error + '\n' : '') + String(result.reason);
      }
    }

    // Only replace if we got fresh data; keep cached posts on network failure
    if (allPosts.length > 0) {
      posts = sortPosts(allPosts, 'newest');
      progress = posts.length;
      const cacheSize = parseInt(localStorage.getItem('crispdeck-feed-cache-size') ?? '200');
      setCache('feed-' + feedMode, posts.slice(0, cacheSize));
    }
    loading = false;
  }

  async function loadMore() {
    if (loadingMore || !hasMoreContent) return;
    loadingMore = true;

    const moreResults = await Promise.allSettled(accounts.map(async (acct) => {
      const cursor = cursors[acct.id];
      if (!cursor) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined };

      const entry = clientEntries.get(acct.id);
      if (!entry) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined };

      const acctPosts: UnifiedPost[] = [];
      let newCursor: string | undefined;

      if (acct.platform === 'bluesky') {
        if (feedMode === 'timeline' && entry.oauthAgent) {
          const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50, cursor });
          acctPosts.push(...r.data.feed.map(p => normalizePost(p, 'bluesky')));
          newCursor = r.data.cursor;
        } else {
          const bsky = entry.client as BlueskyClient;
          const result = await bsky.getAuthorFeed(acct.handle, cursor);
          acctPosts.push(...result.feed.map(p => normalizePost(p, 'bluesky')));
          newCursor = result.cursor;
        }
      } else if (acct.platform !== 'threads') {
        const masto = entry.client as MastodonClient;
        if (feedMode === 'timeline') {
          const statuses = await masto.getHomeTimeline(cursor);
          acctPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
          newCursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
        } else {
          const account = await masto.getAccountByHandle(acct.handle);
          const statuses = await masto.getAccountStatuses(account.id, cursor);
          acctPosts.push(...statuses.map(p => normalizePost(p, 'mastodon')));
          newCursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
        }
      }
      return { posts: acctPosts, acct, cursor: newCursor };
    }));

    const newPosts: UnifiedPost[] = [];
    for (const result of moreResults) {
      if (result.status === 'fulfilled') {
        newPosts.push(...result.value.posts);
        if (result.value.cursor) cursors[result.value.acct.id] = result.value.cursor;
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
        } else if (post.platform === 'threads') {
          await (entry.client as ThreadsClient).like((post.raw as any).id);
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
        } else if (post.platform === 'threads') {
          await (entry.client as ThreadsClient).repost((post.raw as any).id);
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
  const filtered = $derived(applyMuteFilter(filterPosts(platformFiltered, filters)));
  const sorted = $derived(
    feedMode === 'for-you'
      ? rankForYou(filtered, affinityMap)
      : sortPosts(filtered, filters.sortBy)
  );
  const finalFeed = $derived(detectCrossposts(sorted, identityPairs.size > 0 ? identityPairs : undefined));
  const hasMoreContent = $derived(Object.values(cursors).some(c => !!c));
  const isLoading = $derived(loading || loadingMore);

  function onTouchStart(e: TouchEvent) {
    if (window.scrollY === 0) {
      pullStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (!isPulling) return;
    const y = e.touches[0].clientY;
    pullDistance = Math.max(0, Math.min(120, (y - pullStartY) * 0.5));
  }

  async function onTouchEnd() {
    if (!isPulling) return;
    isPulling = false;
    if (pullDistance >= 60) {
      pullRefreshing = true;
      pullDistance = 50;
      await loadFeed();
      pullRefreshing = false;
    }
    pullDistance = 0;
  }
</script>

<svelte:head><title>CrispDeck — Feed</title><meta name="description" content="Your unified Mastodon + Bluesky timeline" /></svelte:head>

<div class="p-6" role="feed" aria-label="Social feed" ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd}>
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
          onclick={() => switchMode('for-you')}
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'for-you' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          {i18n.t.feed.forYou}
        </button>
        <button
          onclick={() => switchMode('my-posts')}
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'my-posts' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          <User size={12} />
          {i18n.t.feed.myPosts}
        </button>
      </div>

      <!-- Platform filter (only shown when multiple platforms connected) -->
      {#if multiPlatform}
        <div class="flex items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            onclick={() => platformFilter = 'all'}
            class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors {platformFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >{i18n.t.feed.all}</button>
          {#if connectedPlatforms.has('bluesky')}
            <button
              onclick={() => platformFilter = 'bluesky'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'bluesky' ? 'bg-[var(--color-bluesky)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-bluesky)]"></span> Bsky</button>
          {/if}
          {#if connectedPlatforms.has('mastodon')}
            <button
              onclick={() => platformFilter = 'mastodon'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'mastodon' ? 'bg-[var(--color-mastodon)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-mastodon)]"></span> Masto</button>
          {/if}
          {#if connectedPlatforms.has('threads')}
            <button
              onclick={() => platformFilter = 'threads'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'threads' ? 'bg-[var(--color-threads)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-threads)]"></span> Threads</button>
          {/if}
        </div>
      {/if}

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

  <!-- Pull-to-refresh indicator -->
  {#if pullDistance > 0}
    <div class="flex items-center justify-center mb-2 transition-all" style="height: {pullDistance}px">
      <RefreshCw size={20} class="text-[var(--color-primary)] {pullRefreshing ? 'animate-spin' : ''}" style="opacity: {pullDistance / 60}; transform: rotate({pullDistance * 3}deg)" />
    </div>
  {/if}

  {#if initialLoading}
    <div class="space-y-3">
      {#each { length: 5 } as _}
        <SkeletonPost />
      {/each}
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
      <div class="space-y-3">
        {#each { length: 4 } as _}
          <SkeletonPost />
        {/each}
      </div>
    {:else if finalFeed.length === 0}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">
          {posts.length > 0 ? i18n.t.feed.noPostsMatch : i18n.t.feed.noPostsFound}
        </h3>
        {#if feedMode === 'for-you' && affinityMap.size === 0}
          <p class="text-sm text-[var(--color-text-muted)] mt-2">
            {i18n.t.feed.forYouHint}
          </p>
          <a href="/archive" class="inline-block mt-3 px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-md">{i18n.t.feed.buildArchive}</a>
        {/if}
      </div>
    {:else}
      <div class="space-y-3">
        {#each finalFeed as item (isCrosspostGroup(item) ? item.id : item.uri)}
          {#if isCrosspostGroup(item)}
            <CrosspostGroup group={item} {hideMedia} />
          {:else}
            {#if multiAccount && item.sourceAccount}
              <div class="relative">
                <span class="absolute -top-1 right-2 text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] z-10">
                  via {item.sourceAccount.split('.')[0]}
                </span>
                <Post post={item} {hideMedia} onlike={handleLike} onboost={handleBoost} onreply={handleReply} onquote={handleQuote} />
              </div>
            {:else}
              <Post post={item} {hideMedia} onlike={handleLike} onboost={handleBoost} onreply={handleReply} onquote={handleQuote} />
            {/if}
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
