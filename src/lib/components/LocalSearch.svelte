<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { Search, Loader2, ExternalLink, Database } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { swallow } from '$lib/debug-log';
  import { safeExternalUrl } from '$lib/safe-url';
  import { openExternalLink } from '$lib/external-link';
  import {
    getSearchCacheSettings, getSearchCacheStats, searchCache,
    type SearchCacheResult, type SearchCacheSource,
  } from '$lib/search-cache';

  let { query = $bindable('') }: { query?: string } = $props();
  let source = $state<'all' | SearchCacheSource>('all');
  let enabled = $state(getSearchCacheSettings().enabled);
  let available = $state(true);
  let count = $state<number | null>(null);
  let results: SearchCacheResult[] = $state([]);
  let searching = $state(false);
  let hasSearched = $state(false);
  let error = $state('');
  let sequence = 0;
  let disposed = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const sources: SearchCacheSource[] = ['bluesky', 'mastodon', 'threads', 'rss', 'wallabag'];

  function sourceLabel(value: SearchCacheSource): string {
    return value === 'rss' || value === 'wallabag'
      ? i18n.t.localSearch[value]
      : i18n.t.common[value];
  }

  function resultUrl(value: string): string | null {
    const safe = safeExternalUrl(value);
    return safe && /^https?:\/\//i.test(safe) ? safe : null;
  }

  function formattedDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(i18n.lang) : '';
  }

  /** Show a bounded excerpt around a matching word, even in a longer article. */
  function snippet(text: string): string {
    if (text.length <= 400) return text;
    const lower = text.toLocaleLowerCase();
    const matches = query.trim().toLocaleLowerCase().split(/\s+/)
      .map(word => lower.indexOf(word)).filter(index => index >= 0);
    const start = Math.max(0, (matches.length ? Math.min(...matches) : 0) - 80);
    const end = Math.min(text.length, start + 400);
    return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }

  async function refreshStatus() {
    const settings = getSearchCacheSettings();
    enabled = settings.enabled;
    if (!enabled) {
      sequence++;
      clearTimeout(searchTimer);
      results = [];
      searching = false;
      hasSearched = false;
    }
    try {
      const stats = await getSearchCacheStats();
      if (disposed) return;
      available = stats.available;
      count = stats.count;
      if (!count) results = [];
    } catch (cause) {
      swallow('search-cache.search.status', cause);
      if (!disposed) available = false;
    }
  }

  async function handleSearch() {
    clearTimeout(searchTimer);
    const current = ++sequence;
    const value = query.trim();
    if (!value || !enabled || !available) {
      results = [];
      searching = false;
      hasSearched = false;
      return;
    }
    searching = true;
    hasSearched = true;
    error = '';
    try {
      const found = await searchCache(value, { source: source === 'all' ? undefined : source, limit: 100 });
      if (!disposed && current === sequence) results = found;
    } catch (cause) {
      swallow('search-cache.search', cause);
      if (!disposed && current === sequence) {
        results = [];
        error = i18n.t.localSearch.searchFailed;
      }
    } finally {
      if (!disposed && current === sequence) searching = false;
    }
  }

  function scheduleSearch() {
    sequence++;
    clearTimeout(searchTimer);
    error = '';
    results = [];
    hasSearched = false;
    searching = false;
    if (query.trim() && enabled && available) searchTimer = setTimeout(() => { void handleSearch(); }, 180);
  }

  onMount(() => {
    void refreshStatus().then(() => { if (!disposed && query.trim()) void handleSearch(); });
    const changed = () => {
      // Ingestion can emit one event per batch; coalesce the status reads.
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        void refreshStatus().then(() => {
          if (!disposed && enabled && hasSearched) void handleSearch();
        });
      }, 150);
    };
    window.addEventListener('search-cache-changed', changed);
    return () => {
      disposed = true;
      sequence++;
      clearTimeout(searchTimer);
      clearTimeout(statusTimer);
      window.removeEventListener('search-cache-changed', changed);
    };
  });
</script>

