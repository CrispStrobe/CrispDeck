<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import { i18n } from '$lib/i18n.svelte';
  import { Image, Loader2, Video, Link2, X, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type { UnifiedPost, Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let loading = $state(true);
  let mediaFilter: 'all' | 'images' | 'video' | 'links' = $state('all');

  interface MediaItem {
    url: string;
    thumb: string;
    alt: string;
    type: 'image' | 'video' | 'link';
    post: UnifiedPost;
    linkTitle?: string;
    linkDomain?: string;
  }

  let mediaItems: MediaItem[] = $state([]);
  let lightboxIndex: number | null = $state(null);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadMedia();
    } catch {} finally { loading = false; }
  });

  async function loadMedia() {
    loading = true;
    const posts: UnifiedPost[] = [];

    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;
      try {
        if (acct.platform === 'bluesky') {
          const client = entry.client as BlueskyClient;
          const r = await client.getAuthorFeed(acct.handle);
          posts.push(...r.feed.map(p => normalizePost(p, 'bluesky')));
        } else if (acct.platform === 'mastodon') {
          const client = entry.client as MastodonClient;
          const a = await client.getAccountByHandle(acct.handle);
          const statuses = await client.getAccountStatuses(a.id);
          posts.push(...statuses.map(s => normalizePost(s, 'mastodon')));
        }
      } catch {}
    }

    // Extract media from posts
    const items: MediaItem[] = [];
    for (const post of posts) {
      if (post.platform === 'bluesky' && post.embeds) {
        const embed = post.embeds as any;
        if (embed.$type === 'app.bsky.embed.images#view' && embed.images) {
          for (const img of embed.images) {
            items.push({ url: img.fullsize, thumb: img.thumb, alt: img.alt || '', type: 'image', post });
          }
        }
        if (embed.$type === 'app.bsky.embed.video#view' && embed.thumbnail) {
          items.push({ url: embed.thumbnail, thumb: embed.thumbnail, alt: embed.alt || 'Video', type: 'video', post });
        }
        if (embed.$type === 'app.bsky.embed.external#view' && embed.external?.thumb) {
          items.push({ url: embed.external.uri, thumb: embed.external.thumb, alt: embed.external.title || '', type: 'link', post, linkTitle: embed.external.title, linkDomain: new URL(embed.external.uri).hostname });
        }
        if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
          if (embed.media.$type === 'app.bsky.embed.images#view') {
            for (const img of embed.media.images ?? []) {
              items.push({ url: img.fullsize, thumb: img.thumb, alt: img.alt || '', type: 'image', post });
            }
          }
        }
      }
      if (post.platform === 'mastodon' && Array.isArray(post.embeds)) {
        for (const att of post.embeds as any[]) {
          const url = att.url || att.remoteUrl;
          const preview = att.previewUrl || att.preview_url || url;
          if (att.type === 'image' || att.type === 'gifv') {
            items.push({ url, thumb: preview, alt: att.description || '', type: 'image', post });
          } else if (att.type === 'video') {
            items.push({ url, thumb: preview, alt: att.description || 'Video', type: 'video', post });
          }
        }
      }
    }

    mediaItems = items;
    loading = false;
  }

  const filtered = $derived(
    mediaFilter === 'all' ? mediaItems : mediaItems.filter(m => m.type === (mediaFilter === 'links' ? 'link' : mediaFilter === 'video' ? 'video' : 'image'))
  );

  function openLightbox(idx: number) { lightboxIndex = idx; }
  function closeLightbox() { lightboxIndex = null; }
  function nextImage() { if (lightboxIndex !== null) lightboxIndex = Math.min(lightboxIndex + 1, filtered.length - 1); }
  function prevImage() { if (lightboxIndex !== null) lightboxIndex = Math.max(lightboxIndex - 1, 0); }
</script>

<svelte:head><title>CrispDeck — {i18n.t.nav.gallery}</title></svelte:head>

<div class="p-6 max-w-6xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Image size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.nav.gallery}</h1>
      {#if mediaItems.length > 0}
        <span class="text-sm text-[var(--color-text-muted)]">({filtered.length})</span>
      {/if}
    </div>
    <div class="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
      {#each ['all', 'images', 'video', 'links'] as filter}
        <button
          onclick={() => mediaFilter = filter as typeof mediaFilter}
          class="px-3 py-1 text-xs rounded-md transition-colors {mediaFilter === filter ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
        >{filter}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <Loader2 size={32} class="animate-spin text-[var(--color-primary)]" />
    </div>
  {:else if filtered.length === 0}
    <div class="text-center py-20 text-[var(--color-text-muted)]">
      <Image size={48} class="mx-auto mb-3 opacity-50" />
      <p class="text-sm">No media found. Posts with images, videos, or links will appear here.</p>
    </div>
  {:else}
    <div class="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
      {#each filtered as item, idx}
        <button
          onclick={() => openLightbox(idx)}
          class="w-full break-inside-avoid rounded-lg overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-colors bg-[var(--color-surface)] block text-left"
        >
          <img loading="lazy" src={item.thumb} alt={item.alt} class="w-full object-cover" />
          {#if item.type === 'video'}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center"><Video size={16} class="text-white" /></div>
            </div>
          {/if}
          <div class="p-2">
            <p class="text-[10px] text-[var(--color-text-muted)] truncate">@{item.post.author.handle}</p>
            {#if item.linkTitle}
              <p class="text-[10px] text-[var(--color-text-muted)] truncate">{item.linkTitle}</p>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<!-- Lightbox -->
{#if lightboxIndex !== null && filtered[lightboxIndex]}
  {@const item = filtered[lightboxIndex]}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" role="dialog" tabindex="-1" onclick={closeLightbox} onkeydown={(e) => { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowRight') nextImage(); if (e.key === 'ArrowLeft') prevImage(); }}>
    <button onclick={closeLightbox} class="absolute top-4 right-4 text-white/70 hover:text-white z-10"><X size={24} /></button>
    {#if lightboxIndex > 0}
      <button onclick={(e) => { e.stopPropagation(); prevImage(); }} class="absolute left-4 text-white/70 hover:text-white z-10"><ChevronLeft size={32} /></button>
    {/if}
    {#if lightboxIndex < filtered.length - 1}
      <button onclick={(e) => { e.stopPropagation(); nextImage(); }} class="absolute right-4 text-white/70 hover:text-white z-10"><ChevronRight size={32} /></button>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div onclick={(e) => e.stopPropagation()} class="max-w-4xl max-h-[90vh] mx-4">
      <img src={item.url} alt={item.alt} class="max-w-full max-h-[85vh] object-contain rounded-lg" />
      <div class="mt-2 text-center">
        <p class="text-sm text-white/80">@{item.post.author.handle}</p>
        {#if item.alt}<p class="text-xs text-white/50 mt-1">{item.alt}</p>{/if}
        <p class="text-[10px] text-white/40 mt-1">{lightboxIndex + 1} / {filtered.length}</p>
      </div>
    </div>
  </div>
{/if}
