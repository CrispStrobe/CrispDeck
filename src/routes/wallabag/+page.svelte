<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { base } from '$app/paths';
  import { Archive, ArrowLeft, BookOpen, ChevronDown, ExternalLink, Inbox, Loader2, RefreshCw, SlidersHorizontal, Star } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { toast } from '$lib/toast.svelte';
  import { readString } from '$lib/safe-storage';
  import { openExternalLink } from '$lib/external-link';
  import { formatDate } from '$lib/time-format';
  import { loadWallabagSanitizer, sanitizeWallabagHtml as sanitizeHtml, wallabagArticleUrl } from '$lib/wallabag-content';
  import { wallabagAvailability, refreshWallabagAvailability } from '$lib/wallabag-availability';
  import { getWallabagEntry, listWallabagEntries, updateWallabagEntry, type WallabagEntry, type WallabagEntryFilter } from '$lib/wallabag';

  type ReaderSort = 'newest' | 'oldest' | 'updated' | 'archived' | 'best' | 'title' | 'source';
  const filters: WallabagEntryFilter[] = ['unread', 'archived', 'starred', 'all'];
  // Search responses include full article bodies, so a smaller page bounds the
  // payload; ordinary metadata listings can afford a larger one.
  const listPerPage = 50;
  const searchPerPage = 20;
  let filter = $state<WallabagEntryFilter>('unread');
  let searchInput = $state('');
  let searchTerm = $state('');
  let sourceInput = $state('');
  let sourceDomain = $state('');
  let sort = $state<ReaderSort>('newest');
  let titleSourceOnly = $state(false);
  let showFilterPanel = $state(false);
  let showingLocalResults = $state(false);
  let showThumbnails = $state(readString('crispdeck-wallabag-thumbnails', 'true') !== 'false');
  let entries = $state<WallabagEntry[]>([]);
  let currentPage = $state(1);
  let pages = $state(1);
  let total = $state(0);
  let loading = $state(false);
  let loadingMore = $state(false);
  let listError = $state(false);
  let loadMoreError = $state(false);
  let selectedId = $state<number | null>(null);
  let selected = $state<WallabagEntry | null>(null);
  let loadingArticle = $state(false);
  let articleError = $state(false);
  let actionError = $state(false);
  let updating = $state(false);
  let articleHeading = $state<HTMLHeadingElement>();
  let readerRoot = $state<HTMLDivElement>();
  let scrollSentinel = $state<HTMLDivElement>();
  const articleHtml = $derived(selected ? sanitizeHtml(selected.content, selected.url) : '');
  const originalUrl = $derived(selected ? wallabagArticleUrl(selected.url) : null);
  const hasMore = $derived(currentPage < pages);
  const perPage = $derived(searchTerm ? searchPerPage : listPerPage);

  const displayedEntries = $derived.by(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    let list = entries;
    if (term && titleSourceOnly) list = list.filter(entry => relevanceScore(entry, term) > 0);
    list = [...list];
    switch (sort) {
      case 'oldest':
        list.sort((a, b) => compareDates(a.created_at, b.created_at));
        break;
      case 'updated':
        list.sort((a, b) => compareDates(b.updated_at ?? b.created_at, a.updated_at ?? a.created_at));
        break;
      case 'archived':
        list.sort((a, b) => compareDates(b.archived_at ?? b.created_at, a.archived_at ?? a.created_at));
        break;
      case 'best':
        list.sort((a, b) => relevanceScore(b, term) - relevanceScore(a, term) || compareDates(b.created_at, a.created_at));
        break;
      case 'title':
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '') || compareDates(b.created_at, a.created_at));
        break;
      case 'source':
        list.sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)) || compareDates(b.created_at, a.created_at));
        break;
      default:
        list.sort((a, b) => compareDates(b.created_at, a.created_at));
    }
    return list;
  });

  // The saved account may change while any one of these requests is in flight.
  // Ignore both stale successes and stale errors; never retain the old article.
  let disposed = false;
  let listRequest = 0;
  let articleRequest = 0;
  let mutationRequest = 0;
  let connectionKey: string | null = null;

  function sameConnection(server: string, revision: number): boolean {
    const current = get(wallabagAvailability);
    return !disposed && current.status === 'ready' && current.server === server && current.revision === revision;
  }

  function resetList(): void {
    entries = [];
    currentPage = 1;
    pages = 1;
    total = 0;
    listError = false;
    loadMoreError = false;
    showingLocalResults = false;
  }

  onMount(() => {
    showThumbnails = readString('crispdeck-wallabag-thumbnails', 'true') !== 'false';
    const unsubscribe = wallabagAvailability.subscribe(connection => {
      const nextKey = connection.status === 'ready' ? `${connection.revision}:${connection.server}` : '';
      if (nextKey === connectionKey) return;
      connectionKey = nextKey;
      listRequest++; articleRequest++; mutationRequest++;
      entries = []; selected = null; selectedId = null;
      currentPage = 1; pages = 1; total = 0;
      loading = false; loadingMore = false; loadingArticle = false; updating = false;
      listError = false; loadMoreError = false; articleError = false; actionError = false;
      filter = 'unread'; searchInput = ''; searchTerm = ''; sourceInput = ''; sourceDomain = ''; sort = 'newest';
      if (connection.status === 'ready') void loadEntries(1);
    });
    // The app shell normally starts verification. Direct mounts also work,
    // without racing a validation that is already underway.
    if (get(wallabagAvailability).status === 'hidden') void refreshWallabagAvailability();
    return () => {
      disposed = true;
      listRequest++; articleRequest++; mutationRequest++;
      unsubscribe();
    };
  });

  // Infinite scroll: the sentinel only exists while another page is available,
  // so observing a newly inserted sentinel immediately fills a short viewport.
  $effect(() => {
    const sentinel = scrollSentinel;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '600px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  async function loadEntries(requestedPage = 1, append = false) {
    const connection = get(wallabagAvailability);
    if (connection.status !== 'ready') return;
    const request = ++listRequest;
    const appending = append && requestedPage > 1;
    if (appending) { loadingMore = true; loadMoreError = false; }
    else { loading = true; listError = false; }
    try {
      const result = await listWallabagEntries(connection.server, {
        filter, page: requestedPage, perPage,
        ...(searchTerm ? { search: searchTerm } : {}),
        ...(sourceDomain ? { domain: sourceDomain } : {}),
      });
      if (request !== listRequest || !sameConnection(connection.server, connection.revision)) return;
      // A mutation or another client may have emptied the last page.
      const lastPage = Math.max(1, result.pages);
      if (requestedPage > lastPage) {
        if (appending) { pages = lastPage; currentPage = lastPage; }
        else void loadEntries(lastPage);
        return;
      }
      const items = sourceDomain && searchTerm
        ? result.items.filter(entry => matchesText(entry, searchTerm))
        : result.items;
      if (appending) {
        const seen = new Set(entries.map(entry => entry.id));
        entries = [...entries, ...items.filter(entry => !seen.has(entry.id))];
      } else {
        entries = items;
      }
      showingLocalResults = false;
      currentPage = result.page;
      pages = lastPage;
      total = result.total;
    } catch {
      if (request === listRequest && sameConnection(connection.server, connection.revision)) {
        if (appending) loadMoreError = true;
        else listError = true;
      }
    } finally {
      if (request === listRequest && sameConnection(connection.server, connection.revision)) {
        if (appending) loadingMore = false;
        else loading = false;
      }
    }
  }

  function loadMore(): void {
    if (loading || loadingMore || updating || !hasMore) return;
    void loadEntries(currentPage + 1, true);
  }

  function changeFilter(next: WallabagEntryFilter) {
    if ((next === filter && !searchTerm) || updating) return;
    searchTerm = ''; searchInput = ''; filter = next;
    if (sort === 'best') sort = 'newest';
    resetList();
    void loadEntries(1);
  }

  function changeSort(next: ReaderSort) {
    sort = next;
  }

  async function searchArticles(event: SubmitEvent) {
    event.preventDefault();
    searchTerm = searchInput.trim();
    sourceDomain = sourceInput.trim().toLocaleLowerCase();
    if (searchTerm) {
      filter = 'all';
      if (sort === 'newest') sort = 'best';
    } else if (sort === 'best') {
      sort = 'newest';
    }
    resetList();
    const connection = get(wallabagAvailability);
    const request = ++listRequest;
    const term = searchTerm;
    if (connection.status !== 'ready') return;
    loading = true;
    try {
      if (term) {
        const { getSearchCacheSettings, searchCache } = await import('$lib/search-cache');
        const settings = getSearchCacheSettings();
        if (settings.enabled && settings.wallabag.enabled) {
          const { wallabagSearchScope } = await import('$lib/wallabag');
          const scope = await wallabagSearchScope(connection.server);
          const matches = await searchCache(term, { source: 'wallabag', scope, limit: 100 });
          if (request !== listRequest || !sameConnection(connection.server, connection.revision)) return;
          entries = matches.flatMap(item => {
            try {
              if (sourceDomain && !item.url.toLocaleLowerCase().includes(sourceDomain)) return [];
              const parts: unknown = JSON.parse(item.id);
              if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== 'wallabag' || parts[1] !== scope) return [];
              const id = Number(parts[2]);
              if (!Number.isSafeInteger(id) || id <= 0) return [];
              return [{ id, title: item.title, url: item.url, content: '', created_at: item.createdAt, is_archived: false, is_starred: false, tags: [] }];
            } catch { return []; }
          });
          total = entries.length; showingLocalResults = true;
        }
      }
    } catch { /* Local indexing is optional: server search remains available. */ }
    if (request !== listRequest || !sameConnection(connection.server, connection.revision)) return;
    // Always search Wallabag as well: locally retained excerpts may be incomplete.
    void loadEntries(1);
  }

  async function openArticle(id: number) {
    const connection = get(wallabagAvailability);
    if (connection.status !== 'ready' || updating) return;
    const request = ++articleRequest;
    selectedId = id; selected = null;
    loadingArticle = true; articleError = false; actionError = false;
    try {
      // Never expose the article until the lazily downloaded sanitizer is
      // ready. Both failures remain retryable, and the connection guard below
      // also covers switching accounts while the sanitizer is loading.
      const [entry] = await Promise.all([getWallabagEntry(connection.server, id), loadWallabagSanitizer()]);
      if (request !== articleRequest || !sameConnection(connection.server, connection.revision)) return;
      selected = entry;
      loadingArticle = false;
      await tick();
      if (request === articleRequest && sameConnection(connection.server, connection.revision)) articleHeading?.focus();
    } catch {
      if (request === articleRequest && sameConnection(connection.server, connection.revision)) articleError = true;
    } finally {
      if (request === articleRequest && sameConnection(connection.server, connection.revision)) loadingArticle = false;
    }
  }

  async function closeArticle() {
    const previousId = selectedId;
    articleRequest++;
    selectedId = null; selected = null;
    loadingArticle = false; articleError = false; actionError = false;
    await tick();
    if (!disposed && previousId !== null) readerRoot?.querySelector<HTMLButtonElement>(`[data-wallabag-entry="${previousId}"]`)?.focus();
  }

  async function updateArticle(changes: { archive?: boolean; starred?: boolean }) {
    const connection = get(wallabagAvailability);
    if (connection.status !== 'ready' || !selected || updating) return;
    const request = ++mutationRequest;
    const id = selected.id;
    updating = true; actionError = false;
    try {
      const updated = await updateWallabagEntry(connection.server, id, changes);
      if (request !== mutationRequest || !sameConnection(connection.server, connection.revision)) return;
      if (selectedId === id) selected = updated;
      // Remove the row locally when it no longer belongs to this view. This
      // keeps every already loaded page and the reader's scroll position; a
      // page reload here would jump back to the first page and could request
      // an out-of-range page after removing its final item.
      const inFilter = filter === 'all' || (filter === 'unread' && !updated.is_archived) ||
        (filter === 'archived' && updated.is_archived) || (filter === 'starred' && updated.is_starred);
      const inSource = !sourceDomain || matchesSource(updated, sourceDomain);
      const inSearch = !searchTerm || !sourceDomain || matchesText(updated, searchTerm);
      const stillInView = inFilter && inSource && inSearch;
      if (stillInView) {
        entries = entries.map(entry => entry.id === id ? updated : entry);
      } else {
        entries = entries.filter(entry => entry.id !== id);
        total = Math.max(0, total - 1);
      }
    } catch {
      if (request === mutationRequest && sameConnection(connection.server, connection.revision)) actionError = true;
    } finally {
      if (request === mutationRequest && sameConnection(connection.server, connection.revision)) updating = false;
    }
  }

  function compareDates(a: string | undefined, b: string | undefined): number {
    const left = a ? Date.parse(a) : 0;
    const right = b ? Date.parse(b) : 0;
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  }

  function sourceLabel(entry: WallabagEntry): string {
    const href = wallabagArticleUrl(entry.url);
    return href ? new URL(href).hostname : entry.domain_name ?? '';
  }

  function matchesSource(entry: WallabagEntry, domain: string): boolean {
    const source = sourceLabel(entry).toLocaleLowerCase();
    return source === domain || source.endsWith(`.${domain}`) || entry.url.toLocaleLowerCase().includes(domain);
  }

  function matchesText(entry: WallabagEntry, term: string): boolean {
    const value = term.trim().toLocaleLowerCase();
    if (!value) return true;
    return [entry.title, entry.url, sourceLabel(entry), ...entry.tags.map(tag => tag.label)]
      .some(text => text.toLocaleLowerCase().includes(value));
  }

  /** Title and source hits outrank a passing mention in the article body. */
  function relevanceScore(entry: WallabagEntry, term: string): number {
    const value = term.trim().toLocaleLowerCase();
    if (!value) return 0;
    const title = entry.title.toLocaleLowerCase();
    const source = sourceLabel(entry).toLocaleLowerCase();
    const url = entry.url.toLocaleLowerCase();
    let score = 0;
    if (title === value || source === value) score += 100;
    if (title.startsWith(value)) score += 60;
    else if (title.includes(value)) score += 40;
    if (source.includes(value)) score += 50;
    else if (url.includes(value)) score += 20;
    if (entry.tags.some(tag => tag.label.toLocaleLowerCase().includes(value))) score += 10;
    return score;
  }

  function archiveDate(entry: WallabagEntry): string {
    return formatDate(entry.archived_at ?? entry.created_at);
  }

  function sizeLabel(entry: WallabagEntry): string {
    if (!entry.content_bytes) return '';
    return `${Math.max(1, Math.round(entry.content_bytes / 1024))} KB`;
  }

  function openContentLink(event: MouseEvent) {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor?.href) openExternalLink(event, anchor.href, () => toast.error(i18n.t.post.openLinkFailed));
  }
