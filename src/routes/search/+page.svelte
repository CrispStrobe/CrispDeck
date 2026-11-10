<script lang="ts">
  import { useLocalSearchTranslations } from '$lib/local-search-i18n.svelte';
  const localSearch = useLocalSearchTranslations();
  import { appendOperator as append, fromMeOperator, pastWeekOperator } from '$lib/search-operators';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Search, Loader2, Inbox, HelpCircle, Image, User, Calendar, Bookmark, BookmarkCheck, X } from '@lucide/svelte';
  import { listSavedSearches, saveSearch, deleteSavedSearch, isSaved, type SavedSearch } from '$lib/saved-searches';
  import { i18n } from '$lib/i18n.svelte';
  import { searchBlueskyAccount, type SearchActor } from '$lib/api/bluesky-search';
  import { MastodonClient } from '$lib/api/mastodon';
  import { searchMastodonAccounts } from '$lib/api/mastodon-search';
  import { isMastodonHandle } from '$lib/search-account';
  import { ThreadsClient } from '$lib/api/threads';
  import { normalizePost } from '$lib/api/unified';
  import { searchMastodon, searchThreads, mergeSearchResults } from '$lib/universal-search';
  import Post from '$lib/components/Post.svelte';
  import LocalSearch from '$lib/components/LocalSearch.svelte';
  import { getSearchCacheGeneration } from '$lib/search-cache-lazy';
  import { queuePostsForSearchCache } from '$lib/search-cache-lazy';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let searching = $state(false);
  let error = $state('');
  const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  let query = $state(initialParams.get('q') ?? '');
  let searchScope = $state<'networks' | 'local'>(initialParams.get('scope') === 'local' ? 'local' : 'networks');
  let remoteInitialized = false;
  let disposed = false;
  let results: UnifiedPost[] = $state([]);
  let actors: SearchActor[] = $state([]);
  let searchSequence = 0;
  let hasSearched = $state(false);

  let showSearchHelp = $state(false);
  let savedSearches: SavedSearch[] = $state([]);
  let showSavedMenu = $state(false);
  let clientEntries: Map<number, ClientEntry> = new Map();

  function refreshSavedSearches() {
    savedSearches = listSavedSearches();
  }

  function handleSaveSearch() {
    if (!query.trim()) return;
    saveSearch(query.trim());
    refreshSavedSearches();
  }

  function handleLoadSavedSearch(q: string) {
    query = q;
    showSavedMenu = false;
    handleSearch();
  }

  function handleDeleteSavedSearch(id: string) {
    deleteSavedSearch(id);
    refreshSavedSearches();
  }

  function appendOperator(op: string) {
    query = append(query, op);
  }

  async function initializeRemoteSearch() {
    if (remoteInitialized) return;
    remoteInitialized = true;
    try {
      const result = await initAllClients();
      if (disposed) return;
      accounts = result.accounts;
      clientEntries = result.clients;
      if (query.trim() && searchScope === 'networks') await handleSearch();
    } catch (e) {
      if (!disposed) error = String(e);
    } finally {
      if (!disposed) loading = false;
    }
  }

  function changeSearchScope(scope: 'networks' | 'local') {
    searchScope = scope;
    if (scope === 'networks') void initializeRemoteSearch();
  }

  onMount(() => {
    refreshSavedSearches();
    // Opening local search must not require a network connection or token refresh.
    if (searchScope === 'networks') void initializeRemoteSearch();
    return () => { disposed = true; searchSequence++; };
  });

  async function handleSearch() {
    if (!query.trim()) return;
    const sequence = ++searchSequence;
    searching = true;
    error = '';
    results = [];
    actors = [];
    hasSearched = true;

    const resultsByPlatform = new Map<Platform, UnifiedPost[]>();
    const q = query.trim();
    const cacheGeneration = getSearchCacheGeneration();

    const searchResults = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return { platform: acct.platform, posts: [] as UnifiedPost[] };
      const scopedPosts = (posts: UnifiedPost[]) => posts.map(post => ({ ...post, sourceAccountId: acct.id, sourceAccount: acct.handle }));

      if (acct.platform === 'bluesky') {
        if (isMastodonHandle(q)) return { platform: acct.platform, posts: [] as UnifiedPost[] };
        const found = await searchBlueskyAccount(entry, q);
        return { platform: acct.platform, ...found, posts: scopedPosts(found.posts) };
      } else if (acct.platform === 'mastodon') {
        const masto = entry.client as MastodonClient;
        const token = masto.getAccessToken();
        if (!token) return { platform: acct.platform, posts: [] };
        const [postResult, actorResult] = await Promise.allSettled([
          searchMastodon(q, masto.getInstanceUrl(), token, 40),
          searchMastodonAccounts(q, masto.getInstanceUrl(), token),
        ]);
        const statuses = postResult.status === 'fulfilled' ? postResult.value : [];
        return { platform: acct.platform, posts: scopedPosts(statuses.map((s: any) => normalizePost(s, 'mastodon'))),
          actors: actorResult.status === 'fulfilled' ? actorResult.value.map(actor => ({ ...actor, sourceAccountId: acct.id })) : [],
          postFailed: postResult.status === 'rejected', actorFailed: actorResult.status === 'rejected' };
      } else if (acct.platform === 'threads') {
        const threads = entry.client as ThreadsClient;
        const token = threads.getAccessToken?.();
        if (!token) return { platform: acct.platform, posts: [] };
        const threadsPosts = await searchThreads(q, token, 25);
        return { platform: acct.platform, posts: scopedPosts(threadsPosts.map((p: any) => threads.normalizePost(p))) };
      }
      return { platform: acct.platform, posts: [] as UnifiedPost[] };
    }));

    if (sequence !== searchSequence) return;
    const actorMap = new Map<string, SearchActor>();
    let failed = 0;
    for (const result of searchResults) {
      if (result.status === 'rejected') { failed++; continue; }
      if ('actors' in result.value && result.value.actors) {
        for (const actor of result.value.actors) actorMap.set(actor.did, actor);
        if (result.value.postFailed || result.value.actorFailed) failed++;
      }
      if (result.value.posts.length > 0) {
        queuePostsForSearchCache(result.value.posts, cacheGeneration);
        const p = result.value.platform;
        resultsByPlatform.set(p, [...(resultsByPlatform.get(p) ?? []), ...result.value.posts]);
      }
    }

    // Merge with engagement/recency scoring and URI dedup
    const merged = mergeSearchResults(resultsByPlatform);
    results = merged.posts;
    actors = [...actorMap.values()];
    if (failed) error = i18n.t.search.partialFailure;
    searching = false;
  }
