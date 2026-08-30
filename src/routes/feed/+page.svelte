<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Rss, Loader2, Inbox, EyeOff, User, Globe, SlidersHorizontal, RefreshCw } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import DelayedSpinner from '$lib/components/DelayedSpinner.svelte';
  import Post from '$lib/components/Post.svelte';
  import CrosspostGroup from '$lib/components/CrosspostGroup.svelte';
  import SkeletonPost from '$lib/components/SkeletonPost.svelte';
  import AdvancedFilters from '$lib/components/AdvancedFilters.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { notifyNewPosts, getPermission } from '$lib/push-notifications';
  import { initAllClients, invalidateClientCache, retryDegradedClients, type ClientEntry } from '$lib/api/client-factory';
  import { normalizePost, filterPosts, sortPosts, detectCrossposts, buildIdentityPairs, isCrosspostGroup } from '$lib/api/unified';
  import { listIdentities } from '$lib/db';
  import type { UnifiedPost, Filters, Account, Platform } from '$lib/types';
  import { buildAffinityMap, rankForYou } from '$lib/for-you';
  import { syncMutedWordsFromServer } from '$lib/bluesky-prefs';
  import { searchArchive } from '$lib/archive';
  import { jetstream } from '$lib/jetstream';
  import { applyMuteFilter } from '$lib/muted-words';
  import { buildFilterMatcher, getCachedFilters, setCachedFilters, type MastodonFilter } from '$lib/mastodon-filters';
  import { saveReadPosition, getReadPosition } from '$lib/read-position';
  import { getCached, setCache } from '$lib/view-cache';
  import { toTime, isNewerThan } from '$lib/post-time';
  import { cacheFeed, loadCachedFeed, formatCachedTime, isOffline } from '$lib/offline-cache';

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
  let mastodonFilters: MastodonFilter[] = $state([]);
  let offlineBanner = $state(''); // "Offline — cached from 5 min ago"

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
  let pollInterval: ReturnType<typeof setInterval> | undefined;

  // Pull-to-refresh
  let pullStartY = 0;
  let pullDistance = $state(0);
  let isPulling = $state(false);
  let pullRefreshing = $state(false);

  const multiAccount = $derived(accounts.length > 1);

  onMount(async () => {
    try {
      let result = await initAllClients();
      // If cache returned 0 accounts but DB might have some, force re-init
      if (result.accounts.length === 0) {
        invalidateClientCache();
        result = await initAllClients();
      }
      accounts = result.accounts;
      clientEntries = result.clients;
      // Sync Bluesky server muted words (non-blocking)
      for (const [, entry] of clientEntries) {
        if (entry.oauthAgent) syncMutedWordsFromServer(entry.oauthAgent);
      }
      // Fetch Mastodon server-side filters (non-blocking, cached 5 min)
      for (const [, entry] of clientEntries) {
        if (entry.platform === 'mastodon') {
          const masto = entry.client as MastodonClient;
          const cached = getCachedFilters(masto.getInstanceUrl());
          if (cached) {
            mastodonFilters = cached;
          } else {
            masto.getFilters().then(f => { mastodonFilters = f; setCachedFilters(masto.getInstanceUrl(), f); }).catch(() => {});
          }
          break; // Only need to fetch once per unique instance for now
        }
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

    // Poll for new posts every 60 seconds, skip when tab is hidden.
    // NB: Svelte ignores the return value of an *async* onMount callback, so
    // the teardown lives in onDestroy — returning a cleanup here would leak a
    // fresh interval on every visit to this page.
    pollInterval = setInterval(() => {
      if (!document.hidden) checkForNewPosts();
    }, 60000);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    observer?.disconnect();
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = undefined;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    const main = document.getElementById('main-content');
    const topPost = posts[0]?.uri;
    if (topPost) {
      saveReadPosition('feed', topPost, main?.scrollTop);
    }
  });

  /** Check immediately when the tab comes back, rather than waiting out the poll. */
  function onVisibilityChange() {
    if (!document.hidden) checkForNewPosts();
  }

  let newPostsAvailable = $state(0);

  /**
   * Fetch one page of an account's feed for the current mode.
   *
   * Bluesky's home timeline needs auth, which can come from either an OAuth
   * agent or an app-password client — try whichever this entry has, and fall
   * back to the public author feed only when neither can reach it. `degraded`
   * reports that fallback so the caller can say so exactly once.
   */
  async function fetchAccountPage(
    acct: Account,
    entry: ClientEntry,
    opts: { limit: number; cursor?: string; resolveReposts?: boolean },
  ): Promise<{ posts: UnifiedPost[]; cursor?: string; degraded: boolean }> {
    const { limit, cursor } = opts;
    const tag = (p: UnifiedPost) => { p.sourceAccount = acct.handle; return p; };
    const wantsTimeline = feedMode === 'timeline' || feedMode === 'for-you';

    if (acct.platform === 'bluesky') {
      const bsky = entry.client as BlueskyClient;
      if (wantsTimeline) {
        try {
          const r = entry.oauthAgent
            ? await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit, cursor })
                .then(res => ({ feed: res.data.feed, cursor: res.data.cursor }))
            : await bsky.getTimeline(cursor, limit);
          return { posts: r.feed.map(p => tag(normalizePost(p, 'bluesky'))), cursor: r.cursor, degraded: false };
        } catch (e) {
          console.error(`Timeline failed for ${acct.handle}, trying author feed:`, e);
        }
      }
      const r = await bsky.getAuthorFeed(acct.handle, cursor);
      return { posts: r.feed.map(p => tag(normalizePost(p, 'bluesky'))), cursor: r.cursor, degraded: wantsTimeline };
    }

    if (acct.platform === 'threads') {
      const threads = entry.client as ThreadsClient;
      let tp = await threads.getOwnPosts(limit);
      if (opts.resolveReposts) tp = await threads.resolveReposts(tp);
      // Threads has no usable cursor here, so it never paginates.
      return { posts: tp.map(p => tag(normalizePost(p, 'threads'))), cursor: undefined, degraded: false };
    }

    const masto = entry.client as MastodonClient;
    const statuses = wantsTimeline
      ? await masto.getHomeTimeline(cursor)
      : await masto.getAccountStatuses((await masto.getAccountByHandle(acct.handle)).id, cursor);
    return {
      posts: statuses.map((st: any) => tag(normalizePost(st, 'mastodon'))),
      cursor: statuses.length > 0 ? statuses[statuses.length - 1].id : undefined,
      degraded: false,
    };
  }

  /** Fetch the newest slice of every account's feed and keep what postdates `sinceMs`. */
  async function fetchNewerPosts(sinceMs: number, limit: number): Promise<UnifiedPost[]> {
    const results = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return [] as UnifiedPost[];
      const page = await fetchAccountPage(acct, entry, { limit });
      return page.posts.filter(p => isNewerThan(p.createdAt, sinceMs));
    }));
    const fresh = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    // Deduplicate across accounts — two connected accounts can surface the
    // same post, and counting it twice inflates the "N new posts" banner.
    const existing = new Set(posts.map(p => p.uri));
    const seen = new Set<string>();
    return fresh.filter(p => {
      if (existing.has(p.uri) || seen.has(p.uri)) return false;
      seen.add(p.uri);
      return true;
    });
  }

  async function checkForNewPosts() {
    if (posts.length === 0 || loading) return;
    const newestMs = toTime(posts[0]?.createdAt);
    if (!newestMs) return;

    const fresh = await fetchNewerPosts(newestMs, 20);
    newPostsAvailable = fresh.length; // Replace, don't accumulate

    // Send push notification if page is not visible and we have new posts
    if (fresh.length > 0 && document.hidden) {
      const perm = await getPermission();
      if (perm === 'granted') {
        notifyNewPosts(fresh.length);
      }
    }
  }

  async function loadNewPosts() {
    // Prepend new posts instead of reloading everything
    newPostsAvailable = 0;
    const newestMs = toTime(posts[0]?.createdAt);
    if (!newestMs) return;
    const unique = await fetchNewerPosts(newestMs, 50);
    if (unique.length > 0) {
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
    // Clear stale banners — this load decides what, if anything, is wrong now.
    // Leaving them set meant one flaky refresh pinned "Timeline unavailable"
    // to the page forever, even while fresh timeline posts streamed in.
    error = '';
    // A transient OAuth restore failure leaves Bluesky accounts read-only for
    // the rest of the page's life, which silently downgrades the timeline to
    // "your posts only". Give the session a chance to come back first.
    const recovered = await retryDegradedClients(clientEntries);
    if (recovered) {
      accounts = recovered.accounts;
      clientEntries = recovered.clients;
    }
    // Don't clear posts — keep cached content visible while fresh data loads
    cursors = {};
    const allPosts: UnifiedPost[] = [];
    const degradedHandles: string[] = [];

    const feedResults = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined, degraded: false };
      try {
        return { acct, ...(await fetchAccountPage(acct, entry, { limit: 50, resolveReposts: true })) };
      } catch (e) {
        // Name the account — "Failed to load feed" alone is useless with several connected.
        throw new Error(`Failed to load feed for @${acct.handle}: ${e}`);
      }
    }));

    for (const result of feedResults) {
      if (result.status === 'fulfilled') {
        allPosts.push(...result.value.posts);
        if (result.value.cursor) cursors[result.value.acct.id] = result.value.cursor;
        if (result.value.degraded) degradedHandles.push(result.value.acct.handle);
      } else {
        console.error('Failed to load feed for account:', result.reason);
        error = (error ? error + '\n' : '') + String(result.reason);
      }
    }

    if (degradedHandles.length > 0) {
      const who = degradedHandles.map(h => '@' + h).join(', ');
      error = (error ? error + '\n' : '')
        + `Timeline unavailable for ${who} — showing your posts only. `
        + 'Your session may have expired; try reconnecting in Settings.';
    }

    // Only replace if we got fresh data; keep cached posts on network failure
    if (allPosts.length > 0) {
      posts = sortPosts(allPosts, 'newest');
      progress = posts.length;
      const cacheSize = parseInt(localStorage.getItem('crispdeck-feed-cache-size') ?? '200');
      setCache('feed-' + feedMode, posts.slice(0, cacheSize));
      // Persist to IndexedDB for offline PWA access
      cacheFeed('feed', posts);
      offlineBanner = '';
    } else if (posts.length === 0) {
      // Network failed and no SWR cache — try offline IndexedDB cache
      const cached = await loadCachedFeed('feed');
      if (cached && cached.posts.length > 0) {
        posts = cached.posts;
        offlineBanner = `Offline — showing cached feed from ${formatCachedTime(cached.cachedAt)}`;
      }
    }
    newPostsAvailable = 0;
    loading = false;
  }

  async function loadMore() {
    if (loadingMore || !hasMoreContent) return;
    loadingMore = true;

    const moreResults = await Promise.allSettled(accounts.map(async (acct) => {
      const cursor = cursors[acct.id];
      const entry = clientEntries.get(acct.id);
      if (!cursor || !entry) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined };
      const page = await fetchAccountPage(acct, entry, { limit: 50, cursor, resolveReposts: true });
      return { posts: page.posts, acct, cursor: page.cursor };
    }));

    const newPosts: UnifiedPost[] = [];
    for (const result of moreResults) {
      if (result.status === 'fulfilled') {
        newPosts.push(...result.value.posts);
        // Drop the cursor when a page comes back empty-ended, so the infinite
        // scroll sentinel stops re-firing against an exhausted feed.
        cursors[result.value.acct.id] = result.value.cursor;
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

  const platformFiltered = $derived(
    platformFilter === 'all' ? posts : posts.filter(p => p.platform === platformFilter)
  );
  const filtered = $derived.by(() => {
    let result = applyMuteFilter(filterPosts(platformFiltered, filters));
    if (mastodonFilters.length > 0) {
      const match = buildFilterMatcher(mastodonFilters, 'home');
      result = result.filter(p => {
        if (p.platform !== 'mastodon') return true;
        const hit = match(p.text);
        if (!hit) return true;
        if (hit.action === 'hide') return false;
        // 'warn' — set contentWarning so Post.svelte shows it collapsed
        p.contentWarning = hit.title;
        return true;
      });
    }
    return result;
  });
  // $derived.by, not $derived: the plain form is inlined into the component
  // body, where TS still has feedMode narrowed to its initializer ('timeline')
  // and calls the 'for-you' branch unreachable. A closure resets that.
  const sorted = $derived.by(() =>
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

  {#if offlineBanner}
    <div class="mb-4 p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg text-yellow-200 text-sm flex items-center justify-between">
      <span>{offlineBanner}</span>
      <button onclick={() => { offlineBanner = ''; loadFeed(); }} class="underline ml-2">Retry</button>
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
          <DelayedSpinner>
            <Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
            <p class="text-xs text-[var(--color-text-muted)] mt-2">{i18n.t.feed.loadingMore}</p>
          </DelayedSpinner>
        {:else if hasMoreContent}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.scrollMore}</p>
        {:else}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.endOfFeed}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>