</script>

<svelte:head>
  <title>CrispDeck — {i18n.t.wallabagReader.title}</title>
  <meta name="description" content={i18n.t.wallabagReader.description} />
</svelte:head>

<div class="wallabag-reader p-4 sm:p-6" bind:this={readerRoot}>
  {#if $wallabagAvailability.status === 'checking'}
    <div class="reader-placeholder" role="status">
      <Loader2 size={24} class="animate-spin" aria-hidden="true" />
      <p>{i18n.t.wallabagReader.checking}</p>
    </div>
  {:else if $wallabagAvailability.status !== 'ready'}
    <div class="reader-placeholder">
      <BookOpen size={32} aria-hidden="true" />
      <h1 class="text-xl font-semibold">{i18n.t.wallabagReader.unavailableTitle}</h1>
      <p class="max-w-md">{i18n.t.wallabagReader.unavailableHint}</p>
      <div class="flex flex-wrap justify-center gap-2">
        <a class="reader-button primary" href="{base}/settings?tab=appearance#wallabag-settings">{i18n.t.wallabagReader.openSettings}</a>
        <button class="reader-button" onclick={() => refreshWallabagAvailability()}>{i18n.t.wallabagReader.retry}</button>
      </div>
    </div>
  {:else}
    <header class="reader-toolbar">
      <h1 class="flex items-center gap-2 text-xl font-bold"><BookOpen size={22} aria-hidden="true" />{i18n.t.wallabagReader.title}</h1>
      <button class="reader-button" onclick={() => loadEntries(1)} disabled={loading || updating} title={i18n.t.wallabagReader.refresh} aria-label={i18n.t.wallabagReader.refresh}>
        <RefreshCw size={16} class={loading ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
      <div class="filters" role="group" aria-label={i18n.t.wallabagReader.filters}>
        {#each filters as item}
          <button class:active={filter === item} aria-pressed={filter === item} disabled={updating} onclick={() => changeFilter(item)}>{i18n.t.wallabagReader[item]}</button>
        {/each}
      </div>
      <button class="reader-button" aria-expanded={showFilterPanel} aria-controls="wallabag-filter-panel" title={i18n.t.settings.filterSortTitle} aria-label={i18n.t.settings.filterSortTitle} onclick={() => showFilterPanel = !showFilterPanel}>
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      <span class="text-xs text-[var(--color-text-muted)]" aria-live="polite">{showingLocalResults ? (listError ? i18n.t.wallabagReader.localPartial : i18n.t.wallabagReader.localResults) : i18n.t.wallabagReader.count.replace('{count}', String(total))}</span>
      <form class="reader-search" onsubmit={searchArticles} role="search">
        <input type="search" bind:value={searchInput} placeholder={i18n.t.wallabagReader.search} aria-label={i18n.t.wallabagReader.search} />
        <input type="text" inputmode="url" autocapitalize="none" spellcheck="false" bind:value={sourceInput} placeholder="en.wikipedia.org" aria-label={i18n.t.wallabagReader.sourceFilter} title={i18n.t.wallabagReader.sourceFilter} />
        <button class="reader-button" type="submit" disabled={updating}>{i18n.t.wallabagReader.searchButton}</button>
      </form>
    </header>

    {#if showFilterPanel}
      <div id="wallabag-filter-panel" class="reader-filter-panel">
        <label>
          <span>{i18n.t.settings.filterSortTitle}</span>
          <select value={sort} onchange={(event) => changeSort((event.currentTarget as HTMLSelectElement).value as ReaderSort)}>
            <option value="newest">{i18n.t.settings.filterSortNewest}</option>
            <option value="oldest">{i18n.t.settings.filterSortOldest}</option>
            <option value="updated">{i18n.t.wallabagReader.sortUpdated}</option>
            <option value="archived">{i18n.t.wallabagReader.archived}</option>
            <option value="best">{i18n.t.wallabagReader.sortBestMatch}</option>
            <option value="title">{i18n.t.wallabagReader.sortTitle}</option>
            <option value="source">{i18n.t.wallabagReader.sortSource}</option>
          </select>
        </label>
        <label class="reader-check">
          <input type="checkbox" bind:checked={titleSourceOnly} disabled={!searchTerm} />
          <span>{i18n.t.wallabagReader.sourceOnly}</span>
        </label>
        <button class="reader-button" type="button" onclick={() => { searchInput = ''; searchTerm = ''; sourceInput = ''; sourceDomain = ''; titleSourceOnly = false; sort = 'newest'; resetList(); void loadEntries(1); }}>{i18n.t.common.clear}</button>
      </div>
    {/if}

    <div class="reader-grid" class:has-selection={selectedId !== null}>
      <section class="article-list" aria-label={i18n.t.wallabagReader.articles} aria-busy={loading}>
        {#if listError}
          <div class="reader-error" role="alert">
            <p>{i18n.t.wallabagReader.listFailed}</p>
            <button class="reader-button" onclick={() => loadEntries()} disabled={loading}>{i18n.t.wallabagReader.retry}</button>
          </div>
        {/if}
        {#if loading && entries.length === 0}
          <div class="reader-placeholder" role="status"><Loader2 size={22} class="animate-spin" aria-hidden="true" /><p>{i18n.t.common.loading}</p></div>
        {:else if displayedEntries.length === 0 && !listError}
          <div class="reader-placeholder"><Inbox size={28} aria-hidden="true" /><p>{i18n.t.wallabagReader.empty}</p></div>
        {:else}
          <ul class="entry-list">
            {#each displayedEntries as entry (entry.id)}
              <li>
                <button data-wallabag-entry={entry.id} class:selected={selectedId === entry.id} aria-current={selectedId === entry.id ? 'true' : undefined} disabled={updating} onclick={() => openArticle(entry.id)}>
                  {#if showThumbnails && wallabagArticleUrl(entry.preview_picture, entry.url)}
                    <img class="entry-thumbnail" src={wallabagArticleUrl(entry.preview_picture, entry.url) ?? ''} alt="" loading="lazy" referrerpolicy="no-referrer" />
                  {/if}
                  <span class="entry-copy">
                    <span class="entry-title">{entry.title || i18n.t.wallabagReader.untitled}</span>
                    <span class="entry-meta">
                      <span class="truncate">{sourceLabel(entry)}</span>
                      <span>{archiveDate(entry)}</span>
                      {#if sizeLabel(entry)}<span>{sizeLabel(entry)}</span>{/if}
                      {#if entry.is_starred}<span class="inline-flex"><Star size={13} fill="currentColor" aria-hidden="true" /><span class="sr-only">{i18n.t.wallabagReader.starred}</span></span>{/if}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if loadMoreError}
          <div class="reader-error" role="alert">
            <p>{i18n.t.wallabagReader.listFailed}</p>
            <button class="reader-button" onclick={loadMore} disabled={loadingMore}>{i18n.t.wallabagReader.retry}</button>
          </div>
        {/if}

        {#if hasMore || loadingMore}
          <div class="reader-sentinel" bind:this={scrollSentinel} role="status" aria-live="polite">
            {#if loadingMore}
              <Loader2 size={18} class="animate-spin" aria-hidden="true" />
              <span>{i18n.t.feed.loadingMore}</span>
            {:else}
              <span>{i18n.t.feed.scrollMore}</span>
            {/if}
          </div>
        {/if}
      </section>

      <section class="article-panel" aria-label={i18n.t.wallabagReader.title} aria-busy={loadingArticle || updating}>
        {#snippet articleActions()}
          <div class="article-actions" role="group" aria-label={i18n.t.wallabagReader.articleActions}>
            <button class="reader-button" onclick={closeArticle} title={i18n.t.wallabagReader.backToArticles} aria-label={i18n.t.wallabagReader.backToArticles}><ArrowLeft size={16} aria-hidden="true" /></button>
            {#if selected}
              <button class="reader-button" disabled={updating} title={selected.is_archived ? i18n.t.wallabagReader.markUnread : i18n.t.wallabagReader.markRead} aria-label={selected.is_archived ? i18n.t.wallabagReader.markUnread : i18n.t.wallabagReader.markRead} onclick={() => selected && updateArticle({ archive: !selected.is_archived })}>
                <Archive size={16} aria-hidden="true" />
              </button>
              <button class="reader-button" aria-pressed={selected.is_starred} disabled={updating} title={selected.is_starred ? i18n.t.wallabagReader.unstar : i18n.t.wallabagReader.star} aria-label={selected.is_starred ? i18n.t.wallabagReader.unstar : i18n.t.wallabagReader.star} onclick={() => selected && updateArticle({ starred: !selected.is_starred })}>
                <Star size={16} fill={selected.is_starred ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
              {#if originalUrl}
                <a class="reader-button" href={originalUrl} target="_blank" rel="noopener noreferrer" title={i18n.t.wallabagReader.openOriginal} aria-label={i18n.t.wallabagReader.openOriginal} onclick={event => openExternalLink(event, originalUrl, () => toast.error(i18n.t.post.openLinkFailed))}>
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
              {/if}
            {/if}
          </div>
        {/snippet}
        {#if selectedId !== null}
          {@render articleActions()}
        {/if}
        {#if loadingArticle}
          <div class="reader-placeholder" role="status"><Loader2 size={24} class="animate-spin" aria-hidden="true" /><p>{i18n.t.common.loading}</p></div>
        {:else if articleError}
          <div class="reader-error" role="alert">
            <p>{i18n.t.wallabagReader.articleFailed}</p>
            <button class="reader-button" onclick={() => selectedId !== null && openArticle(selectedId)}>{i18n.t.wallabagReader.retry}</button>
          </div>
        {:else if selected}
          <article>
            <h2 class="article-title" tabindex="-1" bind:this={articleHeading}>{selected.title || i18n.t.wallabagReader.untitled}</h2>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-sm text-[var(--color-text-muted)]">
              <span>{sourceLabel(selected)}</span>
              <span>{archiveDate(selected)}</span>
              {#if sizeLabel(selected)}<span>{sizeLabel(selected)}</span>{/if}
            </div>
            {#if actionError}<p class="reader-error" role="alert">{i18n.t.wallabagReader.updateFailed}</p>{/if}
            {#if articleHtml.trim()}
              <!-- These handlers delegate clicks from sanitized native anchors. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="article-content" dir="auto" onclick={openContentLink}>{@html articleHtml}</div>
            {:else}
              <p class="reader-placeholder">{i18n.t.wallabagReader.noContent}</p>
            {/if}
            {@render articleActions()}
          </article>
        {:else}
          <div class="reader-placeholder"><BookOpen size={36} aria-hidden="true" /><p>{i18n.t.wallabagReader.chooseArticle}</p></div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .wallabag-reader { max-width: 1440px; margin-inline: auto; }
  .reader-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-bottom: 1rem; }
  .reader-search { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; margin-inline-start: auto; }
  .reader-search input { min-width: 8rem; max-width: 14rem; padding: .45rem; border: 1px solid var(--color-border); border-radius: .4rem; background: var(--color-bg); }
  .reader-search input[type="text"] { min-width: 10rem; }
  .reader-filter-panel { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-bottom: 1rem; padding: .75rem; border: 1px solid var(--color-border); border-radius: .5rem; background: var(--color-surface); font-size: .8rem; }
  .reader-filter-panel label { display: flex; align-items: center; gap: .4rem; color: var(--color-text-muted); }
  .reader-filter-panel select { padding: .4rem; border: 1px solid var(--color-border); border-radius: .4rem; background: var(--color-bg); color: var(--color-text); }
  .reader-check { cursor: pointer; }
  .reader-sentinel { display: flex; align-items: center; justify-content: center; gap: .5rem; padding: 1rem; border-top: 1px solid var(--color-border); color: var(--color-text-muted); font-size: .8rem; }
  .reader-grid { display: grid; grid-template-columns: minmax(15rem, 21rem) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
  .article-list { min-width: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: .75rem; background: var(--color-surface); }
  .filters { display: flex; flex-wrap: wrap; gap: .25rem; }
  .filters button { min-height: 2.5rem; flex: 1 0 auto; border-radius: .4rem; padding: .45rem .6rem; font-size: .8rem; color: var(--color-text-muted); }
  .filters button.active { color: var(--color-text); background: var(--color-surface-hover); font-weight: 600; box-shadow: inset 0 -2px var(--color-primary); }
  .entry-list { margin: 0; padding: 0; list-style: none; }
  .entry-list li { border-top: 1px solid var(--color-border); }
  .entry-list button { width: 100%; padding: 1rem; text-align: start; display: flex; flex-direction: row; align-items: center; gap: .7rem; border-inline-start: 3px solid transparent; }
  .entry-list button:hover, .entry-list button.selected { background: var(--color-surface-hover); }
  .entry-list button.selected { border-inline-start-color: var(--color-primary); }
  .entry-thumbnail { width: 4rem; height: 4rem; flex: none; object-fit: cover; border-radius: .35rem; }
  .entry-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: .3rem; }
  .entry-title { font-weight: 600; font-size: .95rem; line-height: 1.45; overflow-wrap: anywhere; }
  .entry-meta { display: flex; width: 100%; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: .5rem; font-size: .75rem; color: var(--color-text-muted); }
  .article-panel { min-width: 0; padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: .75rem; }
  .article-title { font-size: clamp(1.4rem, 2.5vw, 2rem); line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; }
  .article-actions { display: flex; flex-wrap: nowrap; gap: .4rem; margin-bottom: 1.2rem; padding-bottom: .75rem; border-bottom: 1px solid var(--color-border); overflow-x: auto; }
  .article-actions .reader-button { white-space: nowrap; flex-shrink: 0; min-width: 44px; min-height: 44px; padding: .5rem; }
  article .article-actions { margin-top: 1.5rem; margin-bottom: 0; padding-top: .75rem; border-top: 1px solid var(--color-border); border-bottom: 0; }
  .reader-button { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.5rem; padding: .5rem .7rem; border: 1px solid var(--color-border); border-radius: .5rem; font-size: .8rem; line-height: 1.35; }
  .reader-button:hover:not(:disabled) { background: var(--color-surface-hover); }
  .reader-button.primary { background: var(--color-primary); color: white; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible, a:focus-visible, .article-title:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
  .reader-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 3rem 1.25rem; text-align: center; color: var(--color-text-muted); font-size: .9rem; }
  .reader-error { display: flex; flex-direction: column; align-items: start; gap: .75rem; margin: .75rem; padding: .9rem; border: 1px solid var(--color-border); border-radius: .5rem; font-size: .9rem; }
  .article-content { max-width: 75ch; font-size: 1rem; line-height: 1.85; overflow-wrap: anywhere; }
  .article-content :global(p), .article-content :global(ul), .article-content :global(ol), .article-content :global(dl), .article-content :global(figure), .article-content :global(pre), .article-content :global(blockquote), .article-content :global(table) { margin-block: 1.2em; }
  .article-content :global(h1), .article-content :global(h2), .article-content :global(h3), .article-content :global(h4), .article-content :global(h5), .article-content :global(h6) { font-weight: 700; line-height: 1.35; margin-block: 1.5em .6em; }
  .article-content :global(h1) { font-size: 1.75em; }
  .article-content :global(h2) { font-size: 1.5em; }
  .article-content :global(h3) { font-size: 1.25em; }
  .article-content :global(ul) { list-style: disc; padding-inline-start: 1.6em; }
  .article-content :global(ol) { list-style: decimal; padding-inline-start: 1.6em; }
  .article-content :global(li) { margin-block: .3em; }
  .article-content :global(a) { color: var(--color-primary); text-decoration: underline; text-underline-offset: .15em; }
  .article-content :global(img) { display: block; max-width: 100%; height: auto; border-radius: .4rem; margin-block: 1rem; }
  .article-content :global(figcaption), .article-content :global(caption) { font-size: .85em; color: var(--color-text-muted); }
  .article-content :global(blockquote) { border-inline-start: 3px solid var(--color-primary); padding-inline-start: 1em; color: var(--color-text-muted); }
  .article-content :global(pre) { max-width: 100%; overflow-x: auto; white-space: pre; padding: 1rem; border-radius: .5rem; background: var(--color-bg); font-size: .85em; }
  .article-content :global(code), .article-content :global(kbd) { font-family: ui-monospace, monospace; }
  .article-content :global(table) { display: block; overflow-x: auto; border-collapse: collapse; }
  .article-content :global(th), .article-content :global(td) { border: 1px solid var(--color-border); padding: .5em .75em; text-align: start; }
  .article-content :global(th) { font-weight: 600; }
  .article-content :global(hr) { border: 0; border-top: 1px solid var(--color-border); margin-block: 2em; }
  @media (max-width: 900px) {
    .reader-grid { grid-template-columns: minmax(0, 1fr); }
    .reader-grid:not(.has-selection) .article-panel { display: none; }
    .reader-grid.has-selection .article-list { display: none; }
    .article-panel { padding: 1.25rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.wallabag-reader .animate-spin) { animation: none; }
  }
</style>
