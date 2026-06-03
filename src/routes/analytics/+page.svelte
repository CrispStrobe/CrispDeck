<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { BarChart3, Heart, Repeat, MessageCircle, Clock, TrendingUp, Download, Loader2, ChevronDown } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import { exportAsJson, exportAsCsv, exportAsMarkdown } from '$lib/utils/export';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let loadingProgress = $state('');
  let error = $state('');
  let dateRange: 'all' | '7d' | '30d' | '90d' = $state('all');
  let expandedStat: string | null = $state(null);

  onMount(async () => {
    try {
      accounts = await listAccounts();
    } catch (e) {
      error = String(e);
    }
  });

  async function loadAllPosts() {
    loading = true;
    posts = [];
    let total = 0;

    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);

        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          let cursor: string | undefined;
          do {
            const result = await client.getAuthorFeed(acct.handle, cursor);
            const normalized = result.feed.map(p => normalizePost(p, 'bluesky'));
            posts = [...posts, ...normalized];
            total += normalized.length;
            cursor = result.cursor;
            loadingProgress = `Bluesky: ${total} posts...`;
          } while (cursor);
        } else {
          const client = new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          );
          const account = await client.getAccountByHandle(acct.handle);
          let cursor: string | undefined;
          do {
            const statuses = await client.getAccountStatuses(account.id, cursor);
            const normalized = statuses.map(p => normalizePost(p, 'mastodon'));
            posts = [...posts, ...normalized];
            total += normalized.length;
            cursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
            loadingProgress = `Mastodon: ${total} posts...`;
            if (statuses.length < 40) cursor = undefined;
          } while (cursor);
        }
      } catch (e) {
        console.error(`Failed to load for ${acct.handle}:`, e);
      }
    }
    loadingProgress = `Loaded ${total} posts total.`;
    loading = false;
  }

  function toggleStat(name: string) {
    expandedStat = expandedStat === name ? null : name;
  }

  // Filter by date range
  const cutoffDate = $derived(() => {
    if (dateRange === 'all') return 0;
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return Date.now() - days * 86400000;
  });

  const rangedPosts = $derived(
    cutoffDate() === 0 ? posts : posts.filter(p => new Date(p.createdAt).getTime() >= cutoffDate())
  );
  const originalPosts = $derived(rangedPosts.filter(p => !p.isRepost));
  const totalLikes = $derived(originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const totalReposts = $derived(originalPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0));
  const totalReplies = $derived(originalPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0));
  const avgLikes = $derived(originalPosts.length > 0 ? (totalLikes / originalPosts.length).toFixed(1) : '0');
  const avgReposts = $derived(originalPosts.length > 0 ? (totalReposts / originalPosts.length).toFixed(1) : '0');

  const topByLikes = $derived(sortPosts([...originalPosts], 'likes').slice(0, 5));
  const topByReposts = $derived(sortPosts([...originalPosts], 'reposts').slice(0, 5));
  const topByEngagement = $derived(sortPosts([...originalPosts], 'engagement').slice(0, 5));

  const postsByHour = $derived(() => {
    const hours = Array(24).fill(0);
    originalPosts.forEach(p => { hours[new Date(p.createdAt).getHours()]++; });
    return hours;
  });
  const maxHourly = $derived(Math.max(...postsByHour(), 1));

  const bskyCount = $derived(originalPosts.filter(p => p.platform === 'bluesky').length);
  const mastoCount = $derived(originalPosts.filter(p => p.platform === 'mastodon').length);
  const bskyLikes = $derived(originalPosts.filter(p => p.platform === 'bluesky').reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const mastoLikes = $derived(originalPosts.filter(p => p.platform === 'mastodon').reduce((s, p) => s + (p.likeCount ?? 0), 0));

  const handle = $derived(accounts[0]?.handle ?? 'user');
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <BarChart3 size={24} />
      <h1 class="text-2xl font-bold">Analytics</h1>
      {#if originalPosts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)]">({originalPosts.length} posts)</span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if originalPosts.length > 0}
        <button onclick={() => exportAsJson(originalPosts, handle)} class="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={10} /> JSON
        </button>
        <button onclick={() => exportAsCsv(originalPosts, handle)} class="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={10} /> CSV
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if posts.length === 0 && !loading}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <BarChart3 size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-3">Load Your Posts for Analytics</h3>
      <p class="text-sm text-[var(--color-text-muted)] mb-4">This will fetch ALL your posts from both platforms to compute accurate stats.</p>
      <button
        onclick={loadAllPosts}
        disabled={loading || accounts.length === 0}
        class="px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-md text-sm font-medium disabled:opacity-50"
      >
        {accounts.length === 0 ? 'Add accounts first' : 'Load All Posts'}
      </button>
    </div>
  {:else if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto mb-3" />
      <p class="text-sm text-[var(--color-text-muted)]">{loadingProgress}</p>
      {#if posts.length > 0}
        <p class="text-xs text-[var(--color-text-muted)] mt-1">{posts.length} posts loaded so far...</p>
      {/if}
    </div>
  {:else}
    <!-- Date range + reload -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
        {#each [['all', 'All Time'], ['90d', '90 days'], ['30d', '30 days'], ['7d', '7 days']] as [val, label]}
          <button
            onclick={() => dateRange = val as typeof dateRange}
            class="px-3 py-1 text-xs font-medium rounded-md transition-colors {dateRange === val ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >{label}</button>
        {/each}
      </div>
      <button onclick={loadAllPosts} disabled={loading} class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <Loader2 size={12} class={loading ? 'animate-spin' : ''} /> Reload
      </button>
    </div>

    <!-- Stats grid (clickable) -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <button onclick={() => toggleStat('posts')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-[var(--color-primary)] transition-colors {expandedStat === 'posts' ? 'border-[var(--color-primary)]' : ''}">
        <MessageCircle size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-[var(--color-primary)]">{originalPosts.length}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Posts</div>
      </button>
      <button onclick={() => toggleStat('likes')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-red-500 transition-colors {expandedStat === 'likes' ? 'border-red-500' : ''}">
        <Heart size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-red-400">{totalLikes.toLocaleString()}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Likes (avg {avgLikes})</div>
      </button>
      <button onclick={() => toggleStat('reposts')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-green-500 transition-colors {expandedStat === 'reposts' ? 'border-green-500' : ''}">
        <Repeat size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-green-400">{totalReposts.toLocaleString()}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Boosts (avg {avgReposts})</div>
      </button>
      <button onclick={() => toggleStat('replies')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-blue-500 transition-colors {expandedStat === 'replies' ? 'border-blue-500' : ''}">
        <MessageCircle size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-blue-400">{totalReplies.toLocaleString()}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Replies received</div>
      </button>
      <button onclick={() => toggleStat('engagement')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-purple-500 transition-colors {expandedStat === 'engagement' ? 'border-purple-500' : ''}">
        <TrendingUp size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-purple-400">{(totalLikes + totalReposts).toLocaleString()}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Total Engagement</div>
      </button>
    </div>

    <!-- Expanded stat: top posts -->
    {#if expandedStat}
      <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <h3 class="text-sm font-semibold mb-3">
          Top 5 by {expandedStat === 'likes' ? 'Likes' : expandedStat === 'reposts' ? 'Boosts' : expandedStat === 'engagement' ? 'Engagement' : expandedStat === 'replies' ? 'Replies' : 'Recent'}
        </h3>
        <div class="space-y-2">
          {#each (expandedStat === 'likes' ? topByLikes : expandedStat === 'reposts' ? topByReposts : expandedStat === 'engagement' ? topByEngagement : originalPosts.slice(0, 5)) as post, i}
            <div class="flex items-start gap-3">
              <span class="text-xs text-[var(--color-text-muted)] font-bold mt-1 w-4">#{i + 1}</span>
              <div class="flex-1"><Post {post} /></div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Platform breakdown -->
    <div class="mb-6 grid grid-cols-2 gap-3">
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></span>
          <span class="text-sm font-medium">Bluesky</span>
        </div>
        <div class="text-xs text-[var(--color-text-muted)] space-y-0.5">
          <p>{bskyCount} posts · {bskyLikes.toLocaleString()} likes</p>
        </div>
      </div>
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></span>
          <span class="text-sm font-medium">Mastodon</span>
        </div>
        <div class="text-xs text-[var(--color-text-muted)] space-y-0.5">
          <p>{mastoCount} posts · {mastoLikes.toLocaleString()} likes</p>
        </div>
      </div>
    </div>

    <!-- Posting activity by hour -->
    <div class="mb-6">
      <h3 class="font-semibold text-sm mb-3 flex items-center gap-2">
        <Clock size={16} />
        Posting Activity by Hour
      </h3>
      <div class="flex items-end justify-between gap-0.5 h-28 bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
        {#each postsByHour() as count, hour}
          <div class="flex-1 flex flex-col items-center justify-end group" title="{count} posts at {hour}:00">
            <div
              class="w-full bg-[var(--color-primary)]/40 hover:bg-[var(--color-primary)] rounded-t transition-colors"
              style="height: {(count / maxHourly) * 100}%; min-height: 1px"
            ></div>
            <span class="text-[9px] text-[var(--color-text-muted)] mt-0.5">{hour % 6 === 0 ? hour : ''}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
