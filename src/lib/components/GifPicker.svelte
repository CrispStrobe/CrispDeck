<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { Loader2, X, Search } from '@lucide/svelte';

  let { onselect }: { onselect: (gif: { url: string; preview: string; width: number; height: number; title: string }) => void } = $props();

  // Animated emoji from a self-hosted, permissively-licensed set.
  //
  // This replaced Tenor. Google discontinued the public Tenor API — new keys
  // stopped on 2026-01-13, third-party access ended 2026-06-30 — and the old
  // key now returns API_KEY_INVALID, so the picker had been silently broken in
  // production. There is deliberately no API key and no account here: the
  // assets are CC BY 4.0 / MIT / Apache-2.0 / OFL and are served from our own
  // dataset, so nothing can be switched off by a third party again.
  //
  // GIF rather than the (20x smaller) Lottie because the chosen file is
  // uploaded as post media. Lottie is JSON; Mastodon and Bluesky would reject
  // it, and it would be mislabelled image/gif on the way out.
  const SET_BASE = 'https://huggingface.co/datasets/cstr/open-emoji-assets/resolve/main';
  const GIF = (slug: string) => `${SET_BASE}/noto-animated/gif/${slug}.gif`;
  // Static SVG for the grid: a 512px animated GIF per tile would be ~600 KB
  // each, so the picker would pull tens of megabytes just to render.
  const THUMB = (slug: string) => `${SET_BASE}/twemoji/${slug}.svg`;

  type Entry = { s: string; c: string; n: string; g: string; k: string[]; a: number };

  let show = $state(false);
  let query = $state('');
  let results: Entry[] = $state([]);
  let loading = $state(false);
  let error = $state('');

  let index: Entry[] | null = null;
  let indexPromise: Promise<Entry[]> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Locale-matched index, fetched once and reused. ~104 KB gzipped. */
  function loadIndex(): Promise<Entry[]> {
    if (indexPromise) return indexPromise;
    const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
    const supported = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ja'];
    const loc = supported.includes(lang) ? lang : 'en';

    indexPromise = fetch(`${SET_BASE}/slices/index.${loc}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`index ${r.status}`);
        return r.json();
      })
      .then((d) => {
        // Only animated entries can be posted; the static-only ones have no GIF.
        index = (d.emoji as Entry[]).filter((e) => e.a === 1);
        return index;
      })
      .catch((e) => {
        indexPromise = null;   // let a later attempt retry
        throw e;
      });
    return indexPromise;
  }

  function scored(list: Entry[], q: string): Entry[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return list.slice(0, 40);
    const out: Array<[number, Entry]> = [];
    for (const e of list) {
      let best = 0;
      if (e.n.toLowerCase() === needle) best = 4;
      else if (e.n.toLowerCase().startsWith(needle)) best = 3;
      else {
        for (const k of e.k) {
          if (k === needle) { best = Math.max(best, 3); break; }
          if (k.startsWith(needle)) best = Math.max(best, 2);
          else if (k.includes(needle)) best = Math.max(best, 1);
        }
      }
      if (best) out.push([best, e]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, 40).map(([, e]) => e);
  }

  async function search(q: string) {
    loading = true;
    error = '';
    try {
      const list = await loadIndex();
      results = scored(list, q);
      if (!results.length && q.trim()) error = 'No matches.';
    } catch (e) {
      error = 'Could not load the emoji set.';
      results = [];
    } finally {
      loading = false;
    }
  }

  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(query), 200);
  }

  function open() {
    show = true;
    if (!results.length) search('');
  }

  function close() {
    show = false;
    query = '';
  }

  /** Focus on mount. Preferred over the autofocus attribute, which applies on
   *  page load and is an a11y problem; here the field only exists once the
   *  user has deliberately opened the picker. */
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }

  function pick(e: Entry) {
    onselect({
      url: GIF(e.s),
      preview: THUMB(e.s),
      width: 512,
      height: 512,
      // Becomes the alt text, so name the emoji rather than leaving it blank.
      title: e.n
    });
    close();
  }
</script>

<button type="button" class="gif-trigger" onclick={open} aria-label={i18n.t.compose.addAnimatedEmoji}>
  GIF
</button>

{#if show}
  <div class="gif-backdrop" onclick={close} role="presentation"></div>
  <div class="gif-panel" role="dialog" aria-label={i18n.t.compose.emojiPickerLabel}>
    <div class="gif-head">
      <Search size={16} />
      <input
        bind:value={query}
        oninput={onInput}
        placeholder={i18n.t.compose.searchEmojiPlaceholder}
        aria-label={i18n.t.compose.searchEmoji}
        use:focusOnMount
      />
      <button type="button" onclick={close} aria-label={i18n.t.compose.close}><X size={16} /></button>
    </div>

    {#if loading}
      <div class="gif-state"><Loader2 class="spin" size={20} /></div>
    {:else if error}
      <div class="gif-state">{error}</div>
    {:else}
      <div class="gif-grid">
        {#each results as e (e.s)}
          <button type="button" class="gif-cell" onclick={() => pick(e)} title={e.n}>
            <img src={THUMB(e.s)} alt={e.n} loading="lazy" width="40" height="40" />
          </button>
        {/each}
      </div>
    {/if}

    <div class="gif-credit">
      Animated Noto Emoji — Google, CC BY 4.0
    </div>
  </div>
{/if}

<style>
  .gif-trigger { font-size: 0.75rem; font-weight: 600; }
  .gif-backdrop { position: fixed; inset: 0; z-index: 40; }
  .gif-panel {
    position: absolute; z-index: 41; width: 20rem; max-height: 22rem;
    display: flex; flex-direction: column;
    background: var(--surface, #fff); border: 1px solid var(--border, #ddd);
    border-radius: 0.5rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }
  .gif-head { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; }
  .gif-head input { flex: 1; border: 0; outline: none; background: transparent; font: inherit; }
  .gif-grid {
    display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.25rem;
    padding: 0.5rem; overflow-y: auto;
  }
  .gif-cell { padding: 0.25rem; border: 0; background: transparent; cursor: pointer; border-radius: 0.25rem; }
  .gif-cell:hover { background: var(--hover, rgba(0, 0, 0, 0.06)); }
  .gif-cell img { display: block; width: 100%; height: auto; }
  .gif-state { padding: 1.5rem; text-align: center; opacity: 0.7; }
  .gif-credit { padding: 0.375rem 0.5rem; font-size: 0.625rem; opacity: 0.6; border-top: 1px solid var(--border, #eee); }
  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
