<script lang="ts">
  import { useLocalSearchTranslations } from '$lib/local-search-i18n.svelte';
  const localSearch = useLocalSearchTranslations();
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { Loader2 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { swallow } from '$lib/debug-log';
  import {
    getSearchCacheSettings, updateSearchCacheSettings, getSearchCacheStats,
    clearSearchCache, rebuildSearchCache, type SearchCacheSettings,
  } from '$lib/search-cache';
  import { indexExistingSearchCache, syncWallabagSearchCache, type SearchCacheSyncProgress, type SearchCacheSyncResult } from '$lib/search-cache-ingest';

  function copy(settings: SearchCacheSettings): SearchCacheSettings {
    return { ...settings, posts: { ...settings.posts }, wallabag: { ...settings.wallabag } };
  }

  const initialSettings = getSearchCacheSettings();
  let saved = $state(initialSettings);
  let draft = $state(copy(initialSettings));
  let stats = $state<Awaited<ReturnType<typeof getSearchCacheStats>> | null>(null);
  let operation = $state('');
  let error = $state('');
  let notice = $state('');
  let progress = $state<SearchCacheSyncProgress | null>(null);
  let syncController: AbortController | null = null;
  let disposed = false;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const busy = $derived(operation !== '');
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
  const sourcePolicies = ['posts', 'wallabag'] as const;

  function formattedBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function refreshStatus() {
    try {
      const next = await getSearchCacheStats();
      if (disposed) return;
      const hadEdits = dirty;
      saved = getSearchCacheSettings();
      if (!hadEdits) draft = copy(saved);
      stats = next;
    } catch (cause) {
      swallow('search-cache.settings.status', cause);
      if (!disposed) error = localSearch.t.operationFailed;
    }
  }

  async function runAction(name: string, action: () => Promise<unknown>, success: () => string) {
    if (busy) return;
    operation = name;
    error = '';
    notice = '';
    try {
      await action();
      if (!disposed) notice = success();
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') {
        if (!disposed) notice = localSearch.t.stopped;
      } else {
        swallow('search-cache.settings.action', cause);
        if (!disposed) error = cause instanceof Error ? cause.message : localSearch.t.operationFailed;
      }
    } finally {
      if (!disposed) {
        operation = '';
        await refreshStatus();
      }
    }
  }

  async function save() {
    await runAction('save', async () => {
      const settings = await updateSearchCacheSettings(copy(draft));
      if (!disposed) {
        saved = settings;
        draft = copy(settings);
      }
    }, () => localSearch.t.saved);
  }

  async function indexItems(source: 'existing' | 'wallabag') {
    if (busy) return;
    const controller = new AbortController();
    syncController = controller;
    progress = { processed: 0, indexed: 0, pages: 0 };
    let result: SearchCacheSyncResult | null = null;
    try {
      await runAction(source, async () => {
        const action = source === 'wallabag' ? syncWallabagSearchCache : indexExistingSearchCache;
        result = await action({
          signal: controller.signal,
          onProgress: value => { if (!disposed) progress = value; },
        });
        if (controller.signal.aborted) throw new DOMException('Indexing stopped.', 'AbortError');
      }, () => `${localSearch.t.synced.replace('{count}', String(result?.indexed ?? 0))}${result?.stoppedEarly ? ` ${localSearch.t.syncLimited}` : ''}`);
    } finally {
      if (syncController === controller) syncController = null;
    }
  }

  onMount(() => {
    void refreshStatus();
    const changed = () => {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { void refreshStatus(); }, 150);
    };
    window.addEventListener('search-cache-changed', changed);
    return () => {
      disposed = true;
      syncController?.abort();
      clearTimeout(statusTimer);
      window.removeEventListener('search-cache-changed', changed);
    };
  });
</script>

