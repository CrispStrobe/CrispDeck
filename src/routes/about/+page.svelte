<script lang="ts">
  import { onMount } from 'svelte';
  import { Info, ExternalLink, Search, Shield } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';

  interface LicenseEntry {
    name: string;
    version: string;
    license: string;
    author: string;
    link: string;
    source: 'Frontend' | 'Backend';
  }

  let licenses: LicenseEntry[] = $state([]);
  let generatedAt: string | null = $state(null);
  let search = $state('');
  let loading = $state(true);

  const filtered = $derived(licenses.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.author?.toLowerCase().includes(search.toLowerCase()) ||
    (l.license ?? '').toLowerCase().includes(search.toLowerCase())
  ));

  onMount(async () => {
    try {
      const resp = await fetch('/licenses.json');
      const raw = await resp.json();
      if (Array.isArray(raw)) {
        licenses = raw;
      } else if (raw && Array.isArray(raw.licenses)) {
        licenses = raw.licenses;
        generatedAt = raw.generatedAt ?? null;
      }
    } catch (e) {
      console.error('Failed to load licenses:', e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Info size={24} />
    <h1 class="text-2xl font-bold">About CrispDeck</h1>
  </div>

  <!-- App info -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <div class="flex items-center gap-4 mb-3">
      <div class="w-14 h-14 bg-[var(--color-primary)]/20 rounded-xl flex items-center justify-center text-2xl font-bold text-[var(--color-primary)]">CD</div>
      <div>
        <h2 class="text-lg font-bold">CrispDeck</h2>
        <p class="text-sm text-[var(--color-text-muted)]">v{__VERSION__} · Mastodon + Bluesky client</p>
      </div>
    </div>
    <p class="text-sm text-[var(--color-text-muted)]">
      Full-featured cross-platform client with crossposting, identity mapping, translation, and smart mentions. Built with Tauri 2 + SvelteKit + Svelte 5 + Rust.
    </p>
    <div class="flex gap-3 mt-3">
      <a href="https://github.com/CrispStrobe/CrispDeck" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
        <ExternalLink size={12} /> GitHub
      </a>
      <a href="https://crispdeck.vercel.app" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
        <ExternalLink size={12} /> Web App
      </a>
    </div>
  </section>

  <!-- Provider / Legal -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2">Service Provider</h3>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      Christian Ströbele<br />
      Nikolausstr. 5<br />
      70190 Stuttgart<br />
      Germany
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2">Contact</h3>
    <p class="text-sm text-[var(--color-text-muted)]">
      Email: postmaster@crispstro.be<br />
      Phone: +49 176 6421 8601
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2 flex items-center gap-1.5"><Shield size={14} /> Disclaimer</h3>
    <p class="text-xs text-[var(--color-text-muted)] leading-relaxed">
      This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement.
    </p>
  </section>

  <!-- Open Source Licenses -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">Open Source Licenses ({licenses.length})</h3>
      <div class="flex items-center gap-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1">
        <Search size={12} class="text-[var(--color-text-muted)]" />
        <input
          type="text"
          bind:value={search}
          placeholder="Search {licenses.length} licenses..."
          class="bg-transparent text-xs text-[var(--color-text)] focus:outline-none w-40"
        />
      </div>
    </div>

    {#if loading}
      <p class="text-xs text-[var(--color-text-muted)] text-center py-4">Loading licenses...</p>
    {:else if licenses.length === 0}
      <p class="text-xs text-[var(--color-text-muted)] text-center py-4">
        No licenses.json found. Run <code class="bg-[var(--color-bg)] px-1 rounded">node scripts/generate-licenses.js</code> to generate.
      </p>
    {:else}
      <div class="max-h-96 overflow-y-auto space-y-2 bg-[var(--color-bg)] rounded-md p-3 border border-[var(--color-border)]">
        {#each filtered as lib}
          <div class="border-b border-[var(--color-border)] pb-2 last:border-b-0">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{lib.name} <span class="text-[var(--color-text-muted)]">v{lib.version}</span></span>
              <span class="text-[9px] px-1.5 py-0.5 rounded {lib.source === 'Backend' ? 'bg-red-950/30 text-red-400' : 'bg-blue-950/30 text-blue-400'}">{lib.source}</span>
            </div>
            <div class="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)] mt-0.5">
              <span>{lib.license}</span>
              <span>{lib.author}</span>
              {#if lib.link}
                <a href={lib.link} target="_blank" rel="noopener noreferrer" class="text-[var(--color-primary)] hover:underline">Source</a>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if generatedAt}
        <p class="text-[9px] text-[var(--color-text-muted)] mt-2 text-right">Generated: {new Date(generatedAt).toLocaleDateString()}</p>
      {/if}
    {/if}
  </section>
</div>

<script context="module">
  declare const __VERSION__: string;
</script>
