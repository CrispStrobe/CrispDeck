<script lang="ts">
  /**
   * Choose a Bluesky feed or list.
   *
   * This replaced a browser prompt() that asked the user to paste an at:// URI
   * — "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot".
   * Nobody knows that string for a feed they like, and the official app never
   * shows it, so in practice the only people who could add a feed column were
   * the ones willing to go and dig a DID out of an API response.
   *
   * So: show the feeds the account already has, let them search for more, and
   * keep a URI field at the bottom for the rare person who really does have one
   * — removing the escape hatch would be a different kind of wrong.
   */
  import { Search, Loader2, Hash, Users, X } from '@lucide/svelte';
  import { swallow } from '$lib/debug-log';
  import { i18n } from '$lib/i18n.svelte';
  import { listSavedFeeds, searchFeedGenerators, type FeedChoice } from '$lib/bluesky-feeds';

  let {
    agent,
    onselect,
    oncancel,
  }: {
    /** Bluesky agent, or null when no Bluesky account is connected. */
    agent: any | null;
    onselect: (choice: FeedChoice) => void;
    oncancel: () => void;
  } = $props();

  let saved: FeedChoice[] = $state([]);
  let loading = $state(true);
  let query = $state('');
  let results: FeedChoice[] = $state([]);
  let searching = $state(false);
  let error = $state('');
  let manualUri = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Only feeds and lists can back a column; the following timeline is already
  // its own column type.
  const savedSelectable = $derived(saved.filter((f) => f.kind !== 'timeline'));
  const newResults = $derived.by(() => {
    const known = new Set(saved.map((f) => f.key));
    return results.filter((f) => !known.has(f.key));
  });

  $effect(() => {
    if (!agent) { loading = false; return; }
    listSavedFeeds(agent)
      .then((f) => { saved = f; })
      .catch((e) => swallow('FeedPickerDialog.savedFeeds', e))
      .finally(() => { loading = false; });
  });

  function onQuery() {
    clearTimeout(timer);
    error = '';
    if (!query.trim()) { results = []; searching = false; return; }
    timer = setTimeout(async () => {
      searching = true;
      try {
        results = await searchFeedGenerators(query);
      } catch {
        error = i18n.t.feed.feedSearchFailed;
        results = [];
      } finally {
        searching = false;
      }
    }, 300);
  }

  function chooseManual() {
    const uri = manualUri.trim();
    if (!uri.startsWith('at://')) return;
    onselect({
      key: uri,
      kind: uri.includes('/app.bsky.graph.list/') ? 'list' : 'feed',
      uri,
      title: uri.split('/').pop() ?? uri,
    });
  }

  /** Focus on mount: the dialog only exists because the user asked for it. */
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }
</script>

<div
  class="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-20 px-4"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) oncancel(); }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t.deck.chooseFeed}
    class="w-full max-w-md max-h-[70vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl"
  >
    <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
      <h2 class="text-sm font-semibold">{i18n.t.deck.chooseFeed}</h2>
      <button onclick={oncancel} aria-label={i18n.t.common.cancel} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <X size={16} />
      </button>
    </div>

    <div class="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
      <Search size={14} class="text-[var(--color-text-muted)] flex-shrink-0" />
      <input
        bind:value={query}
        oninput={onQuery}
        placeholder={i18n.t.feed.searchFeeds}
        aria-label={i18n.t.feed.searchFeeds}
        use:focusOnMount
        class="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm"
      />
      {#if searching}<Loader2 size={14} class="animate-spin text-[var(--color-text-muted)]" />{/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if loading}
        <div class="py-8 text-center"><Loader2 size={18} class="animate-spin mx-auto text-[var(--color-text-muted)]" /></div>
      {:else if !agent}
        <p class="px-4 py-6 text-xs text-[var(--color-text-muted)]">{i18n.t.deck.needBluesky}</p>
      {:else}
        {#snippet row(choice: FeedChoice)}
          <button
            onclick={() => onselect(choice)}
            class="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {#if choice.avatar}
              <img src={choice.avatar} alt="" width="28" height="28" loading="lazy" decoding="async" class="w-7 h-7 rounded flex-shrink-0 bg-[var(--color-surface-hover)]" />
            {:else if choice.kind === 'list'}
              <Users size={18} class="flex-shrink-0 text-[var(--color-text-muted)]" />
            {:else}
              <Hash size={18} class="flex-shrink-0 text-[var(--color-text-muted)]" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{choice.title}</span>
              {#if choice.description}
                <span class="block truncate text-[11px] text-[var(--color-text-muted)]">{choice.description}</span>
              {:else if choice.byHandle}
                <span class="block truncate text-[11px] text-[var(--color-text-muted)]">@{choice.byHandle}</span>
              {/if}
            </span>
          </button>
        {/snippet}

        {#if savedSelectable.length > 0 && !query.trim()}
          <div class="px-4 pt-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            {i18n.t.deck.yourFeeds}
          </div>
          {#each savedSelectable as choice (choice.key)}{@render row(choice)}{/each}
        {/if}

        {#if error}
          <p class="px-4 py-3 text-xs text-red-400">{error}</p>
        {:else if query.trim() && !searching && newResults.length === 0}
          <p class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{i18n.t.feed.noFeedsFound}</p>
        {/if}

        {#if newResults.length > 0}
          <div class="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] border-t border-[var(--color-border)] mt-1">
            {i18n.t.deck.searchResults}
          </div>
          {#each newResults as choice (choice.key)}{@render row(choice)}{/each}
        {/if}
      {/if}
    </div>

    <!-- Kept for anyone who genuinely has a URI in hand, e.g. from a shared
         link or their own feed generator. -->
    <div class="px-4 py-2.5 border-t border-[var(--color-border)] flex items-center gap-2">
      <input
        bind:value={manualUri}
        placeholder="at://…"
        aria-label={i18n.t.deck.pasteFeedUri}
        onkeydown={(e) => { if (e.key === 'Enter') chooseManual(); }}
        class="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs font-mono"
      />
      <button
        onclick={chooseManual}
        disabled={!manualUri.trim().startsWith('at://')}
        class="text-xs px-2.5 py-1 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
      >{i18n.t.common.add}</button>
    </div>
  </div>
</div>