<section id="local-search-cache" class="mb-8 scroll-mt-6" aria-labelledby="local-search-cache-title">
  <h2 id="local-search-cache-title" class="text-lg font-semibold mb-3">{localSearch.t.title}</h2>
  <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-4">
    <p class="text-sm text-[var(--color-text-muted)]">{localSearch.t.description}</p>
    <form onsubmit={(event) => { event.preventDefault(); void save(); }} oninput={() => { notice = ''; }} class="space-y-4">
      <fieldset disabled={busy} class="space-y-4">
        <label class="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" bind:checked={draft.enabled} class="accent-[var(--color-primary)]" />
          {localSearch.t.enable}
        </label>
        <p class="text-xs text-[var(--color-text-muted)]">{localSearch.t.disableHint}</p>

        <fieldset disabled={!draft.enabled} class="space-y-4 disabled:opacity-60">
          <div class="grid gap-4 sm:grid-cols-2">
            {#each sourcePolicies as source}
              <fieldset class="p-3 border border-[var(--color-border)] rounded-lg space-y-3 min-w-0">
                <legend class="px-1 text-sm font-medium">{localSearch.t[source]}</legend>
                <label class="flex items-center gap-2 text-xs">
                  <input id="search-cache-{source}-enabled" type="checkbox" bind:checked={draft[source].enabled} class="accent-[var(--color-primary)]" />
                  {localSearch.t.includeSource}
                </label>
                <fieldset disabled={!draft[source].enabled} class="space-y-3">
                  <div>
                    <label for="search-cache-{source}-mode" class="block text-xs text-[var(--color-text-muted)] mb-1">{localSearch.t.amount}</label>
                    <select id="search-cache-{source}-mode" bind:value={draft[source].mode}
                      class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm">
                      <option value="title">{localSearch.t.titleOnly}</option>
                      <option value="paragraph">{localSearch.t.firstParagraph}</option>
                      <option value="characters">{localSearch.t.characters}</option>
                    </select>
                  </div>
                  {#if draft[source].mode !== 'title'}
                    <div>
                      <label for="search-cache-{source}-chars" class="block text-xs text-[var(--color-text-muted)] mb-1">{localSearch.t.maxChars}</label>
                      <input id="search-cache-{source}-chars" type="number" min="100" max="50000" step="1" required bind:value={draft[source].maxChars}
                        class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm" />
                    </div>
                  {/if}
                </fieldset>
              </fieldset>
            {/each}
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label for="search-cache-age" class="block text-xs text-[var(--color-text-muted)] mb-1">{localSearch.t.age}</label>
              <input id="search-cache-age" type="number" min="0" max="36500" step="1" required bind:value={draft.maxAgeDays} aria-describedby="search-cache-age-hint"
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm" />
              <p id="search-cache-age-hint" class="text-xs text-[var(--color-text-muted)] mt-1">{localSearch.t.ageHint}</p>
            </div>
            <div>
              <label for="search-cache-count" class="block text-xs text-[var(--color-text-muted)] mb-1">{localSearch.t.maxItems}</label>
              <input id="search-cache-count" type="number" min="100" max="50000" step="1" required bind:value={draft.maxItems}
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm" />
            </div>
          </div>
          <p class="text-xs text-[var(--color-text-muted)]">{localSearch.t.limitsHint}</p>
        </fieldset>
        <button type="submit" disabled={!dirty} class="px-3 py-2 bg-[var(--color-primary)] text-white rounded-md text-xs font-medium disabled:opacity-50">
          {localSearch.t.save}
        </button>
      </fieldset>
    </form>

    <div class="pt-4 border-t border-[var(--color-border)] space-y-3">
      <p class="text-xs text-[var(--color-text-muted)]">{localSearch.t.syncHint}</p>
      {#if stats}
        <p class="text-xs text-[var(--color-text-muted)]">{localSearch.t.stats.replace('{count}', String(stats.count)).replace('{size}', formattedBytes(stats.bytes))}</p>
        {#if !stats.available}<p role="alert" class="text-xs text-[var(--color-danger)]">{localSearch.t.unavailable}</p>{/if}
        {#if stats.error && stats.available}<p role="alert" class="text-xs text-[var(--color-danger)]">{stats.error}</p>{/if}
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || dirty || !saved.enabled || !saved.posts.enabled || !stats?.available}
          onclick={() => { void indexItems('existing'); }}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{localSearch.t.indexExisting}</button>
        <button type="button" disabled={busy || dirty || !saved.enabled || !saved.wallabag.enabled || !stats?.available}
          onclick={() => { void indexItems('wallabag'); }}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{localSearch.t.syncWallabag}</button>
        <button type="button" disabled={busy || dirty || !saved.enabled || !stats?.available}
          onclick={() => runAction('rebuild', rebuildSearchCache, () => localSearch.t.rebuilt)}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{localSearch.t.rebuild}</button>
        <button type="button" disabled={busy || !stats?.available}
          onclick={() => runAction('clear', clearSearchCache, () => localSearch.t.cleared)}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{localSearch.t.clear}</button>
        <button type="button" disabled={busy} onclick={() => { void refreshStatus(); }}
          class="px-3 py-2 text-xs text-[var(--color-text-muted)] disabled:opacity-50">{localSearch.t.refresh}</button>
        <a href="{base}/search?scope=local" class="text-xs text-[var(--color-primary-text)] underline">{localSearch.t.onDevice}</a>
      </div>
    </div>
    {#if busy}<p role="status" class="flex items-center gap-2 text-xs"><Loader2 size={14} class="animate-spin" />{localSearch.t.working}</p>{/if}
    {#if operation === 'existing' || operation === 'wallabag'}
      <div class="flex flex-wrap items-center gap-3">
        {#if progress}<p role="status" class="text-xs">{localSearch.t.syncProgress.replace('{processed}', String(progress.processed)).replace('{indexed}', String(progress.indexed))}</p>{/if}
        <button type="button" onclick={() => syncController?.abort()} class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs">{localSearch.t.stop}</button>
      </div>
    {/if}
    {#if notice}<p role="status" class="text-xs text-[var(--color-success)]">{notice}</p>{/if}
    {#if error}<p role="alert" class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
  </div>
</section>