</script>

<svelte:head><title>CrispDeck — Search</title><meta name="description" content="Search posts across all connected accounts" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Search size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.search.title}</h1>
  </div>

  <div role="group" aria-label={localSearch.t.searchScope} class="flex flex-wrap gap-2 mb-5">
    <button type="button" aria-pressed={searchScope === 'networks'} onclick={() => changeSearchScope('networks')}
      class="px-4 py-2 rounded-lg border text-sm transition-colors {searchScope === 'networks' ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}">
      {localSearch.t.networks}
    </button>
    <button type="button" aria-pressed={searchScope === 'local'} onclick={() => changeSearchScope('local')}
      class="px-4 py-2 rounded-lg border text-sm transition-colors {searchScope === 'local' ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}">
      {localSearch.t.onDevice}
    </button>
  </div>

  {#if searchScope === 'local'}
    <LocalSearch bind:query />
  {:else}

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

    <!-- Quick filters + search help -->
    <div class="flex items-center gap-2 mt-2 flex-wrap">
      <button onclick={() => appendOperator('has:media')} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <Image size={10} /> Has media
      </button>
      <button onclick={() => { const op = fromMeOperator(accounts[0]?.handle); if (op) appendOperator(op); }} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <User size={10} /> From me
      </button>
      <button onclick={() => appendOperator(pastWeekOperator())} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <Calendar size={10} /> Past week
      </button>
      <button onclick={() => showSearchHelp = !showSearchHelp} class="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
        <HelpCircle size={10} /> Search syntax
      </button>
      <!-- Save search button -->
      {#if query.trim()}
        <button
          onclick={handleSaveSearch}
          class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md transition-colors {isSaved(query.trim()) ? 'text-[var(--color-primary-text)] border-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]'}"
        >
          {#if isSaved(query.trim())}<BookmarkCheck size={10} /> Saved{:else}<Bookmark size={10} /> Save search{/if}
        </button>
      {/if}
      <!-- Saved searches dropdown -->
      {#if savedSearches.length > 0}
        <div class="relative ml-auto">
          <button
            onclick={() => showSavedMenu = !showSavedMenu}
            class="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <Bookmark size={10} /> Saved ({savedSearches.length})
          </button>
          {#if showSavedMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-40" onclick={() => showSavedMenu = false} onkeydown={() => {}}></div>
            <div class="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[200px] max-h-48 overflow-y-auto">
              {#each savedSearches as s}
                <div class="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--color-surface-hover)]">
                  <button onclick={() => handleLoadSavedSearch(s.query)} class="flex-1 text-left text-xs truncate">{s.query}</button>
                  <button onclick={() => handleDeleteSavedSearch(s.id)} class="ml-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" aria-label={i18n.t.common.close}>
                    <X size={10} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if showSearchHelp}
      <div class="mt-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs space-y-2">
        <div>
          <span class="font-medium text-[var(--color-bluesky)]">{i18n.t.common.bluesky}</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p><code class="bg-[var(--color-bg)] px-1 rounded">from:handle.bsky.social</code>{i18n.t.search.opFromUser}</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">since:2026-01-01</code>{i18n.t.search.opSince}</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">until:2026-12-31</code>{i18n.t.search.opUntil}</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">lang:en</code>{i18n.t.search.opLang}</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">has:media</code>{i18n.t.search.opMedia}</p>
          </div>
        </div>
        <div>
          <span class="font-medium text-[var(--color-mastodon)]">{i18n.t.common.mastodon}</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p><code class="bg-[var(--color-bg)] px-1 rounded">from:@user@instance</code>{i18n.t.search.opFromUser}</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">#hashtag</code>{i18n.t.search.opTag}</p>
            <p>{i18n.t.search.fullTextNote}</p>
          </div>
        </div>
        <div>
          <span class="font-medium" style="color: var(--color-threads, #666)">{i18n.t.common.threads}</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p>{i18n.t.search.threadsNote}</p>
            <p>{i18n.t.search.requiresScope} <code class="bg-[var(--color-bg)] px-1 rounded">threads_keyword_search</code></p>
          </div>
        </div>
      </div>
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
  {:else if hasSearched && results.length === 0 && actors.length === 0 && !error}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noResults}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.search.noPostsFor.replace('{query}', query)}</p>
    </div>
  {:else if results.length > 0 || actors.length > 0}
    {#if actors.length > 0}
      <h2 class="text-sm font-semibold mb-2">{i18n.t.search.people}</h2>
      <div class="space-y-2 mb-5">
        {#each actors as actor (actor.did)}
          <a href="{base}/profile?handle={encodeURIComponent(actor.handle)}&platform={actor.platform ?? 'bluesky'}{actor.sourceAccountId === undefined ? '' : `&account=${actor.sourceAccountId}`}" class="flex items-center gap-3 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-primary)]">
            {#if actor.avatar}<img src={actor.avatar} alt="" class="w-10 h-10 rounded-full" />{:else}<span class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)]"></span>{/if}
            <span class="min-w-0"><span class="block font-semibold text-sm">{actor.displayName || actor.handle}</span><span class="block text-xs text-[var(--color-text-muted)]">@{actor.handle}</span></span>
          </a>
        {/each}
      </div>
    {/if}
    {#if results.length > 0}
    <p class="text-sm text-[var(--color-text-muted)] mb-4">{results.length} results (ranked by engagement + recency)</p>
    <div class="space-y-3">
      {#each results as post (post.uri)}
        <Post {post} />
      {/each}
    </div>
    {/if}
  {:else if hasSearched && error}
    <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.search.retrySearch}</p>
  {:else if accounts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Search size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noAccounts}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.search.addAccountsToSearch} <a href="{base}/settings" class="text-[var(--color-primary-text)] underline">{i18n.t.nav.settings}</a></p>
    </div>
  {:else}
    <!-- Pre-search suggestions -->
    <div class="text-center py-12">
      <Search size={40} class="text-[var(--color-text-muted)]/40 mx-auto mb-4" />
      <h3 class="text-base font-medium text-[var(--color-text-muted)] mb-3">{i18n.t.search.searchAcrossNetworks}</h3>
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
  {/if}
</div>
