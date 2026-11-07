<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { base } from '$app/paths';
  import { Archive, ArrowLeft, BookOpen, ChevronLeft, ChevronRight, ExternalLink, Inbox, Loader2, RefreshCw, Star } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { toast } from '$lib/toast.svelte';
  import { readString } from '$lib/safe-storage';
  import { openExternalLink } from '$lib/external-link';
  import { loadWallabagSanitizer, sanitizeWallabagHtml as sanitizeHtml, wallabagArticleUrl } from '$lib/wallabag-content';
  import { wallabagAvailability, refreshWallabagAvailability } from '$lib/wallabag-availability';
  import { getWallabagEntry, listWallabagEntries, updateWallabagEntry, type WallabagEntry, type WallabagEntryFilter } from '$lib/wallabag';

  const filters: WallabagEntryFilter[] = ['unread', 'archived', 'starred', 'all'];
  const perPage = 20;
  let filter = $state<WallabagEntryFilter>('unread');
  let searchInput = $state('');
  let searchTerm = $state('');
  let showThumbnails = $state(readString('crispdeck-wallabag-thumbnails', 'true') !== 'false');
  let entries = $state<WallabagEntry[]>([]);
  let currentPage = $state(1);
  let pages = $state(1);
  let total = $state(0);
  let loading = $state(false);
  let listError = $state(false);
  let selectedId = $state<number | null>(null);
  let selected = $state<WallabagEntry | null>(null);
  let loadingArticle = $state(false);
  let articleError = $state(false);
  let actionError = $state(false);
  let updating = $state(false);
  let articleHeading = $state<HTMLHeadingElement>();
  let readerRoot = $state<HTMLDivElement>();
  const articleHtml = $derived(selected ? sanitizeHtml(selected.content, selected.url) : '');
  const originalUrl = $derived(selected ? wallabagArticleUrl(selected.url) : null);

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

  onMount(() => {
    showThumbnails = readString('crispdeck-wallabag-thumbnails', 'true') !== 'false';
    const unsubscribe = wallabagAvailability.subscribe(connection => {
      const nextKey = connection.status === 'ready' ? `${connection.revision}:${connection.server}` : '';
      if (nextKey === connectionKey) return;
      connectionKey = nextKey;
      listRequest++; articleRequest++; mutationRequest++;
      entries = []; selected = null; selectedId = null;
      currentPage = 1; pages = 1; total = 0;
      loading = false; loadingArticle = false; updating = false;
      listError = false; articleError = false; actionError = false;
      filter = 'unread'; searchInput = ''; searchTerm = '';
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

  async function loadEntries(requestedPage = currentPage) {
    const connection = get(wallabagAvailability);
    if (connection.status !== 'ready') return;
    const request = ++listRequest;
    loading = true; listError = false;
    try {
      const result = await listWallabagEntries(connection.server, { filter, page: requestedPage, perPage, ...(searchTerm ? { search: searchTerm } : {}) });
      if (request !== listRequest || !sameConnection(connection.server, connection.revision)) return;
      // A mutation or another client may have emptied the last page.
      const lastPage = Math.max(1, result.pages);
      if (requestedPage > lastPage) { void loadEntries(lastPage); return; }
      entries = result.items;
      currentPage = result.page;
      pages = lastPage;
      total = result.total;
    } catch {
      if (request === listRequest && sameConnection(connection.server, connection.revision)) listError = true;
    } finally {
      if (request === listRequest && sameConnection(connection.server, connection.revision)) loading = false;
    }
  }

  function changeFilter(next: WallabagEntryFilter) {
    if ((next === filter && !searchTerm) || updating) return;
    searchTerm = ''; searchInput = ''; filter = next;
    entries = []; currentPage = 1; pages = 1; total = 0;
    void loadEntries(1);
  }

  function searchArticles(event: SubmitEvent) {
    event.preventDefault();
    searchTerm = searchInput.trim();
    if (searchTerm) filter = 'all';
    entries = []; currentPage = 1; pages = 1; total = 0;
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
      // Re-fetch the current filtered page, keeping the article open even when
      // marking it read removes it from the Unread list.
      const stillInView = filter === 'all' || (filter === 'unread' && !updated.is_archived) ||
        (filter === 'archived' && updated.is_archived) || (filter === 'starred' && updated.is_starred);
      // Wallabag rejects an out-of-range page, rather than returning an empty
      // page. Move back before fetching when we remove its final article.
      const nextPage = !stillInView && entries.length === 1 && entries[0].id === id
        ? Math.max(1, currentPage - 1) : currentPage;
      await loadEntries(nextPage);
    } catch {
      if (request === mutationRequest && sameConnection(connection.server, connection.revision)) actionError = true;
    } finally {
      if (request === mutationRequest && sameConnection(connection.server, connection.revision)) updating = false;
    }
  }

  function sourceLabel(entry: WallabagEntry): string {
    const href = wallabagArticleUrl(entry.url);
    return href ? new URL(href).hostname : entry.domain_name ?? '';
  }

  function readingTime(minutes: number | undefined): string {
    return minutes && minutes > 0 ? i18n.t.wallabagReader.readingTime.replace('{minutes}', String(minutes)) : '';
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
      <button class="reader-button" onclick={() => loadEntries()} disabled={loading || updating} title={i18n.t.wallabagReader.refresh} aria-label={i18n.t.wallabagReader.refresh}>
        <RefreshCw size={16} class={loading ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
      <div class="filters" role="group" aria-label={i18n.t.wallabagReader.filters}>
        {#each filters as item}
          <button class:active={filter === item} aria-pressed={filter === item} disabled={updating} onclick={() => changeFilter(item)}>{i18n.t.wallabagReader[item]}</button>
        {/each}
      </div>
      <span class="text-xs text-[var(--color-text-muted)]" aria-live="polite">{i18n.t.wallabagReader.count.replace('{count}', String(total))}</span>
      <form class="reader-search" onsubmit={searchArticles} role="search">
        <input type="search" bind:value={searchInput} placeholder={i18n.t.wallabagReader.search} aria-label={i18n.t.wallabagReader.search} />
        <button class="reader-button" type="submit" disabled={updating}>{i18n.t.wallabagReader.searchButton}</button>
      </form>
    </header>

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
        {:else if entries.length === 0 && !listError}
          <div class="reader-placeholder"><Inbox size={28} aria-hidden="true" /><p>{i18n.t.wallabagReader.empty}</p></div>
        {:else}
          <ul class="entry-list">
            {#each entries as entry (entry.id)}
              <li>
                <button data-wallabag-entry={entry.id} class:selected={selectedId === entry.id} aria-current={selectedId === entry.id ? 'true' : undefined} disabled={updating} onclick={() => openArticle(entry.id)}>
                  {#if showThumbnails && wallabagArticleUrl(entry.preview_picture, entry.url)}
                    <img class="entry-thumbnail" src={wallabagArticleUrl(entry.preview_picture, entry.url) ?? ''} alt="" loading="lazy" referrerpolicy="no-referrer" />
                  {/if}
                  <span class="entry-copy">
                    <span class="entry-title">{entry.title || i18n.t.wallabagReader.untitled}</span>
                    <span class="entry-meta">
                      <span class="truncate">{sourceLabel(entry)}</span>
                      {#if entry.reading_time}<span>{readingTime(entry.reading_time)}</span>{/if}
                      {#if entry.is_starred}<span class="inline-flex"><Star size={13} fill="currentColor" aria-hidden="true" /><span class="sr-only">{i18n.t.wallabagReader.starred}</span></span>{/if}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if total > 0}
          <nav class="reader-pagination" aria-label={i18n.t.wallabagReader.pagination}>
            <button class="reader-button" aria-label={i18n.t.wallabagReader.previous} title={i18n.t.wallabagReader.previous} disabled={loading || updating || currentPage <= 1} onclick={() => loadEntries(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <span class="text-xs text-center">{i18n.t.wallabagReader.page.replace('{page}', String(currentPage)).replace('{pages}', String(pages))}</span>
            <button class="reader-button" aria-label={i18n.t.wallabagReader.next} title={i18n.t.wallabagReader.next} disabled={loading || updating || currentPage >= pages} onclick={() => loadEntries(currentPage + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </nav>
        {/if}
      </section>

      <section class="article-panel" aria-label={i18n.t.wallabagReader.title} aria-busy={loadingArticle || updating}>
        {#if selectedId !== null}
          <div class="article-actions" role="group" aria-label={i18n.t.wallabagReader.articleActions}>
            <button class="reader-button" onclick={closeArticle}><ArrowLeft size={16} aria-hidden="true" />{i18n.t.wallabagReader.backToArticles}</button>
            {#if selected}
              <button class="reader-button" disabled={updating} onclick={() => selected && updateArticle({ archive: !selected.is_archived })}>
                <Archive size={16} aria-hidden="true" />{selected.is_archived ? i18n.t.wallabagReader.markUnread : i18n.t.wallabagReader.markRead}
              </button>
              <button class="reader-button" aria-pressed={selected.is_starred} disabled={updating} onclick={() => selected && updateArticle({ starred: !selected.is_starred })}>
                <Star size={16} fill={selected.is_starred ? 'currentColor' : 'none'} aria-hidden="true" />{selected.is_starred ? i18n.t.wallabagReader.unstar : i18n.t.wallabagReader.star}
              </button>
              {#if originalUrl}
                <a class="reader-button" href={originalUrl} target="_blank" rel="noopener noreferrer" onclick={event => openExternalLink(event, originalUrl, () => toast.error(i18n.t.post.openLinkFailed))}>
                  <ExternalLink size={16} aria-hidden="true" />{i18n.t.wallabagReader.openOriginal}
                </a>
              {/if}
            {/if}
          </div>
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
              {#if selected.reading_time}<span>{readingTime(selected.reading_time)}</span>{/if}
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
  .reader-search { display: flex; align-items: center; gap: .3rem; margin-inline-start: auto; }
  .reader-search input { min-width: 8rem; max-width: 14rem; padding: .45rem; border: 1px solid var(--color-border); border-radius: .4rem; background: var(--color-bg); }
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
  .reader-pagination { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .75rem; border-top: 1px solid var(--color-border); }
  .article-panel { min-width: 0; padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: .75rem; }
  .article-title { font-size: clamp(1.4rem, 2.5vw, 2rem); line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; }
  .article-actions { display: flex; flex-wrap: nowrap; gap: .4rem; margin-bottom: 1.2rem; padding-bottom: .75rem; border-bottom: 1px solid var(--color-border); overflow-x: auto; }
  .article-actions .reader-button { white-space: nowrap; flex-shrink: 0; }
  @media (max-width: 700px) { .article-actions .reader-button { font-size: .7rem; gap: .2rem; padding: .35rem .4rem; min-height: 2rem; } }
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
