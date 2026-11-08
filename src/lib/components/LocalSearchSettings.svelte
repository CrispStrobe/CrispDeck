<script lang="ts">
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
      if (!disposed) error = i18n.t.localSearch.operationFailed;
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
        if (!disposed) notice = i18n.t.localSearch.stopped;
      } else {
        swallow('search-cache.settings.action', cause);
        if (!disposed) error = cause instanceof Error ? cause.message : i18n.t.localSearch.operationFailed;
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
    }, () => i18n.t.localSearch.saved);
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
      }, () => `${i18n.t.localSearch.synced.replace('{count}', String(result?.indexed ?? 0))}${result?.stoppedEarly ? ` ${i18n.t.localSearch.syncLimited}` : ''}`);
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
  <h2 id="local-search-cache-title" class="text-lg font-semibold mb-3">{i18n.t.localSearch.title}</h2>
  <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-4">
    <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.localSearch.description}</p>
    <form onsubmit={(event) => { event.preventDefault(); void save(); }} oninput={() => { notice = ''; }} class="space-y-4">
      <fieldset disabled={busy} class="space-y-4">
        <label class="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" bind:checked={draft.enabled} class="accent-[var(--color-primary)]" />
          {i18n.t.localSearch.enable}
        </label>
        <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.localSearch.disableHint}</p>

        <fieldset disabled={!draft.enabled} class="space-y-4 disabled:opacity-60">
          <div class="grid gap-4 sm:grid-cols-2">
            {#each sourcePolicies as source}
              <fieldset class="p-3 border border-[var(--color-border)] rounded-lg space-y-3 min-w-0">
                <legend class="px-1 text-sm font-medium">{i18n.t.localSearch[source]}</legend>
                <label class="flex items-center gap-2 text-xs">
                  <input id="search-cache-{source}-enabled" type="checkbox" bind:checked={draft[source].enabled} class="accent-[var(--color-primary)]" />
                  {i18n.t.localSearch.includeSource}
                </label>
                <fieldset disabled={!draft[source].enabled} class="space-y-3">
                  <div>
                    <label for="search-cache-{source}-mode" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.localSearch.amount}</label>
                    <select id="search-cache-{source}-mode" bind:value={draft[source].mode}
                      class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm">
                      <option value="title">{i18n.t.localSearch.titleOnly}</option>
                      <option value="paragraph">{i18n.t.localSearch.firstParagraph}</option>
                      <option value="characters">{i18n.t.localSearch.characters}</option>
                    </select>
                  </div>
                  {#if draft[source].mode !== 'title'}
                    <div>
                      <label for="search-cache-{source}-chars" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.localSearch.maxChars}</label>
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
              <label for="search-cache-age" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.localSearch.age}</label>
              <input id="search-cache-age" type="number" min="0" max="36500" step="1" required bind:value={draft.maxAgeDays} aria-describedby="search-cache-age-hint"
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm" />
              <p id="search-cache-age-hint" class="text-xs text-[var(--color-text-muted)] mt-1">{i18n.t.localSearch.ageHint}</p>
            </div>
            <div>
              <label for="search-cache-count" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.localSearch.maxItems}</label>
              <input id="search-cache-count" type="number" min="100" max="50000" step="1" required bind:value={draft.maxItems}
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm" />
            </div>
          </div>
          <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.localSearch.limitsHint}</p>
        </fieldset>
        <button type="submit" disabled={!dirty} class="px-3 py-2 bg-[var(--color-primary)] text-white rounded-md text-xs font-medium disabled:opacity-50">
          {i18n.t.localSearch.save}
        </button>
      </fieldset>
    </form>

    <div class="pt-4 border-t border-[var(--color-border)] space-y-3">
      <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.localSearch.syncHint}</p>
      {#if stats}
        <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.localSearch.stats.replace('{count}', String(stats.count)).replace('{size}', formattedBytes(stats.bytes))}</p>
        {#if !stats.available}<p role="alert" class="text-xs text-[var(--color-danger)]">{i18n.t.localSearch.unavailable}</p>{/if}
        {#if stats.error && stats.available}<p role="alert" class="text-xs text-[var(--color-danger)]">{stats.error}</p>{/if}
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || dirty || !saved.enabled || !saved.posts.enabled || !stats?.available}
          onclick={() => { void indexItems('existing'); }}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{i18n.t.localSearch.indexExisting}</button>
        <button type="button" disabled={busy || dirty || !saved.enabled || !saved.wallabag.enabled || !stats?.available}
          onclick={() => { void indexItems('wallabag'); }}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{i18n.t.localSearch.syncWallabag}</button>
        <button type="button" disabled={busy || dirty || !saved.enabled || !stats?.available}
          onclick={() => runAction('rebuild', rebuildSearchCache, () => i18n.t.localSearch.rebuilt)}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{i18n.t.localSearch.rebuild}</button>
        <button type="button" disabled={busy || !stats?.available}
          onclick={() => runAction('clear', clearSearchCache, () => i18n.t.localSearch.cleared)}
          class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs disabled:opacity-50">{i18n.t.localSearch.clear}</button>
        <button type="button" disabled={busy} onclick={() => { void refreshStatus(); }}
          class="px-3 py-2 text-xs text-[var(--color-text-muted)] disabled:opacity-50">{i18n.t.localSearch.refresh}</button>
        <a href="{base}/search?scope=local" class="text-xs text-[var(--color-primary-text)] underline">{i18n.t.localSearch.onDevice}</a>
      </div>
    </div>
    {#if busy}<p role="status" class="flex items-center gap-2 text-xs"><Loader2 size={14} class="animate-spin" />{i18n.t.localSearch.working}</p>{/if}
    {#if operation === 'existing' || operation === 'wallabag'}
      <div class="flex flex-wrap items-center gap-3">
        {#if progress}<p role="status" class="text-xs">{i18n.t.localSearch.syncProgress.replace('{processed}', String(progress.processed)).replace('{indexed}', String(progress.indexed))}</p>{/if}
        <button type="button" onclick={() => syncController?.abort()} class="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs">{i18n.t.localSearch.stop}</button>
      </div>
    {/if}
    {#if notice}<p role="status" class="text-xs text-[var(--color-success)]">{notice}</p>{/if}
    {#if error}<p role="alert" class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
  </div>
</section>
