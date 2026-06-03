<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { BarChart3, Heart, Repeat, MessageCircle, Clock, TrendingUp, Download, Loader2 } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import { exportAsJson, exportAsCsv, exportAsMarkdown } from '$lib/utils/export';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      accounts = await listAccounts();
      if (accounts.length > 0) await loadAllPosts();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadAllPosts() {
    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);

        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          const result = await client.getAuthorFeed(acct.handle);
          posts = [...posts, ...result.feed.map(p => normalizePost(p, 'bluesky'))];
        } else {
          const client = new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          );
          const account = await client.getAccountByHandle(acct.handle);
          const statuses = await client.getAccountStatuses(account.id);
          posts = [...posts, ...statuses.map(p => normalizePost(p, 'mastodon'))];
        }
      } catch (e) {
        console.error(`Failed to load for ${acct.handle}:`, e);
      }
    }
  }

  const originalPosts = $derived(posts.filter(p => !p.isRepost));
  const totalLikes = $derived(originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const totalReposts = $derived(originalPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0));
  const avgLikes = $derived(originalPosts.length > 0 ? (totalLikes / originalPosts.length).toFixed(1) : '0');
  const avgReposts = $derived(originalPosts.length > 0 ? (totalReposts / originalPosts.length).toFixed(1) : '0');
  const topPost = $derived([...originalPosts].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))[0]);

  const postsByHour = $derived(() => {
    const hours = Array(24).fill(0);
    originalPosts.forEach(p => { hours[new Date(p.createdAt).getHours()]++; });
    return hours;
  });
  const maxHourly = $derived(Math.max(...postsByHour(), 1));

  const bskyCount = $derived(originalPosts.filter(p => p.platform === 'bluesky').length);
  const mastoCount = $derived(originalPosts.filter(p => p.platform === 'mastodon').length);

  const handle = $derived(accounts[0]?.handle ?? 'user');
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <BarChart3 size={24} />
      <h1 class="text-2xl font-bold">Analytics</h1>
      {#if originalPosts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({originalPosts.length} original posts)</span>
      {/if}
    </div>

    {#if originalPosts.length > 0}
      <div class="flex items-center gap-2">
        <button onclick={() => exportAsJson(originalPosts, handle)} class="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={12} /> JSON
        </button>
        <button onclick={() => exportAsCsv(originalPosts, handle)} class="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={12} /> CSV
        </button>
        <button onclick={() => exportAsMarkdown(originalPosts, handle)} class="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={12} /> Markdown
        </button>
      </div>
    {/if}
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if originalPosts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <BarChart3 size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">Not Enough Data</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Load more posts via the Feed page to generate analytics.</p>
    </div>
  {:else}
    <!-- Stats grid -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] text-center">
        <MessageCircle size={20} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-xl font-bold text-[var(--color-primary)]">{originalPosts.length}</div>
        <div class="text-xs text-[var(--color-text-muted)]">Original Posts</div>
      </div>
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] text-center">
        <Heart size={20} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-xl font-bold text-[var(--color-primary)]">{totalLikes.toLocaleString()}</div>
        <div class="text-xs text-[var(--color-text-muted)]">Total Likes</div>
      </div>
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] text-center">
        <Repeat size={20} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-xl font-bold text-[var(--color-primary)]">{totalReposts.toLocaleString()}</div>
        <div class="text-xs text-[var(--color-text-muted)]">Total Boosts</div>
      </div>
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] text-center">
        <TrendingUp size={20} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-xl font-bold text-[var(--color-primary)]">{avgLikes}</div>
        <div class="text-xs text-[var(--color-text-muted)]">Avg. Likes</div>
      </div>
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] text-center">
        <TrendingUp size={20} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-xl font-bold text-[var(--color-primary)]">{avgReposts}</div>
        <div class="text-xs text-[var(--color-text-muted)]">Avg. Boosts</div>
      </div>
    </div>

    <!-- Platform breakdown -->
    <div class="mb-8 flex items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></span>
        <span class="text-sm">{bskyCount} Bluesky</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></span>
        <span class="text-sm">{mastoCount} Mastodon</span>
      </div>
    </div>

    <!-- Posting activity by hour -->
    <div class="mb-8">
      <h3 class="font-semibold text-sm mb-3 flex items-center gap-2">
        <Clock size={16} />
        Posting Activity by Hour (Local Time)
      </h3>
      <div class="flex items-end justify-between gap-0.5 h-28 bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
        {#each postsByHour() as count, hour}
          <div class="flex-1 flex flex-col items-center justify-end group" title="{count} posts at {hour}:00">
            <div
              class="w-full bg-[var(--color-primary)]/40 hover:bg-[var(--color-primary)] rounded-t transition-colors"
              style="height: {(count / maxHourly) * 100}%; min-height: 1px"
            ></div>
            <span class="text-[9px] text-[var(--color-text-muted)] mt-0.5">
              {hour % 6 === 0 ? hour : ''}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Top post -->
    {#if topPost}
      <div>
        <h3 class="font-semibold text-sm mb-3 flex items-center gap-2">
          <Heart size={16} />
          Top Post by Likes ({topPost.likeCount ?? 0} likes)
        </h3>
        <Post post={topPost} />
      </div>
    {/if}
  {/if}
</div>
