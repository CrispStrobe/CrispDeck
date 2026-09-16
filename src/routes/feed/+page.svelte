<script lang="ts">
  import { base } from '$app/paths';
  import { onMount, onDestroy } from 'svelte';
  import { Rss, Loader2, Inbox, EyeOff, User, Globe, SlidersHorizontal, RefreshCw, ChevronDown, Hash, Users, Search, Pin, PinOff } from '@lucide/svelte';
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
  import { saveReadPosition, getReadPosition, flushReadPositions } from '$lib/read-position';
  import { getCached, setCache, isStale } from '$lib/view-cache';
  import { listSavedFeeds, searchFeedGenerators, pinFeed, unpinFeed, FOLLOWING, type FeedChoice } from '$lib/bluesky-feeds';
  import { pickAnchor, measureItems, restoreAnchor, type ScrollAnchor } from '$lib/feed-scroll';
  import { toTime, isNewerThan } from '$lib/post-time';
  import { cacheFeed, loadCachedFeed, formatCachedTime, isOffline } from '$lib/offline-cache';

  // 'custom' delegates to a Bluesky feed generator or list; which ones are on
  // offer comes from the account's own pinned feeds, see $lib/bluesky-feeds.
  type FeedMode = 'timeline' | 'my-posts' | 'for-you' | 'custom';

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

  let customFeed: FeedChoice | null = $state(null);
  /** Everything the account has saved, pinned or not, in saved order. */
  let savedFeeds: FeedChoice[] = $state([]);
  let showFeedMenu = $state(false);
  let feedQuery = $state('');
  let feedResults: FeedChoice[] = $state([]);
  let searchingFeeds = $state(false);
  let feedSearchError = $state('');
  let pinBusy: string | null = $state(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const pinnedFeeds = $derived(savedFeeds.filter((f) => f.pinned !== false));
  const unpinnedFeeds = $derived(savedFeeds.filter((f) => f.pinned === false));
  /** Search hits the account has not already saved — the rest are duplicates. */
  const newResults = $derived.by(() => {
    const known = new Set(savedFeeds.map((f) => f.key));
    return feedResults.filter((f) => !known.has(f.key));
  });

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

  // $derived.by rather than $derived, for the same reason as `sorted` below:
  // the plain form inlines into the component body, where TS still has
  // feedMode narrowed to its initializer and calls the 'custom' branch dead.
  /** Identifies the current view for caching and for its saved reading position. */
  const viewKey = $derived.by(() =>
    feedMode === 'custom' && customFeed ? customFeed.key : (feedMode as string)
  );
  const currentFeedLabel = $derived.by(() =>
    feedMode === 'custom' && customFeed ? customFeed.title : null
  );

  // Reading position. `feed:v2:` rather than `feed:` because the stored shape
  // changed meaning: scrollY used to be a container offset and is now an
  // offset within the anchored post, so old entries must not be replayed.
  const posKey = $derived('feed:v2:' + viewKey);
  let scrollRaf = 0;

  function scrollContainer(): HTMLElement | null {
    return document.getElementById('main-content');
  }

  /** Remember which post is under the fold, coalesced to one measure per frame. */
  function onFeedScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const el = scrollContainer();
      if (!el) return;
      const anchor = pickAnchor(measureItems(el), el.scrollTop);
      if (anchor) saveReadPosition(posKey, anchor.key, anchor.offset);
    });
  }

  function savedAnchor(): ScrollAnchor | null {
    const pos = getReadPosition(posKey);
    return pos ? { key: pos.lastSeenUri, offset: pos.scrollY ?? 0 } : null;
  }

  /** Put the reader back where they were, once the feed has posts to anchor to. */
  function restorePosition() {
    const el = scrollContainer();
    if (el) restoreAnchor(el, savedAnchor());
  }

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
      loadPinnedFeeds();
      // Show cached feed instantly while fresh data loads, and put the reader
      // straight back where they were — this is the path taken when they open
      // a post and come back, so it has to land before the network does.
      const cached = getCached<UnifiedPost[]>('feed-' + viewKey);
      if (cached) {
        posts = cached.data;
        initialLoading = false;
        restorePosition();
      }
      if (accounts.length > 0) {
        // Returning from a thread within half a minute: the cache is the same
        // data the network would return, so skip the round trip entirely and
        // leave the restored position undisturbed.
        const justLeft = cached && !isStale(cached, 30_000) && savedAnchor() !== null;
        if (!justLeft) {
          await loadFeed();
          // Re-anchor: fresh posts may have arrived above the one being read.
          restorePosition();
        }
      }
      scrollContainer()?.addEventListener('scroll', onFeedScroll, { passive: true });
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
    const main = scrollContainer();
    main?.removeEventListener('scroll', onFeedScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    // Final measure: the last scroll event may still be waiting on a frame
    // that will never run now.
    if (main) {
      const anchor = pickAnchor(measureItems(main), main.scrollTop);
      if (anchor) saveReadPosition(posKey, anchor.key, anchor.offset);
    }
    flushReadPositions();
  });

  /**
   * The account's pinned feeds, resolved in the background. Failure is silent:
   * the Following timeline works regardless, and an error banner for a feed
   * switcher the user may never open would be noise.
   */
  async function loadPinnedFeeds() {
    const agent = blueskyAgent();
    if (!agent) return;
    try {
      savedFeeds = await listSavedFeeds(agent);
    } catch (e) {
      console.error('Could not load saved feeds:', e);
    }
  }

  /** The first connected Bluesky account's agent, or null. */
  function blueskyAgent(): any | null {
    for (const [id, entry] of clientEntries) {
      if (accounts.find(a => a.id === id)?.platform !== 'bluesky') continue;
      return entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
    }
    return null;
  }

  function onFeedQuery() {
    clearTimeout(searchTimer);
    feedSearchError = '';
    const q = feedQuery;
    if (!q.trim()) { feedResults = []; searchingFeeds = false; return; }
    searchTimer = setTimeout(async () => {
      searchingFeeds = true;
      try {
        feedResults = await searchFeedGenerators(q);
      } catch (e) {
        // Saying nothing here is indistinguishable from "no matches", which
        // makes a search outage look like an empty network.
        feedSearchError = i18n.t.feed.feedSearchFailed;
        feedResults = [];
      } finally {
        searchingFeeds = false;
      }
    }, 300);
  }

  /**
   * Pin or unpin, then re-read from the server rather than patching locally.
   * The saved-feed ids come from the server, and a local guess at the new
   * state is exactly the kind of thing that drifts.
   */
  async function togglePin(choice: FeedChoice) {
    const agent = blueskyAgent();
    if (!agent || !choice.uri || pinBusy) return;
    pinBusy = choice.key;
    try {
      if (choice.savedId) await unpinFeed(agent, choice.savedId);
      else await pinFeed(agent, choice);
      await loadPinnedFeeds();
    } catch (e) {
      console.error('Could not change pinned feeds:', e);
    } finally {
      pinBusy = null;
    }
  }

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

    // A feed generator or list is Bluesky-only and account-independent: its
    // ranking happens on the generator's server, so there is nothing to merge
    // from Mastodon or Threads and no fallback worth attempting.
    if (feedMode === 'custom' && customFeed?.uri) {
      if (acct.platform !== 'bluesky') return { posts: [], cursor: undefined, degraded: false };
      const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
      const res = customFeed.kind === 'list'
        ? await agent.api.app.bsky.feed.getListFeed({ list: customFeed.uri, limit, cursor })
        : await agent.api.app.bsky.feed.getFeed({ feed: customFeed.uri, limit, cursor });
      return {
        posts: res.data.feed.map(p => tag(normalizePost(p, 'bluesky'))),
        cursor: res.data.cursor,
        degraded: false,
      };
    }

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
      setCache('feed-' + viewKey, posts.slice(0, cacheSize));
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
    if (mode === feedMode && mode !== 'custom') return;
    feedMode = mode;
    if (mode !== 'custom') customFeed = null;
    await enterView();
  }

  async function selectFeed(choice: FeedChoice) {
    showFeedMenu = false;
    if (choice.kind === 'timeline') return switchMode('timeline');
    if (feedMode === 'custom' && customFeed?.key === choice.key) return;
    customFeed = choice;
    feedMode = 'custom';
    await enterView();
  }

  /**
   * Switch the visible view. Each view keeps its own cache and its own reading
   * position, so flipping between Following and a feed returns to where you
   * were in each rather than dumping you at the top of both.
   */
  async function enterView() {
    posts = [];
    newPostsAvailable = 0;
    const cached = getCached<UnifiedPost[]>('feed-' + viewKey);
    if (cached) {
      posts = cached.data;
      restorePosition();
    } else {
      const el = scrollContainer();
      if (el) el.scrollTop = 0;
    }
    await loadFeed();
    restorePosition();
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
    window.location.href = `${base}/compose?replyTo=${replyTo}&author=${author}&platform=${post.platform}`;
  }

  function handleQuote(post: UnifiedPost) {
    const quoteUri = encodeURIComponent(post.uri);
    const quoteCid = encodeURIComponent((post.raw as any)?.post?.cid ?? '');
    const author = encodeURIComponent(post.author.handle);
    const text = encodeURIComponent(post.text.substring(0, 100));
    window.location.href = `${base}/compose?quoteUri=${quoteUri}&quoteCid=${quoteCid}&quoteAuthor=${author}&quoteText=${text}&platform=${post.platform}`;
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

<div class="p-6" role="feed" aria-label={i18n.t.feed.socialFeed} ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd}>
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

        <!-- Pinned Bluesky feeds and lists. Hidden entirely when the account
             has none pinned, so a Mastodon-only user never sees a dead menu. -->
        <!-- Pinned Bluesky feeds, lists, and a way to find more. Shown
             whenever a Bluesky account is connected: gating it on having
             feeds already pinned meant someone with none could never reach
             the search that would get them some. -->
        {#if savedFeeds.length > 0}
          <div class="relative">
            <button
              onclick={() => showFeedMenu = !showFeedMenu}
              aria-haspopup="menu"
              aria-expanded={showFeedMenu}
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors max-w-[10rem] {feedMode === 'custom' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
              title={i18n.t.feed.switchFeed}
            >
              <span class="truncate">{currentFeedLabel ?? i18n.t.feed.feeds}</span>
              <ChevronDown size={12} class="flex-shrink-0" />
            </button>
            {#if showFeedMenu}
              <div class="fixed inset-0 z-40" role="presentation" onclick={() => showFeedMenu = false}></div>
              <div role="menu" class="absolute right-0 top-full mt-1 z-50 w-72 max-h-[26rem] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl py-1">

                {#snippet feedRow(choice: FeedChoice, showPin: boolean)}
                  <div class="flex items-stretch hover:bg-[var(--color-surface-hover)] transition-colors">
                    <button
                      role="menuitem"
                      onclick={() => selectFeed(choice)}
                      class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-xs {choice.kind === 'timeline' ? (feedMode === 'timeline' ? 'text-[var(--color-primary)]' : '') : (customFeed?.key === choice.key ? 'text-[var(--color-primary)]' : '')}"
                    >
                      {#if choice.avatar}
                        <img src={choice.avatar} alt="" width="20" height="20" loading="lazy" decoding="async" class="w-5 h-5 rounded flex-shrink-0 bg-[var(--color-surface-hover)]" />
                      {:else if choice.kind === 'list'}
                        <Users size={16} class="flex-shrink-0 text-[var(--color-text-muted)]" />
                      {:else if choice.kind === 'timeline'}
                        <Globe size={16} class="flex-shrink-0 text-[var(--color-text-muted)]" />
                      {:else}
                        <Hash size={16} class="flex-shrink-0 text-[var(--color-text-muted)]" />
                      {/if}
                      <span class="min-w-0">
                        <span class="block truncate font-medium">{choice.title}</span>
                        {#if choice.byHandle}
                          <span class="block truncate text-[10px] text-[var(--color-text-muted)]">
                            @{choice.byHandle}{#if choice.likeCount} · {choice.likeCount.toLocaleString()} ♥{/if}
                          </span>
                        {/if}
                      </span>
                    </button>
                    {#if showPin && choice.uri}
                      <button
                        onclick={() => togglePin(choice)}
                        disabled={pinBusy !== null}
                        aria-label={choice.savedId ? i18n.t.feed.unpinFeed : i18n.t.feed.pinFeed}
                        title={choice.savedId ? i18n.t.feed.unpinFeed : i18n.t.feed.pinFeed}
                        class="px-2.5 flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-40"
                      >
                        {#if pinBusy === choice.key}
                          <Loader2 size={13} class="animate-spin" />
                        {:else if choice.savedId}
                          <PinOff size={13} />
                        {:else}
                          <Pin size={13} />
                        {/if}
                      </button>
                    {/if}
                  </div>
                {/snippet}

                {#each pinnedFeeds as choice (choice.key)}
                  {@render feedRow(choice, choice.kind !== 'timeline')}
                {/each}

                {#if unpinnedFeeds.length > 0}
                  <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] border-t border-[var(--color-border)] mt-1">
                    {i18n.t.feed.savedNotPinned}
                  </div>
                  {#each unpinnedFeeds as choice (choice.key)}
                    {@render feedRow(choice, true)}
                  {/each}
                {/if}

                <div class="border-t border-[var(--color-border)] mt-1 pt-1">
                  <div class="flex items-center gap-2 px-3 py-1.5">
                    <Search size={13} class="text-[var(--color-text-muted)] flex-shrink-0" />
                    <input
                      bind:value={feedQuery}
                      oninput={onFeedQuery}
                      placeholder={i18n.t.feed.searchFeeds}
                      aria-label={i18n.t.feed.searchFeeds}
                      class="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs"
                    />
                    {#if searchingFeeds}<Loader2 size={13} class="animate-spin text-[var(--color-text-muted)]" />{/if}
                  </div>

                  {#if feedSearchError}
                    <p class="px-3 py-2 text-[10px] text-red-400">{feedSearchError}</p>
                  {:else if feedQuery.trim() && !searchingFeeds && newResults.length === 0}
                    <p class="px-3 py-2 text-[10px] text-[var(--color-text-muted)]">{i18n.t.feed.noFeedsFound}</p>
                  {/if}

                  {#each newResults as choice (choice.key)}
                    {@render feedRow(choice, true)}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
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
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-threads)]"></span> {i18n.t.common.threads}</button>
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
        title={i18n.t.feed.hideMediaLabel}
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
      <button onclick={() => { offlineBanner = ''; loadFeed(); }} class="underline ml-2">{i18n.t.feed.retry}</button>
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
          <a href="{base}/archive" class="inline-block mt-3 px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-md">{i18n.t.feed.buildArchive}</a>
        {/if}
      </div>
    {:else}
      <div class="space-y-3">
        {#each finalFeed as item (isCrosspostGroup(item) ? item.id : item.uri)}
          <!-- data-feed-key is what the reading position anchors to; feed-item
               lets the browser skip layout and paint for offscreen posts. -->
          <div class="feed-item" data-feed-key={isCrosspostGroup(item) ? item.id : item.uri}>
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
          </div>
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

<style>
  /**
   * Skip layout, style and paint for posts that are scrolled out of view.
   *
   * A timeline holds hundreds of posts and each one is expensive — rich text,
   * embeds, quote cards, media. Rendering all of them is what makes scrolling
   * stutter. `content-visibility: auto` lets the browser do the work only for
   * posts near the viewport, which is most of the benefit of windowing without
   * a virtual list, and without breaking Ctrl-F or the reading-position anchor.
   *
   * `contain-intrinsic-size: auto 16rem` matters as much as the first line:
   * `auto` tells the browser to remember each post's real height once it has
   * been rendered, so scrolled-past posts keep their true size and the
   * scrollbar stops jumping. 16rem is only the guess for posts never yet seen.
   */
  .feed-item {
    content-visibility: auto;
    contain-intrinsic-size: auto 16rem;
  }
</style>
