<script lang="ts">
  import { queuePostsForSearchCache } from '$lib/search-cache-lazy';
  import { getSearchCacheGeneration } from '$lib/search-cache-lazy';
  import { buildThreadsFeed, getThreadsSources } from '$lib/threads-feed';
  import { loadFeedFilterDefaults, saveFeedFilterDefaults, resetFeedFilterDefaults, factoryFeedFilters } from '$lib/feed-filter-defaults';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy, tick } from 'svelte';
  import { Rss, Loader2, Inbox, EyeOff, User, Globe, SlidersHorizontal, RefreshCw, ChevronDown, Hash, Users, Search, Pin, PinOff, Info } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { toast } from '$lib/toast.svelte';
  import { swallow } from '$lib/debug-log';
  import DelayedSpinner from '$lib/components/DelayedSpinner.svelte';
  import Post from '$lib/components/Post.svelte';
  import AccountAttribution from '$lib/components/AccountAttribution.svelte';
  import CrosspostGroup from '$lib/components/CrosspostGroup.svelte';
  import SkeletonPost from '$lib/components/SkeletonPost.svelte';
  import AdvancedFilters from '$lib/components/AdvancedFilters.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { notifyNewPosts, getPermission } from '$lib/push-notifications';
  import { initAllClients, peekCachedClients, invalidateClientCache, retryDegradedClients, type ClientEntry } from '$lib/api/client-factory';
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
  import { watchConnection, cachedDataBanner } from '$lib/offline-status';
  import { performDeckAction } from '$lib/deck-actions';
  import { postContextParams } from '$lib/compose/context';
  import { readString } from '$lib/safe-storage';
  import { needsAccountAttribution } from '$lib/feed-account-attribution';

  // 'custom' delegates to a Bluesky feed generator or list; which ones are on
  // offer comes from the account's own pinned feeds, see $lib/bluesky-feeds.
  type FeedMode = 'timeline' | 'my-posts' | 'for-you' | 'custom';
  type FeedView = { mode: FeedMode; choice: FeedChoice | null };

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let initialLoading = $state(true);
  let error = $state('');
  let progress = $state(0);
  let hideMedia = $state(false);
  let feedMode: FeedMode = $state('timeline');
  let platformFilter: 'all' | Platform = $state('all');
  let showThreadsInfo = $state(false);
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
  let stopWatchingConnection: (() => void) | undefined;

  let filters: Filters = $state(loadFeedFilterDefaults());

  let clientEntries: Map<number, ClientEntry> = new Map();
  let identityPairs: Set<string> = $state(new Set());
  let affinityMap: Map<string, number> = $state(new Map());
  let affinityPromise: Promise<void> | null = null;
  let affinitySequence = 0;
  let disposed = false;
  let requestSequence = 0;
  let accountSequence = 0;
  let newerSequence = 0;
  let restoreSequence = 0;

  function currentView(): FeedView { return { mode: feedMode, choice: customFeed }; }
  function currentRequest(request: number): boolean { return !disposed && request === requestSequence; }
  function beginRequest(): number {
    newerSequence++; restoreSequence++;
    loadingMore = false;
    isPulling = false; pullRefreshing = false; pullDistance = 0;
    return ++requestSequence;
  }

  function resetAffinity() {
    affinitySequence++;
    affinityMap = new Map();
    affinityPromise = null;
    if (feedMode === 'for-you') void loadAffinity();
  }

  function accountScope(list: Account[]): string {
    return JSON.stringify([...list].sort((a, b) => a.id - b.id).map(account => [
      account.id, account.platform, account.did, account.instance_url,
      account.mastodon_id, account.threads_user_id, account.handle,
    ]));
  }

  function feedCacheKey(list: Account[], view: FeedView): string {
    return `feed:v2:${accountScope(list)}:${JSON.stringify([view.mode, view.choice?.kind, view.choice?.uri])}`;
  }

  /**
   * Read interaction history for the For You ranking, once.
   *
   * Memoised on the promise rather than the result so two rapid switches into
   * For You share one read; cleared on failure so a transient IndexedDB error
   * does not disable the feature for the rest of the session.
   */
  function loadAffinity(): Promise<void> {
    const sequence = affinitySequence;
    affinityPromise ??= (async () => {
      const [liked, reposted, replied] = await Promise.all([
        searchArchive({ type: 'like', limit: 500 }),
        searchArchive({ type: 'repost', limit: 500 }),
        searchArchive({ type: 'reply', limit: 500 }),
      ]);
      if (!disposed && sequence === affinitySequence) affinityMap = buildAffinityMap(liked, reposted, replied);
    })().catch(() => {
      if (sequence === affinitySequence) affinityPromise = null; // the archive may not exist yet
    });
    return affinityPromise;
  }

  // Infinite scroll
  let scrollSentinel: HTMLDivElement | undefined = $state();
  let observer: IntersectionObserver | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;

  // Pull-to-refresh
  let pullStartY = 0;
  let pullDistance = $state(0);
  let isPulling = $state(false);
  let pullRefreshing = $state(false);

  function changeMobileFeed(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'discover') {
      (event.currentTarget as HTMLSelectElement).value = feedMode === 'custom' && customFeed ? 'custom:' + customFeed.key : feedMode;
      showFeedMenu = true;
      return;
    }
    if (value.startsWith('custom:')) {
      const choice = savedFeeds.find(feed => feed.key === value.slice(7));
      if (choice) void selectFeed(choice);
    } else if (value === 'timeline' || value === 'for-you' || value === 'my-posts') {
      void switchMode(value);
    }
  }

  const currentFeedLabel = $derived.by(() =>
    feedMode === 'custom' && customFeed ? customFeed.title : null
  );

  // Cache and position keys include immutable account identities as well as
  // the view. Old global caches must not reveal a removed account's private feed.
  const cacheKey = $derived(feedCacheKey(accounts, currentView()));
  const posKey = $derived('position:' + cacheKey);
  let scrollRaf = 0;

  function scrollContainer(): HTMLElement | null {
    return document.getElementById('main-content');
  }

  function readingAnchor(): ScrollAnchor | null {
    const el = scrollContainer();
    return el && el.scrollTop > 0 ? pickAnchor(measureItems(el), el.scrollTop) : null;
  }

  async function preserveReadingPosition(anchor: ScrollAnchor | null, request = requestSequence) {
    if (!anchor || !currentRequest(request)) return;
    const restoring = ++restoreSequence;
    const index = sorted.findIndex(post => post.uri === anchor.key);
    if (index >= renderLimit) renderLimit = Math.ceil((index + 1) / RENDER_PAGE) * RENDER_PAGE;
    await tick();
    if (!currentRequest(request) || restoring !== restoreSequence) return;
    const el = scrollContainer();
    if (el) restoreAnchor(el, anchor, 10, () => currentRequest(request) && restoring === restoreSequence);
  }

  /** Remember which post is under the fold, coalesced to one measure per frame. */
  function onFeedScroll() {
    if (scrollRaf) return;
    const request = requestSequence;
    const key = posKey;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!currentRequest(request)) return;
      const el = scrollContainer();
      if (!el) return;
      const anchor = pickAnchor(measureItems(el), el.scrollTop);
      if (anchor) saveReadPosition(key, anchor.key, anchor.offset);
    });
  }

  function rememberPosition() {
    const el = scrollContainer();
    const anchor = el ? pickAnchor(measureItems(el), el.scrollTop) : null;
    if (anchor) saveReadPosition(posKey, anchor.key, anchor.offset);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }

  function savedAnchor(): ScrollAnchor | null {
    const pos = getReadPosition(posKey);
    return pos ? { key: pos.lastSeenUri, offset: pos.scrollY ?? 0 } : null;
  }

  /**
   * Put the reader back where they were, once the feed has posts to anchor to.
   *
   * The anchored post may sit past the render cap, in which case it is not in
   * the DOM and restoreAnchor would search for something that does not exist.
   * Raise the cap far enough to include it first — a reader returning to a
   * position deep in the feed has already paid for those rows once.
   */
  function restorePosition(request = requestSequence) {
    return preserveReadingPosition(savedAnchor(), request);
  }

  async function initializeFeed(refreshAccounts = false) {
    const initialization = ++accountSequence;
    const previousScope = accountScope(accounts);
    const request = beginRequest();
    const isCurrent = () => !disposed && initialization === accountSequence;
    if (refreshAccounts) {
      posts = []; progress = 0; accounts = []; clientEntries = new Map();
      cursors = {}; savedFeeds = []; mastodonFilters = []; identityPairs = new Set();
      offlineBanner = ''; error = ''; newPostsAvailable = 0; initialLoading = true;
    }
    const warm = refreshAccounts ? null : peekCachedClients();
    if (warm?.accounts.length) {
      accounts = warm.accounts;
      clientEntries = warm.clients;
      const cached = getCached<UnifiedPost[]>(cacheKey);
      if (cached) {
        posts = cached.data; progress = posts.length;
        initialLoading = false;
        void restorePosition(request);
      }
    }
    try {
      let result = await initAllClients();
      if (!isCurrent()) return;
      // If cache returned 0 accounts but DB might have some, force re-init
      if (result.accounts.length === 0) {
        invalidateClientCache();
        result = await initAllClients();
        if (!isCurrent()) return;
      }
      if (accountScope(accounts) !== accountScope(result.accounts)) {
        posts = []; progress = 0; cursors = {}; mastodonFilters = [];
      }
      if (previousScope !== accountScope(result.accounts)) resetAffinity();
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
            void masto.getFilters().then(f => {
              if (!isCurrent()) return;
              mastodonFilters = f; setCachedFilters(masto.getInstanceUrl(), f);
            }).catch(() => {});
          }
          break; // Only need to fetch once per unique instance for now
        }
      }
      // Load confirmed identities for crosspost dedup + affinity for "For You"
      void listIdentities({ confirmed_only: true }).then(ids => { if (isCurrent()) identityPairs = buildIdentityPairs(ids); }).catch(() => {});
      // Affinity is loaded when For You is first opened, not here. It reads
      // 1,500 records out of IndexedDB and is used by nothing else — the feed
      // always starts in timeline mode, so on most loads that work was thrown
      // away, on the path between opening the app and seeing a post.
      // Start Jetstream if enabled
      if (localStorage.getItem('crispdeck-live-counters') === 'true') {
        jetstream.setEnabled(true);
      }
      void loadPinnedFeeds();
      // Show cached feed instantly while fresh data loads, and put the reader
      // straight back where they were — this is the path taken when they open
      // a post and come back, so it has to land before the network does.
      const cached = getCached<UnifiedPost[]>(cacheKey);
      if (cached) {
        posts = cached.data;
        progress = posts.length;
        initialLoading = false;
        void restorePosition();
      }
      if (accounts.length > 0) {
        // Returning from a thread within half a minute: the cache is the same
        // data the network would return, so skip the round trip entirely and
        // leave the restored position undisturbed.
        const justLeft = !refreshAccounts && cached && !isStale(cached, 30_000) && savedAnchor() !== null;
        if (!justLeft) {
          const pending = loadFeed();
          // The load starts a new request generation. Restore cached content
          // under that generation while the network is still pending.
          void restorePosition();
          const loaded = await pending;
          // Re-anchor: fresh posts may have arrived above the one being read.
          if (loaded !== undefined) await restorePosition(loaded);
        }
      }
    } catch (e) {
      if (isCurrent()) error = String(e);
    } finally {
      if (isCurrent()) {
        initialLoading = false;
        if (!accounts.length) { loading = false; loadingMore = false; progress = 0; }
      }
    }
  }

  function onAccountsChanged() {
    rememberPosition();
    void initializeFeed(true);
  }

  onMount(() => {
    void initializeFeed();
    scrollContainer()?.addEventListener('scroll', onFeedScroll, { passive: true });
    window.addEventListener('crispdeck:accounts-changed', onAccountsChanged);
    // Register lifetime resources synchronously, so teardown also covers a
    // page left before its asynchronous account initialization finishes.
    pollInterval = setInterval(() => {
      if (!document.hidden) checkForNewPosts();
    }, 60000);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // The banner used to stay up after the connection came back: the layout
    // cleared its own offline flag and nothing cleared this one, so a
    // reconnected user went on reading cached posts under an "Offline" sign.
    stopWatchingConnection = watchConnection({
      onOnline: () => {
        if (!offlineBanner) return;
        offlineBanner = i18n.t.feed.reconnected;
        loadFeed();
      },
    });
  });

  onDestroy(() => {
    disposed = true; requestSequence++; accountSequence++; newerSequence++; restoreSequence++; affinitySequence++;
    clearTimeout(searchTimer);
    stopWatchingConnection?.();
    stopWatchingConnection = undefined;
    observer?.disconnect();
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = undefined;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('crispdeck:accounts-changed', onAccountsChanged);
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
    const initialization = accountSequence;
    const agent = blueskyAgent();
    if (!agent) return;
    try {
      const saved = await listSavedFeeds(agent);
      if (!disposed && initialization === accountSequence) savedFeeds = saved;
    } catch (e) {
      if (disposed || initialization !== accountSequence) return;
      swallow('feed.loadPinnedFeeds', e);
      toast.error(i18n.t.feed.savedFeedsFailed);
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
      swallow('feed.togglePin', e);
      toast.error(i18n.t.feed.pinFailed);
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
  const threadsFailuresShown = new Set<number>();
  async function fetchAccountPage(
    acct: Account,
    entry: ClientEntry,
    opts: { limit: number; cursor?: string; resolveReposts?: boolean },
    view: FeedView,
  ): Promise<{ posts: UnifiedPost[]; cursor?: string; degraded: boolean }> {
    const { limit, cursor } = opts;
    const searchGeneration = getSearchCacheGeneration();
    const tag = (p: UnifiedPost) => {
      p.sourceAccount = acct.handle; p.sourceAccountId = acct.id;
      queuePostsForSearchCache([p], searchGeneration);
      return p;
    };
    const wantsTimeline = view.mode === 'timeline' || view.mode === 'for-you';

    // A feed generator or list is Bluesky-only and account-independent: its
    // ranking happens on the generator's server, so there is nothing to merge
    // from Mastodon or Threads and no fallback worth attempting.
    if (view.mode === 'custom' && view.choice?.uri) {
      if (acct.platform !== 'bluesky') return { posts: [], cursor: undefined, degraded: false };
      const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
      const res = view.choice.kind === 'list'
        ? await agent.api.app.bsky.feed.getListFeed({ list: view.choice.uri, limit, cursor })
        : await agent.api.app.bsky.feed.getFeed({ feed: view.choice.uri, limit, cursor });
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
          swallow(`feed.timeline:${acct.handle}`, e);
        }
      }
      const r = await bsky.getAuthorFeed(acct.handle, cursor);
      return { posts: r.feed.map(p => tag(normalizePost(p, 'bluesky'))), cursor: r.cursor, degraded: wantsTimeline };
    }

    if (acct.platform === 'threads') {
      const threads = entry.client as ThreadsClient;
      let tp;
      if (wantsTimeline) {
        const result = await buildThreadsFeed(threads, acct.handle, getThreadsSources(acct.handle), limit);
        tp = result.posts;
        if (result.failures.length && !threadsFailuresShown.has(acct.id)) {
          threadsFailuresShown.add(acct.id);
          toast.warning(`Threads sources unavailable: ${result.failures.join(', ')}. Check Meta permissions and reconnect if needed.`);
        }
      } else tp = await threads.getOwnPosts(limit);
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
  async function fetchNewerPosts(sinceMs: number, limit: number, view: FeedView): Promise<UnifiedPost[]> {
    const results = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return [] as UnifiedPost[];
      const page = await fetchAccountPage(acct, entry, { limit }, view);
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
    if (disposed || posts.length === 0 || loading) return;
    const request = requestSequence;
    const newer = ++newerSequence;
    const newestMs = toTime(posts[0]?.createdAt);
    if (!newestMs) return;

    const fresh = await fetchNewerPosts(newestMs, 20, currentView());
    if (!currentRequest(request) || newer !== newerSequence) return;
    if (newPostsAvailable !== fresh.length) {
      const anchor = readingAnchor();
      newPostsAvailable = fresh.length; // Replace, don't accumulate
      await preserveReadingPosition(anchor, request);
    }

    // Send push notification if page is not visible and we have new posts
    if (fresh.length > 0 && document.hidden) {
      const perm = await getPermission();
      if (perm === 'granted' && currentRequest(request) && newer === newerSequence) {
        notifyNewPosts(fresh.length);
      }
    }
  }

  async function loadNewPosts() {
    if (disposed || loading) return;
    const request = requestSequence;
    const newer = ++newerSequence;
    const view = currentView();
    // Prepend new posts instead of reloading everything
    const bannerAnchor = readingAnchor();
    newPostsAvailable = 0;
    await preserveReadingPosition(bannerAnchor, request);
    if (!currentRequest(request) || newer !== newerSequence) return;
    const newestMs = toTime(posts[0]?.createdAt);
    if (!newestMs) return;
    const unique = await fetchNewerPosts(newestMs, 50, view);
    if (!currentRequest(request) || newer !== newerSequence) return;
    if (unique.length > 0) {
      const anchor = readingAnchor();
      posts = sortPosts([...unique, ...posts], 'newest');
      progress = posts.length;
      cachePosts(cacheKey);
      await preserveReadingPosition(anchor, request);
    }
  }

  // Reactive infinite scroll — observes sentinel whenever it appears in DOM
  $effect(() => {
    if (!scrollSentinel) return;
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      // Show what is already loaded before asking the network for more.
      if (hasUnrendered) {
        renderLimit += RENDER_PAGE;
      } else if (!loadingMore && hasMoreContent) {
        loadMore();
      }
    }, { rootMargin: '600px' });
    observer.observe(scrollSentinel);
  });

  function cachePosts(key: string) {
    const configured = Number.parseInt(readString('crispdeck-feed-cache-size', '200'));
    const size = Number.isFinite(configured) && configured > 0 ? configured : 200;
    const plain = $state.snapshot(posts);
    setCache(key, plain.slice(0, size));
    // IndexedDB cannot structured-clone Svelte's reactive proxies.
    void cacheFeed(key, plain).catch(error => swallow('feed.cache', error));
  }

  async function loadFeed(request = beginRequest()): Promise<number | undefined> {
    if (!currentRequest(request)) return;
    const view = currentView();
    loading = true;
    // Clear stale banners — this load decides what, if anything, is wrong now.
    // Leaving them set meant one flaky refresh pinned "Timeline unavailable"
    // to the page forever, even while fresh timeline posts streamed in.
    error = '';
    // A transient OAuth restore failure leaves Bluesky accounts read-only for
    // the rest of the page's life, which silently downgrades the timeline to
    // "your posts only". Give the session a chance to come back first.
    try {
      const recovered = await retryDegradedClients(clientEntries);
      if (!currentRequest(request)) return;
      if (recovered) {
        if (accountScope(accounts) !== accountScope(recovered.accounts)) { posts = []; progress = 0; resetAffinity(); }
        accounts = recovered.accounts;
        clientEntries = recovered.clients;
      }
      const key = feedCacheKey(accounts, view);
      // Don't clear posts — keep this view's cached content visible while loading.
      cursors = {};
      const allPosts: UnifiedPost[] = [];
      const degradedHandles: string[] = [];
      const feedResults = await Promise.allSettled(accounts.map(async (acct) => {
        const entry = clientEntries.get(acct.id);
        if (!entry) throw new Error(`Unable to access the connected account ${acct.handle}. Reconnect it in Settings.`);
        try {
          return { acct, ...(await fetchAccountPage(acct, entry, { limit: 50, resolveReposts: true }, view)) };
        } catch (e) {
          throw new Error(`Failed to load feed for @${acct.handle.replace(/^@+/, "")}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }));
      if (!currentRequest(request)) return;

      for (const result of feedResults) {
        if (result.status === 'fulfilled') {
          allPosts.push(...result.value.posts);
          if (result.value.cursor) cursors[result.value.acct.id] = result.value.cursor;
          if (result.value.degraded) degradedHandles.push(result.value.acct.handle);
        } else {
          swallow('feed.loadAccount', result.reason);
          error = (error ? error + '\n' : '') + String(result.reason);
        }
      }
      if (degradedHandles.length > 0) {
        const who = degradedHandles.map(h => '@' + h).join(', ');
        error = (error ? error + '\n' : '')
          + `Timeline unavailable for ${who} — showing your posts only. `
          + 'Your session may have expired; try reconnecting in Settings.';
      }

      // An empty successful response is authoritative. Only network failures
      // justify replaying an offline snapshot, and only for this account/view.
      if (allPosts.length > 0 || feedResults.every(result => result.status === 'fulfilled')) {
        const anchor = readingAnchor();
        const freshUris = new Set<string>();
        const fresh = allPosts.filter(post => {
          if (freshUris.has(post.uri)) return false;
          freshUris.add(post.uri); return true;
        });
        posts = sortPosts(anchor && fresh.length ? [...fresh, ...posts.filter(post => !freshUris.has(post.uri))] : fresh, 'newest');
        progress = posts.length;
        cachePosts(key);
        offlineBanner = '';
        await preserveReadingPosition(anchor, request);
      } else if (posts.length === 0 && accounts.length > 0) {
        const cached = await loadCachedFeed(key);
        if (!currentRequest(request)) return;
        if (cached && cached.posts.length > 0) {
          posts = cached.posts; progress = posts.length;
          offlineBanner = cachedDataBanner(true, cached.cachedAt, i18n.t.feed.offlineCached, formatCachedTime);
        }
      }
    } catch (e) {
      if (currentRequest(request)) error = String(e);
    } finally {
      if (currentRequest(request)) {
        const bannerAnchor = readingAnchor();
        newPostsAvailable = 0;
        loading = false;
        await preserveReadingPosition(bannerAnchor, request);
      }
    }
    return currentRequest(request) ? request : undefined;
  }

  async function loadMore() {
    if (disposed || loading || loadingMore || !hasMoreContent) return;
    const request = requestSequence;
    const view = currentView();
    const key = cacheKey;
    loadingMore = true;

    const moreResults = await Promise.allSettled(accounts.map(async (acct) => {
      const cursor = cursors[acct.id];
      const entry = clientEntries.get(acct.id);
      if (!cursor || !entry) return { posts: [] as UnifiedPost[], acct, cursor: undefined as string | undefined };
      const page = await fetchAccountPage(acct, entry, { limit: 50, cursor, resolveReposts: true }, view);
      return { posts: page.posts, acct, cursor: page.cursor };
    }));
    if (!currentRequest(request)) return;

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
      const unique = sortPosts(newPosts.filter(p => {
        if (existingUris.has(p.uri)) return false;
        existingUris.add(p.uri); return true;
      }), 'newest');
      posts = [...posts, ...unique];
      progress = posts.length;
      cachePosts(key);
    }
    loadingMore = false;
  }

  async function switchMode(mode: FeedMode) {
    if (mode === feedMode && mode !== 'custom') return;
    rememberPosition();
    feedMode = mode;
    if (mode !== 'custom') customFeed = null;
    await enterView();
  }

  async function selectFeed(choice: FeedChoice) {
    showFeedMenu = false;
    if (choice.kind === 'timeline') return switchMode('timeline');
    if (feedMode === 'custom' && customFeed?.key === choice.key) return;
    rememberPosition();
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
    const request = beginRequest();
    const mode = feedMode;
    posts = [];
    progress = 0; cursors = {}; offlineBanner = ''; error = ''; loading = true;
    renderLimit = RENDER_PAGE;
    newPostsAvailable = 0;
    const cached = getCached<UnifiedPost[]>(cacheKey);
    if (cached) {
      posts = cached.data; progress = posts.length;
      void restorePosition(request);
    } else {
      const el = scrollContainer();
      if (el) el.scrollTop = 0;
    }
    // Invalidate the prior view before waiting for archive data.
    if (mode === 'for-you') await loadAffinity();
    if (!currentRequest(request)) return;
    await loadFeed(request);
    if (currentRequest(request)) await restorePosition(request);
  }

  function handleLike(post: UnifiedPost, active = true) {
    return performDeckAction(post, 'like', active, clientEntries, accounts.map(account => account.id));
  }

  function handleBoost(post: UnifiedPost, active = true) {
    return performDeckAction(post, 'repost', active, clientEntries, accounts.map(account => account.id));
  }

  function handleReply(post: UnifiedPost) {
    void goto(`${base}/compose?${postContextParams(post, 'reply')}`);
  }

  function handleQuote(post: UnifiedPost) {
    void goto(`${base}/compose?${postContextParams(post, 'quote')}`);
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
  const RENDER_PAGE = 30;
  let renderLimit = $state(RENDER_PAGE);
  /**
   * Crosspost detection runs over the rows being rendered, not the whole feed.
   * The detector uses an index of shared word sequences to avoid comparing
   * unrelated text. Keeping the input to the visible slice also bounds the
   * normalization and grouping work before a reader scrolls farther.
   */
  const visibleFeed = $derived(
    detectCrossposts(
      sorted.slice(0, renderLimit),
      identityPairs.size > 0 ? identityPairs : undefined,
    ),
  );
  const hasUnrendered = $derived(sorted.length > renderLimit);

  /**
   * How many rows are built into the DOM.
   *
   * The feed used to render every post it held. Four hundred cached posts is
   * 36,000 DOM nodes and a single seven-and-a-half second task on the main
   * thread, during which nothing responds — then scrolling ran at about
   * 100ms a frame. content-visibility already skips *painting* what is
   * offscreen, but the nodes still have to be created, and creating them is
   * where that time went.
   *
   * Deck columns have capped their rows this way all along; the feed simply
   * never did. The cap lifts as the reader approaches the end, so an
   * uninterrupted scroll still reaches everything.
   */
  const hasMoreContent = $derived(Object.values(cursors).some(c => !!c));
  const isLoading = $derived(loading || loadingMore);

  function onTouchStart(e: TouchEvent) {
    // Ask the element that actually scrolls. html/body are `overflow: hidden`
    // and #main-content carries the scrollbar, so window.scrollY is always 0 —
    // this gate was permanently open, and any downward drag, however deep in
    // the feed, armed a pull-to-refresh and reloaded the timeline.
    const el = scrollContainer();
    if ((el ? el.scrollTop : window.scrollY) <= 0) {
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
      const request = beginRequest();
      pullRefreshing = true;
      pullDistance = 50;
      await loadFeed(request);
      if (!currentRequest(request)) return;
      pullRefreshing = false;
    }
    pullDistance = 0;
  }
</script>

<svelte:head><title>CrispDeck — Feed</title><meta name="description" content="Your unified Mastodon + Bluesky timeline" /></svelte:head>

<div class="feed-root p-3 md:p-4" role="feed" aria-label={i18n.t.feed.socialFeed} ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd}>
  <h1 class="sr-only">{i18n.t.feed.title}</h1>
  <div class="mobile-feed-controls md:hidden">
    <select aria-label={i18n.t.feed.switchFeed} value={feedMode === 'custom' && customFeed ? 'custom:' + customFeed.key : feedMode} onchange={changeMobileFeed}>
      <option value="timeline">{i18n.t.feed.timeline}</option>
      <option value="for-you">{i18n.t.feed.forYou}</option>
      <option value="my-posts">{i18n.t.feed.myPosts}</option>
      {#each savedFeeds as choice (choice.key)}<option value={'custom:' + choice.key}>{choice.title}</option>{/each}
      {#if savedFeeds.length}<option value="discover">{i18n.t.feed.discoverFeeds}</option>{/if}
    </select>
    {#if multiPlatform}
      <select aria-label={i18n.t.feed.filterPlatform} bind:value={platformFilter}>
        <option value="all">{i18n.t.feed.all}</option>
        {#if connectedPlatforms.has('bluesky')}<option value="bluesky">{i18n.t.feed.filterBsky}</option>{/if}
        {#if connectedPlatforms.has('mastodon')}<option value="mastodon">{i18n.t.feed.filterMasto}</option>{/if}
        {#if connectedPlatforms.has('threads')}<option value="threads">{i18n.t.common.threads}</option>{/if}
      </select>
    {/if}
    {#if newPostsAvailable > 0}<button type="button" class="mobile-refresh" onclick={loadNewPosts} aria-label={i18n.t.feed.refreshNewPosts.replace('{count}', String(newPostsAvailable))}><RefreshCw size={16} /><span>{newPostsAvailable}</span></button>{/if}
    <details class="mobile-feed-options">
      <summary aria-label={i18n.t.settings.filterSortTitle}><SlidersHorizontal size={18} /></summary>
      <div class="mobile-options-menu">
        <button onclick={() => showFilters = !showFilters} aria-expanded={showFilters} aria-controls="feed-filters">{i18n.t.settings.filterSortTitle}</button>
        <button onclick={() => hideMedia = !hideMedia} aria-pressed={hideMedia}>{i18n.t.feed.hideMediaLabel}</button>
        {#if connectedPlatforms.has('threads')}<button onclick={() => showThreadsInfo = !showThreadsInfo} aria-expanded={showThreadsInfo}>{i18n.t.feed.threadsInfoLabel}</button>{/if}
        {#if showThreadsInfo}<p role="note">{i18n.t.feed.threadsTimelineLimited} <a href="https://www.threads.net/" target="_blank" rel="noopener noreferrer">{i18n.t.feed.openThreads}</a></p>{/if}
      </div>
    </details>
  </div>
  <div class="desktop-feed-header flex flex-wrap items-center justify-between gap-2 mb-2">
    <div class="flex items-center gap-2">
      <Rss size={24} />
      <span aria-hidden="true" class="text-2xl font-bold">{i18n.t.feed.title}</span>
      {#if posts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({progress} posts)</span>
      {/if}
    </div>
    {#if newPostsAvailable > 0}
      <button onclick={loadNewPosts} class="px-2 py-1 bg-[var(--color-primary)]/20 text-[var(--color-primary-text)] text-xs font-medium rounded-lg hover:bg-[var(--color-primary)]/30">
        {newPostsAvailable} new post{newPostsAvailable > 1 ? 's' : ''} — refresh
      </button>
    {/if}
    <div class="feed-toolbar flex min-w-0 w-full flex-wrap items-center gap-2 lg:w-auto">
      <!-- Feed mode toggle -->
      <div class="feed-mode-tabs flex min-w-0 max-w-full w-full sm:w-auto overflow-x-auto items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
        <button
          onclick={() => switchMode('timeline')}
          aria-pressed={feedMode === 'timeline'}
          class="flex flex-1 shrink-0 justify-center whitespace-nowrap items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'timeline' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          <Globe size={12} class="shrink-0" />
          {i18n.t.feed.timeline}
        </button>
        <button
          onclick={() => switchMode('for-you')}
          aria-pressed={feedMode === 'for-you'}
          class="flex flex-1 shrink-0 justify-center whitespace-nowrap items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'for-you' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          {i18n.t.feed.forYou}
        </button>
        <button
          onclick={() => switchMode('my-posts')}
          aria-pressed={feedMode === 'my-posts'}
          class="flex flex-1 shrink-0 justify-center whitespace-nowrap items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {feedMode === 'my-posts' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          <User size={12} class="shrink-0" />
          {i18n.t.feed.myPosts}
        </button>
      </div>

        <!-- Pinned Bluesky feeds and lists. Hidden entirely when the account
             has none pinned, so a Mastodon-only user never sees a dead menu. -->
        <!-- Pinned Bluesky feeds, lists, and a way to find more. Shown
             whenever a Bluesky account is connected: gating it on having
             feeds already pinned meant someone with none could never reach
             the search that would get them some. -->
        {#if savedFeeds.length > 0}
          <div class="feed-picker relative min-w-0">
            <button
              onclick={() => showFeedMenu = !showFeedMenu}
              aria-haspopup="menu"
              aria-expanded={showFeedMenu}
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-border)] transition-colors max-w-[10rem] {feedMode === 'custom' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
              title={i18n.t.feed.switchFeed}
            >
              <span class="truncate">{currentFeedLabel ?? i18n.t.feed.feeds}</span>
              <ChevronDown size={12} class="flex-shrink-0" />
            </button>
            {#if showFeedMenu}
              <div class="fixed inset-0 z-40" role="presentation" onclick={() => showFeedMenu = false}></div>
              <div role="menu" class="feed-picker-menu absolute end-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-2rem)] max-h-[min(26rem,60dvh)] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl py-1">

                {#snippet feedRow(choice: FeedChoice, showPin: boolean)}
                  <div class="flex items-stretch hover:bg-[var(--color-surface-hover)] transition-colors">
                    <button
                      role="menuitem"
                      onclick={() => selectFeed(choice)}
                      class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-xs {choice.kind === 'timeline' ? (feedMode === 'timeline' ? 'text-[var(--color-primary-text)]' : '') : (customFeed?.key === choice.key ? 'text-[var(--color-primary-text)]' : '')}"
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
                        class="px-2.5 flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-primary-text)] disabled:opacity-40"
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

      <!-- Platform filter (only shown when multiple platforms connected) -->
      {#if multiPlatform}
        <div class="feed-platform-filter flex max-w-full flex-wrap items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            onclick={() => platformFilter = 'all'}
            class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors {platformFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >{i18n.t.feed.all}</button>
          {#if connectedPlatforms.has('bluesky')}
            <button
              onclick={() => platformFilter = 'bluesky'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'bluesky' ? 'bg-[var(--color-bluesky-strong)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-bluesky)]"></span>{i18n.t.feed.filterBsky}</button>
          {/if}
          {#if connectedPlatforms.has('mastodon')}
            <button
              onclick={() => platformFilter = 'mastodon'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'mastodon' ? 'bg-[var(--color-mastodon-strong)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-mastodon)]"></span>{i18n.t.feed.filterMasto}</button>
          {/if}
          {#if connectedPlatforms.has('threads')}
            <button
              onclick={() => platformFilter = 'threads'}
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 {platformFilter === 'threads' ? 'bg-[var(--color-threads)] text-white' : 'text-[var(--color-text-muted)]'}"
            ><span class="w-1.5 h-1.5 rounded-full bg-[var(--color-threads)]"></span> {i18n.t.common.threads}</button>
            <div class="relative">
              <button onclick={() => showThreadsInfo = !showThreadsInfo} aria-label={i18n.t.feed.threadsInfoLabel} aria-expanded={showThreadsInfo} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Info size={15} /></button>
              {#if showThreadsInfo}
                <div class="absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)] shadow-lg" role="note">
                  {i18n.t.feed.threadsTimelineLimited}
                  <a href="https://www.threads.net/" target="_blank" rel="noopener noreferrer" class="underline">{i18n.t.feed.openThreads}</a>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if !multiPlatform && connectedPlatforms.has('threads')}
        <div class="relative">
          <button onclick={() => showThreadsInfo = !showThreadsInfo} aria-label={i18n.t.feed.threadsInfoLabel} aria-expanded={showThreadsInfo} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Info size={15} /></button>
          {#if showThreadsInfo}
            <div class="absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)] shadow-lg" role="note">
              {i18n.t.feed.threadsTimelineLimited}
              <a href="https://www.threads.net/" target="_blank" rel="noopener noreferrer" class="underline">{i18n.t.feed.openThreads}</a>
            </div>
          {/if}
        </div>
      {/if}

      <button
        onclick={() => showFilters = !showFilters}
        aria-label={i18n.t.settings.filterSortTitle}
        aria-expanded={showFilters}
        aria-controls="feed-filters"
        class="feed-filter-toggle flex shrink-0 items-center justify-center p-1.5 rounded-md transition-colors {showFilters ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        title={i18n.t.settings.filterSortTitle}
      >
        <SlidersHorizontal size={16} />
      </button>

      <button
        onclick={() => hideMedia = !hideMedia}
        aria-label={i18n.t.feed.hideMediaLabel}
        aria-pressed={hideMedia}
        class="feed-media-toggle flex shrink-0 items-center justify-center p-1.5 rounded-md transition-colors {hideMedia ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
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
      <RefreshCw size={20} class="text-[var(--color-primary-text)] {pullRefreshing ? 'animate-spin' : ''}" style="opacity: {pullDistance / 60}; transform: rotate({pullDistance * 3}deg)" />
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
      <div id="feed-filters" class="contents">
        <AdvancedFilters {filters} onchange={handleFilterChange} onSaveDefault={() => saveFeedFilterDefaults(filters) ? toast.success(i18n.t.settings.filterSaved) : toast.error(i18n.t.settings.filterSaveFailed)} onReset={() => { if (resetFeedFilterDefaults()) filters = { ...factoryFeedFilters }; else toast.error(i18n.t.settings.filterSaveFailed); }} startOpen={true} />
      </div>
    {/if}

    {#if loading && posts.length === 0}
      <div class="space-y-3">
        {#each { length: 4 } as _}
          <SkeletonPost />
        {/each}
      </div>
    {:else if visibleFeed.length === 0}
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
      <div class="feed-items">
        {#each visibleFeed as item (isCrosspostGroup(item) ? item.id : item.uri)}
          <!-- data-feed-key is what the reading position anchors to; feed-item
               lets the browser skip layout and paint for offscreen posts. -->
          <div class="feed-item" data-feed-key={isCrosspostGroup(item) ? item.id : item.uri}>
          {#if isCrosspostGroup(item)}
            <CrosspostGroup group={item} {hideMedia} />
          {:else}
            {#if needsAccountAttribution(accounts, item.platform) && item.sourceAccount}
              <div class="relative">
                <AccountAttribution platform={item.platform} account={item.sourceAccount} />
                <Post post={item} feedPreview {hideMedia} onlike={handleLike} onboost={handleBoost} onreply={handleReply} onquote={handleQuote} />
              </div>
            {:else}
              <Post post={item} feedPreview {hideMedia} onlike={handleLike} onboost={handleBoost} onreply={handleReply} onquote={handleQuote} />
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
        {:else if hasUnrendered || hasMoreContent}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.scrollMore}</p>
        {:else}
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.feed.endOfFeed}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  @media (width >= 48rem) { .feed-items > .feed-item + .feed-item { margin-top: 0.75rem; } }
  /* The picker becomes a bounded sheet on phones. Its contents can scroll
     without putting feed rows or search controls under either fixed bar. */
  @media (width < 48rem) {
    .feed-root { padding-top: 0; }
    .desktop-feed-header { display: contents; }
    .desktop-feed-header > :not(.feed-toolbar) { display: none; }
    .feed-toolbar { display: contents; }
    .feed-toolbar > :not(.feed-picker) { display: none; }
    .feed-picker { position: static; }
    .feed-picker > button { display: none; }
    .mobile-feed-controls { position: fixed; z-index: 51; top: var(--safe-area-top); left: calc(var(--safe-area-left) + 3.25rem); right: calc(var(--safe-area-right) + 0.35rem); height: var(--mobile-header-height); display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
    .mobile-feed-controls select { flex: 1 1 0; width: 0; min-width: 0; height: 44px; padding: 0 1.2rem 0 0.4rem; color: var(--color-text); background-color: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.375rem; font-size: 0.75rem; }
    .mobile-feed-controls select:first-child { flex-grow: 1.4; }
    .mobile-refresh, .mobile-feed-options summary { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; color: var(--color-text-muted); cursor: pointer; }
    .mobile-refresh span { font-size: 0.65rem; }
    .mobile-feed-options summary { list-style: none; }
    .mobile-feed-options summary::-webkit-details-marker { display: none; }
    .mobile-options-menu { position: absolute; right: 0; top: 100%; width: min(19rem, 90vw); padding: 0.4rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.5rem; box-shadow: 0 8px 24px #0005; }
    .mobile-options-menu button, .mobile-options-menu p { display: block; width: 100%; min-height: 44px; padding: 0.6rem; text-align: start; font-size: 0.8rem; }
    .feed-items { margin-inline: -0.75rem; }
    .feed-items > :global(.feed-item) { margin-top: 0; }
    .feed-items :global(.post-card) { border: 0; border-bottom: 1px solid var(--color-border); border-radius: 0; padding: 0.6rem 0.75rem; }
    .feed-picker-menu {
      position: fixed;
      top: auto;
      bottom: calc(var(--mobile-tab-height) + var(--safe-area-bottom) + 0.5rem);
      left: calc(var(--safe-area-left) + 0.75rem);
      right: calc(var(--safe-area-right) + 0.75rem);
      width: auto;
      max-width: none;
      max-height: calc(100dvh - var(--mobile-header-height) - var(--mobile-tab-height) - var(--safe-area-top) - var(--safe-area-bottom) - 1rem);
    }
  }

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
