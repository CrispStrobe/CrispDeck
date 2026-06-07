<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, getBskyClient, getMastoClient, type ClientEntry } from '$lib/api/client-factory';
  import { TrendingUp, Loader2, Hash, Link2, Rss } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import Post from '$lib/components/Post.svelte';
  import type { Account, UnifiedPost } from '$lib/types';

  interface TrendingTag { name: string; url: string; history: Array<{ day: string; uses: string; accounts: string }> }
  interface TrendingLink { url: string; title: string; description: string; image?: string; providerName?: string; history: Array<{ day: string; uses: string; accounts: string }> }
  interface BskyTrendingTopic { topic: string; displayName?: string; link: string; }

  let loading = $state(true);
  let error = $state('');
  let activeTab: 'combined' | 'bluesky' | 'tags' | 'links' | 'posts' = $state('combined');

  // Bluesky trending
  let bskyTopics: BskyTrendingTopic[] = $state([]);
  let hasBsky = $state(false);

  // Mastodon trending
  let tags: TrendingTag[] = $state([]);
  let links: TrendingLink[] = $state([]);
  let trendingPosts: UnifiedPost[] = $state([]);
  let filterLatin = $state(true);
  let hasMasto = $state(false);

  let clientEntries: Map<number, ClientEntry> = new Map();

  const filteredTags = $derived(filterLatin ? tags.filter(t => isLatinScript(t.name)) : tags);
  const filteredLinks = $derived(filterLatin ? links.filter(l => isLatinScript(l.title || l.url)) : links);

  function isLatinScript(text: string): boolean {
    const latin = text.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '');
    return latin.length > text.length * 0.4;
  }

  onMount(async () => {
    try {
      const result = await initAllClients();
      clientEntries = result.clients;

      const bskyClient = getBskyClient(result.clients);
      if (bskyClient) {
        hasBsky = true;
        await loadBskyTrending(bskyClient);
      }

      const mastoClient = getMastoClient(result.clients);
      if (mastoClient) {
        hasMasto = true;
        await loadMastoTrending(mastoClient);
      }

      // Default tab: combined if both available
      if (!hasBsky && hasMasto) activeTab = 'tags';
      else activeTab = 'combined';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadBskyTrending(client: BlueskyClient) {
    try {
      // app.bsky.unspecced.getTrendingTopics — public API
      const resp = await fetch('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics?limit=25');
      if (!resp.ok) throw new Error(`Bluesky trending: ${resp.statusText}`);
      const data = await resp.json();
      bskyTopics = (data.topics ?? data.suggested ?? []).map((t: any) => ({
        topic: t.topic ?? t.tag ?? t.displayName ?? '',
        displayName: t.displayName ?? t.topic ?? t.tag ?? '',
        link: t.link ?? `https://bsky.app/search?q=${encodeURIComponent(t.topic ?? t.tag ?? '')}`,
      })).filter((t: BskyTrendingTopic) => t.topic);
    } catch (e) {
      console.error('Bluesky trending failed:', e);
      // Try the older suggested feeds endpoint as fallback
      try {
        const resp = await fetch('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTaggedSuggestions');
        if (resp.ok) {
          const data = await resp.json();
          bskyTopics = (data.suggestions ?? [])
            .filter((s: any) => s.tag)
            .map((s: any) => ({
              topic: s.tag,
              displayName: s.tag,
              link: `https://bsky.app/search?q=${encodeURIComponent(s.tag)}`,
            }));
        }
      } catch {}
    }
  }

  async function loadMastoTrending(client: MastodonClient) {
    const inst = client.getInstanceUrl();
    const token = client.getAccessToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      const [tagsResp, linksResp, postsResp] = await Promise.all([
        fetch(`${inst}/api/v1/trends/tags?limit=20`, { headers }),
        fetch(`${inst}/api/v1/trends/links?limit=20`, { headers }),
        fetch(`${inst}/api/v1/trends/statuses?limit=20`, { headers }),
      ]);

      if (tagsResp.ok) tags = await tagsResp.json();
      if (linksResp.ok) links = await linksResp.json();
      if (postsResp.ok) {
        const raw = await postsResp.json();
        trendingPosts = sortPosts(raw.map((s: any) => normalizePost(s, 'mastodon')), 'newest');
      }
    } catch (e) {
      console.error('Mastodon trending failed:', e);
    }
  }

  function totalUses(history: Array<{ uses: string }>): number {
    return history.reduce((sum, h) => sum + parseInt(h.uses || '0'), 0);
  }
</script>

<svelte:head><title>CrispDeck — Trending</title><meta name="description" content="Trending topics on Bluesky and Mastodon" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <TrendingUp size={24} />
    <h1 class="text-2xl font-bold">Trending</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-[var(--color-border)] mb-4">
    {#if hasBsky && hasMasto}
      <button onclick={() => activeTab = 'combined'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 {activeTab === 'combined' ? 'border-[var(--color-primary)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        Combined
      </button>
    {/if}
    {#if hasBsky}
      <button onclick={() => activeTab = 'bluesky'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 {activeTab === 'bluesky' ? 'border-[var(--color-bluesky)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span> Bluesky ({bskyTopics.length})
      </button>
    {/if}
    {#if hasMasto}
      <button onclick={() => activeTab = 'tags'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'tags' ? 'border-[var(--color-mastodon)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        <Hash size={14} class="inline mr-1" /> Tags ({filteredTags.length})
      </button>
      <button onclick={() => activeTab = 'links'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'links' ? 'border-[var(--color-mastodon)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        <Link2 size={14} class="inline mr-1" /> Links ({filteredLinks.length})
      </button>
      <button onclick={() => activeTab = 'posts'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'posts' ? 'border-[var(--color-mastodon)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
        <Rss size={14} class="inline mr-1" /> Posts ({trendingPosts.length})
      </button>
    {/if}
    {#if hasMasto}
      <label class="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
        <input type="checkbox" bind:checked={filterLatin} class="rounded" />
        Latin only
      </label>
    {/if}
  </div>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if !hasBsky && !hasMasto}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <TrendingUp size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <p class="text-sm text-[var(--color-text-muted)]">Add a Bluesky or Mastodon account in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to see trending content.</p>
    </div>
  {:else}
    <!-- Combined trending (unified view) -->
    {#if activeTab === 'combined'}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#if bskyTopics.length > 0}
          <div>
            <h3 class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span> Bluesky Topics
            </h3>
            <div class="space-y-1">
              {#each bskyTopics.slice(0, 10) as topic}
                <a href={topic.link} target="_blank" rel="noopener" class="block p-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)] hover:border-[var(--color-bluesky)] text-sm transition-colors">
                  {topic.displayName || topic.topic}
                </a>
              {/each}
            </div>
          </div>
        {/if}
        {#if filteredTags.length > 0}
          <div>
            <h3 class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span> Mastodon Tags
            </h3>
            <div class="space-y-1">
              {#each filteredTags.slice(0, 10) as tag}
                <a href={tag.url} target="_blank" rel="noopener" class="block p-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)] hover:border-[var(--color-mastodon)] text-sm transition-colors">
                  #{tag.name}
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      {#if trendingPosts.length > 0}
        <h3 class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mt-4 mb-2">Trending Posts</h3>
        <div class="space-y-3">
          {#each trendingPosts.slice(0, 5) as post}
            <Post {post} />
          {/each}
        </div>
      {/if}

    <!-- Bluesky trending topics -->
    {:else if activeTab === 'bluesky'}
      <div class="space-y-2">
        {#each bskyTopics as topic, i}
          <a
            href="/search?q={encodeURIComponent(topic.topic)}"
            class="flex items-center gap-4 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors"
          >
            <span class="text-lg font-bold text-[var(--color-text-muted)] w-8 text-right">{i + 1}.</span>
            <div>
              <span class="text-sm font-medium">{topic.displayName || topic.topic}</span>
              {#if topic.displayName && topic.displayName !== topic.topic}
                <span class="text-xs text-[var(--color-text-muted)] ml-2">{topic.topic}</span>
              {/if}
            </div>
            <span class="ml-auto w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span>
          </a>
        {/each}
        {#if bskyTopics.length === 0}
          <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No Bluesky trending topics available.</p>
        {/if}
      </div>
    {/if}

    <!-- Mastodon tags -->
    {#if activeTab === 'tags'}
      <div class="space-y-2">
        {#each filteredTags as tag}
          <a href="/search?q=%23{tag.name}" class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-mastodon)] transition-colors">
            <span class="text-sm font-medium">#{tag.name}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{totalUses(tag.history)} uses</span>
          </a>
        {/each}
        {#if filteredTags.length === 0}<p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No trending tags{filterLatin ? ' (try disabling Latin filter)' : ''}.</p>{/if}
      </div>
    {/if}

    <!-- Mastodon links -->
    {#if activeTab === 'links'}
      <div class="space-y-3">
        {#each filteredLinks as link}
          <a href={link.url} target="_blank" rel="noopener noreferrer" class="flex gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-mastodon)] transition-colors">
            {#if link.image}
              <img loading="lazy" src={link.image} alt="" class="w-20 h-14 rounded object-cover flex-shrink-0" />
            {/if}
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-medium line-clamp-1">{link.title}</h3>
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-1">{link.description}</p>
              <span class="text-[10px] text-[var(--color-text-muted)]">{link.providerName ?? new URL(link.url).hostname} · {totalUses(link.history)} shares</span>
            </div>
          </a>
        {/each}
        {#if filteredLinks.length === 0}<p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No trending links{filterLatin ? ' (try disabling Latin filter)' : ''}.</p>{/if}
      </div>
    {/if}

    <!-- Mastodon posts -->
    {#if activeTab === 'posts'}
      <div class="space-y-3">
        {#each trendingPosts as post (post.uri)}
          <Post {post} />
        {/each}
        {#if trendingPosts.length === 0}<p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No trending posts.</p>{/if}
      </div>
    {/if}
  {/if}
</div>