<section aria-label={i18n.t.localSearch.onDevice}>
  <p id="local-search-description" class="text-sm text-[var(--color-text-muted)] mb-4">{i18n.t.localSearch.searchDescription}</p>

  <form onsubmit={(event) => { event.preventDefault(); void handleSearch(); }} class="space-y-3 mb-6">
    <div class="flex gap-2">
      <input
        type="search"
        value={query}
        oninput={(event) => { query = event.currentTarget.value; scheduleSearch(); }}
        aria-label={i18n.t.localSearch.placeholder}
        aria-describedby="local-search-description"
        placeholder={i18n.t.localSearch.placeholder}
        class="min-w-0 flex-1 px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-primary)]"
      />
      <button type="submit" disabled={!enabled || !available || !query.trim() || searching}
        class="flex items-center gap-2 px-4 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-lg disabled:opacity-50">
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}<Search size={14} />{/if}
        {i18n.t.search.button}
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <label for="local-search-source" class="text-xs text-[var(--color-text-muted)]">{i18n.t.localSearch.source}</label>
      <select id="local-search-source" value={source}
        onchange={(event) => { source = event.currentTarget.value as typeof source; scheduleSearch(); }}
        class="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-sm">
        <option value="all">{i18n.t.localSearch.allSources}</option>
        {#each sources as item}<option value={item}>{sourceLabel(item)}</option>{/each}
      </select>
      <a href="{base}/settings?tab=content#local-search-cache" class="text-xs text-[var(--color-primary-text)] underline">{i18n.t.localSearch.settings}</a>
    </div>
  </form>

  {#if !enabled}
    <p class="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)]">{i18n.t.localSearch.disabled}</p>
  {:else if !available}
    <p role="alert" class="p-4 border border-[var(--color-border)] rounded-lg text-sm">{i18n.t.localSearch.unavailable}</p>
  {:else if error}
    <p role="alert" class="p-4 border border-[var(--color-danger)] rounded-lg text-sm">{error}</p>
  {:else if searching}
    <div role="status" class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
      <Loader2 size={18} class="animate-spin" />{i18n.t.search.searching}
    </div>
  {:else if hasSearched && results.length > 0}
    <p role="status" class="text-sm text-[var(--color-text-muted)] mb-4">{i18n.t.localSearch.results.replace('{count}', String(results.length))}</p>
    <div class="space-y-3">
      {#each results as result (result.id)}
        {@const url = resultUrl(result.url)}
        <article class="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg min-w-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)] mb-2">
            <span class="font-medium">{sourceLabel(result.source)}</span>
            {#if result.author}<span class="break-all">{result.author}</span>{/if}
            <time datetime={result.createdAt}>{formattedDate(result.createdAt)}</time>
          </div>
          <h2 class="font-semibold text-sm break-words">
            {#if url}
              <a href={url} target="_blank" rel="noopener noreferrer" class="hover:underline text-[var(--color-primary-text)]"
                onclick={(event) => openExternalLink(event, url, () => { error = i18n.t.localSearch.searchFailed; })}>
                {result.title || i18n.t.localSearch.untitled}
              </a>
            {:else}{result.title || i18n.t.localSearch.untitled}{/if}
          </h2>
          {#if result.excerpt}<p class="text-sm whitespace-pre-line break-words mt-2">{snippet(result.excerpt)}</p>{/if}
          <div class="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-[var(--color-text-muted)]">
            <span>{i18n.t.localSearch.cached.replace('{date}', formattedDate(result.indexedAt))}</span>
            {#if url}
              <a href={url} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 hover:underline"
                onclick={(event) => openExternalLink(event, url, () => { error = i18n.t.localSearch.searchFailed; })}>
                {i18n.t.localSearch.open}<ExternalLink size={12} />
              </a>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    {#if results.length === 100}<p class="text-xs text-[var(--color-text-muted)] mt-4">{i18n.t.localSearch.resultLimit}</p>{/if}
  {:else if hasSearched}
    <p role="status" class="py-8 text-center text-sm text-[var(--color-text-muted)]">{i18n.t.localSearch.noResults}</p>
  {:else if count === 0}
    <div class="text-center p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-muted)]">
      <Database size={28} class="mx-auto mb-3" />
      <p class="text-sm">{i18n.t.localSearch.empty}</p>
    </div>
  {/if}
</section>
