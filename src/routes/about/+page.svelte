<script lang="ts">
  import { onMount } from 'svelte';
  import { Info, ExternalLink, Search, Shield, ScrollText } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import LogViewer from '$lib/components/LogViewer.svelte';

  let showLogs = $state(false);

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
  let sourceFilter: 'all' | 'Frontend' | 'Backend' = $state('all');
  let loading = $state(true);

  const filtered = $derived(licenses.filter(l => {
    if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
    return l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.author?.toLowerCase().includes(search.toLowerCase()) ||
      (l.license ?? '').toLowerCase().includes(search.toLowerCase());
  }));

  const frontendCount = $derived(licenses.filter(l => l.source === 'Frontend').length);
  const backendCount = $derived(licenses.filter(l => l.source === 'Backend').length);

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

<svelte:head><title>CrispDeck — About</title><meta name="description" content="About CrispDeck — open source social client" /></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Info size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.about.title}</h1>
  </div>

  <!-- App info -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <div class="flex items-center gap-4 mb-3">
      <img src="/favicon.png" alt="CrispDeck" class="w-14 h-14 rounded-xl" />
      <div>
        <h2 class="text-lg font-bold">CrispDeck</h2>
        <p class="text-sm text-[var(--color-text-muted)]">
          v{__VERSION__}{__GIT_HASH__ ? ` · ${__GIT_HASH__}` : ''} · Mastodon + Bluesky + Threads client
        </p>
      </div>
    </div>
    <p class="text-sm text-[var(--color-text-muted)]">
      Full-featured cross-platform client with crossposting, identity mapping, translation, and smart mentions. Built with Tauri 2 + SvelteKit + Svelte 5 + Rust. {#if typeof window !== 'undefined'}Deployed on web.{/if}
    </p>
    <div class="flex gap-3 mt-3">
      <a href="https://github.com/CrispStrobe/CrispDeck" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
        <ExternalLink size={12} /> GitHub
      </a>
      <a href="https://crispdeck.vercel.app" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
        <ExternalLink size={12} /> Web App
      </a>
      {#if __GIT_HASH__}
        <a href="https://github.com/CrispStrobe/CrispDeck/commit/{__GIT_HASH__}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:underline">
          <ExternalLink size={12} /> {__GIT_HASH__}
        </a>
      {/if}
      <button onclick={() => showLogs = true} class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
        <ScrollText size={12} /> Logs
      </button>
    </div>
  </section>

  <!-- Provider / Legal -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2">{i18n.t.about.serviceProvider}</h3>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      Christian Ströbele<br />
      Nikolausstr. 5<br />
      70190 Stuttgart<br />
      Germany
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2">{i18n.t.about.contact}</h3>
    <p class="text-sm text-[var(--color-text-muted)]">
      Email: postmaster@crispstro.be<br />
      Phone: +49 176 6421 8601
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2 flex items-center gap-1.5"><Shield size={14} /> Privacy &amp; Legal</h3>
    <div class="flex flex-wrap gap-3 text-xs">
      <a href="/privacy" class="text-[var(--color-primary)] hover:underline">Privacy Policy</a>
      <a href="https://github.com/CrispStrobe/CrispDeck/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" class="text-[var(--color-primary)] hover:underline">AGPL-3.0 Source License</a>
      <a href="https://github.com/CrispStrobe/CrispDeck/blob/main/LICENSE-COMMERCIAL" target="_blank" rel="noopener noreferrer" class="text-[var(--color-primary)] hover:underline">App Store License</a>
    </div>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2 flex items-center gap-1.5"><Shield size={14} /> Disclaimer</h3>
    <p class="text-xs text-[var(--color-text-muted)] leading-relaxed">
      This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement.
    </p>
  </section>

  <!-- License -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h3 class="text-sm font-semibold mb-2 flex items-center gap-1.5"><ScrollText size={14} /> License</h3>
    <div class="text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1">
      <p>
        <span class="font-medium text-[var(--color-text)]">Source code</span> —
        <a href="https://github.com/CrispStrobe/CrispDeck/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" class="text-[var(--color-primary)] hover:underline">AGPL-3.0</a>
        · Free to use, modify, and redistribute under copyleft terms.
      </p>
      <p>
        <span class="font-medium text-[var(--color-text)]">App Store / Play Store binary</span> —
        <a href="https://github.com/CrispStrobe/CrispDeck/blob/main/LICENSE-COMMERCIAL" target="_blank" rel="noopener noreferrer" class="text-[var(--color-primary)] hover:underline">Commercial License</a>
        · Distributed by Christian Ströbele under an App Store distribution exception.
      </p>
    </div>
  </section>

  <!-- Open Source Licenses -->
  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">Open Source Licenses ({filtered.length} of {licenses.length})</h3>
      <div class="flex items-center gap-2">
        <div class="flex items-center bg-[var(--color-bg)] rounded-md border border-[var(--color-border)] p-0.5">
          <button onclick={() => sourceFilter = 'all'} class="px-2 py-0.5 text-[10px] rounded {sourceFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}">All</button>
          <button onclick={() => sourceFilter = 'Frontend'} class="px-2 py-0.5 text-[10px] rounded {sourceFilter === 'Frontend' ? 'bg-blue-600 text-white' : 'text-[var(--color-text-muted)]'}">NPM ({frontendCount})</button>
          <button onclick={() => sourceFilter = 'Backend'} class="px-2 py-0.5 text-[10px] rounded {sourceFilter === 'Backend' ? 'bg-red-600 text-white' : 'text-[var(--color-text-muted)]'}">Rust ({backendCount})</button>
        </div>
        <div class="flex items-center gap-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1">
          <Search size={12} class="text-[var(--color-text-muted)]" />
          <input
            type="text"
            bind:value={search}
            placeholder="Search..."
            class="bg-transparent text-xs text-[var(--color-text)] focus:outline-none w-28"
          />
        </div>
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
  <LogViewer bind:show={showLogs} />
</div>
