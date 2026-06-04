<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { TrendingUp, Loader2, Hash, Link2, Rss } from '@lucide/svelte';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import Post from '$lib/components/Post.svelte';
  import type { Account, UnifiedPost } from '$lib/types';

  interface TrendingTag { name: string; url: string; history: Array<{ day: string; uses: string; accounts: string }> }
  interface TrendingLink { url: string; title: string; description: string; image?: string; providerName?: string; history: Array<{ day: string; uses: string; accounts: string }> }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let activeTab: 'tags' | 'links' | 'posts' = $state('tags');
  let tags: TrendingTag[] = $state([]);
  let links: TrendingLink[] = $state([]);
  let trendingPosts: UnifiedPost[] = $state([]);
  let filterLatin = $state(true); // Filter to mostly-Latin tags by default

  let mastoClient: MastodonClient | null = $state(null);

  /** Check if a string is mostly Latin/ASCII script */
  function isLatinScript(text: string): boolean {
    const latin = text.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '');
    return latin.length > text.length * 0.4; // At least 40% Latin chars
  }

  const filteredTags = $derived(filterLatin ? tags.filter(t => isLatinScript(t.name)) : tags);
  const filteredLinks = $derived(filterLatin ? links.filter(l => isLatinScript(l.title || l.url)) : links);

  onMount(async () => {
    try {
      accounts = await listAccounts();
      const mastoAcct = accounts.find(a => a.platform === 'mastodon');
      if (mastoAcct) {
        const creds = JSON.parse(await getDecryptedCredentials(mastoAcct.id));
        mastoClient = new MastodonClient(
          mastoAcct.instance_url ?? `https://${mastoAcct.handle.split('@').pop()}`,
          creds.access_token,
        );
        await loadTrending();
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadTrending() {
    if (!mastoClient) return;
    const inst = mastoClient.getInstanceUrl();
    const token = mastoClient.getAccessToken();
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
      error = String(e);
    }
  }

  function totalUses(history: Array<{ uses: string }>): number {
    return history.reduce((sum, h) => sum + parseInt(h.uses || '0'), 0);
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <TrendingUp size={24} />
    <h1 class="text-2xl font-bold">Trending</h1>
    <span class="text-xs px-2 py-0.5 bg-[var(--color-mastodon)]/20 text-[var(--color-mastodon)] rounded">Mastodon</span>
  </div>
  <p class="text-xs text-[var(--color-text-muted)] mb-4 -mt-4">
    Global trends from your Mastodon instance.
    <label class="inline-flex items-center gap-1.5 ml-3 cursor-pointer">
      <input type="checkbox" bind:checked={filterLatin} class="rounded" />
      <span>Latin only</span>
    </label>
  </p>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Tabs -->
  <div class="flex items-center gap-1 border-b border-[var(--color-border)] mb-4">
    <button onclick={() => activeTab = 'tags'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'tags' ? 'border-[var(--color-primary)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
      <Hash size={14} class="inline mr-1" /> Tags ({filteredTags.length})
    </button>
    <button onclick={() => activeTab = 'links'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'links' ? 'border-[var(--color-primary)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
      <Link2 size={14} class="inline mr-1" /> Links ({filteredLinks.length})
    </button>
    <button onclick={() => activeTab = 'posts'} class="px-4 py-2 text-sm font-medium border-b-2 -mb-px {activeTab === 'posts' ? 'border-[var(--color-primary)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'}">
      <Rss size={14} class="inline mr-1" /> Posts ({trendingPosts.length})
    </button>
  </div>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if !mastoClient}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <TrendingUp size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <p class="text-sm text-[var(--color-text-muted)]">Add a Mastodon account in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to see trending content.</p>
    </div>
  {:else}
    {#if activeTab === 'tags'}
      <div class="space-y-2">
        {#each filteredTags as tag}
          <a href="/search?q=%23{tag.name}" class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-mastodon)] transition-colors">
            <div>
              <span class="text-sm font-medium">#{tag.name}</span>
            </div>
            <span class="text-xs text-[var(--color-text-muted)]">{totalUses(tag.history)} uses</span>
          </a>
        {/each}
        {#if filteredTags.length === 0}<p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No trending tags{filterLatin ? ' (try disabling Latin filter)' : ''}.</p>{/if}
      </div>
    {:else if activeTab === 'links'}
      <div class="space-y-3">
        {#each filteredLinks as link}
          <a href={link.url} target="_blank" rel="noopener noreferrer" class="flex gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-mastodon)] transition-colors">
            {#if link.image}
              <img src={link.image} alt="" class="w-20 h-14 rounded object-cover flex-shrink-0" />
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
    {:else}
      <div class="space-y-3">
        {#each trendingPosts as post (post.uri)}
          <Post {post} />
        {/each}
        {#if trendingPosts.length === 0}<p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No trending posts.</p>{/if}
      </div>
    {/if}
  {/if}
</div>
