<script lang="ts">
  import { Loader2, X, Search } from '@lucide/svelte';

  let { onselect }: { onselect: (gif: { url: string; preview: string; width: number; height: number; title: string }) => void } = $props();

  let show = $state(false);
  let query = $state('');
  let gifs: Array<{ id: string; url: string; preview: string; width: number; height: number; title: string }> = $state([]);
  let loading = $state(false);
  let error = $state('');

  // Tenor API v2 — anonymous/free tier key (public, rate-limited)
  const TENOR_KEY = 'AIzaSyBqRpOoQ9wJxgGmqE8hFOsf9kUkJnbKEEo';

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function parseResults(results: any[]): typeof gifs {
    return results.map((r: any) => {
      const gif = r.media_formats?.gif ?? r.media_formats?.mediumgif ?? r.media_formats?.tinygif;
      const preview = r.media_formats?.tinygif ?? r.media_formats?.nanogif ?? gif;
      return {
        id: r.id,
        url: gif?.url ?? '',
        preview: preview?.url ?? '',
        width: preview?.dims?.[0] ?? 200,
        height: preview?.dims?.[1] ?? 200,
        title: r.content_description ?? '',
      };
    }).filter((g: any) => g.url);
  }

  async function fetchTrending() {
    loading = true;
    error = '';
    try {
      const resp = await fetch(`https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=20&media_filter=gif,tinygif,nanogif`);
      if (!resp.ok) throw new Error('Failed to load trending GIFs');
      const data = await resp.json();
      gifs = parseResults(data.results ?? []);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function searchGifs(q: string) {
    if (!q.trim()) { fetchTrending(); return; }
    loading = true;
    error = '';
    try {
      const resp = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=20&media_filter=gif,tinygif,nanogif`);
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      gifs = parseResults(data.results ?? []);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchGifs(query), 400);
  }

  function handleOpen() {
    show = true;
    if (gifs.length === 0) fetchTrending();
  }
</script>

<div class="relative inline-block">
  <button
    onclick={() => show ? show = false : handleOpen()}
    class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md transition-colors text-sm font-mono"
    title="GIF"
  >
    GIF
  </button>

  {#if show}
    <div class="absolute bottom-full left-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl z-50 w-80 max-h-80 overflow-hidden flex flex-col">
      <div class="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
        <Search size={14} class="text-[var(--color-text-muted)]" />
        <input
          type="text"
          bind:value={query}
          oninput={handleInput}
          placeholder="Search Tenor..."
          class="flex-1 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] focus:outline-none"
        />
        <button onclick={() => { show = false; }} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <X size={14} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <Loader2 size={20} class="animate-spin text-[var(--color-text-muted)]" />
          </div>
        {:else if error}
          <p class="text-xs text-red-400 text-center py-4">{error}</p>
        {:else if gifs.length === 0}
          <p class="text-xs text-[var(--color-text-muted)] text-center py-4">No GIFs found</p>
        {:else}
          <div class="grid grid-cols-2 gap-1.5">
            {#each gifs as gif}
              <button
                onclick={() => { onselect(gif); show = false; query = ''; }}
                class="rounded-md overflow-hidden hover:ring-2 hover:ring-[var(--color-primary)] transition-all bg-[var(--color-surface-hover)]"
              >
                <img
                  src={gif.preview}
                  alt={gif.title}
                  class="w-full aspect-video object-cover"
                  loading="lazy"
                />
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="px-2 py-1 border-t border-[var(--color-border)] text-center">
        <span class="text-[9px] text-[var(--color-text-muted)]">Powered by Tenor</span>
      </div>
    </div>
  {/if}
</div>
