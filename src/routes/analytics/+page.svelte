<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { BarChart3, Heart, Repeat, MessageCircle, Clock, TrendingUp, Download, Loader2, ChevronDown, Percent } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import { exportAsJson, exportAsCsv, exportAsMarkdown } from '$lib/utils/export';
  import { analyzePerformance, type PerformanceInsight } from '$lib/performance-insights';
  import { recordSnapshots } from '$lib/engagement-history';
  import { checkMilestones, getRecentMilestones, type ReachedMilestone } from '$lib/milestones';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let posts: UnifiedPost[] = $state([]);
  let loading = $state(false);
  let loadingProgress = $state('');
  let loadingPercent = $state(0);
  let loadingAccount = $state('');
  let loadingAccountIndex = $state(0);
  let error = $state('');
  let dateRange: 'all' | '7d' | '30d' | '90d' = $state('all');
  let expandedStat: string | null = $state(null);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let recentMilestones: ReachedMilestone[] = $state([]);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
    } catch (e) {
      error = String(e);
    }
  });

  async function loadAllPosts() {
    loading = true;
    posts = [];
    let total = 0;
    loadingPercent = 0;
    loadingAccountIndex = 0;

    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;
      loadingAccountIndex++;
      loadingAccount = acct.handle;
      try {
        if (acct.platform === 'bluesky') {
          const client = entry.client as BlueskyClient;
          let cursor: string | undefined;
          let pages = 0;
          do {
            const result = await client.getAuthorFeed(acct.handle, cursor);
            const normalized = result.feed.map(p => normalizePost(p, 'bluesky'));
            posts = [...posts, ...normalized];
            total += normalized.length;
            cursor = result.cursor;
            pages++;
            loadingProgress = `${acct.handle}: ${total} posts (page ${pages})`;
            // Estimate progress: accounts proportion + within-account proportion (assume ~20 pages max)
            loadingPercent = Math.min(99, Math.round(((loadingAccountIndex - 1) / accounts.length + (1 / accounts.length) * Math.min(pages / 20, 0.95)) * 100));
          } while (cursor);
        } else if (acct.platform === 'threads') {
          const client = entry.client as ThreadsClient;
          const threadsPosts = await client.getOwnPosts(100);
          const normalized = threadsPosts.map(p => client.normalizePost(p));
          posts = [...posts, ...normalized];
          total += normalized.length;
          loadingProgress = `${acct.handle}: ${total} posts`;
          loadingPercent = Math.min(99, Math.round((loadingAccountIndex / accounts.length) * 100));
        } else if (acct.platform === 'mastodon') {
          const client = entry.client as MastodonClient;
          const account = await client.getAccountByHandle(acct.handle);
          let cursor: string | undefined;
          let pages = 0;
          do {
            const statuses = await client.getAccountStatuses(account.id, cursor);
            const normalized = statuses.map(p => normalizePost(p, 'mastodon'));
            posts = [...posts, ...normalized];
            total += normalized.length;
            cursor = statuses.length > 0 ? statuses[statuses.length - 1].id : undefined;
            pages++;
            loadingProgress = `${acct.handle}: ${total} posts (page ${pages})`;
            loadingPercent = Math.min(99, Math.round(((loadingAccountIndex - 1) / accounts.length + (1 / accounts.length) * Math.min(pages / 20, 0.95)) * 100));
            if (statuses.length < 40) cursor = undefined;
          } while (cursor);
        }
      } catch (e) {
        console.error(`Failed to load for ${acct.handle}:`, e);
      }
    }
    loadingProgress = `Loaded ${total} posts total.`;
    loadingPercent = 100;
    loading = false;

    // Capture engagement snapshots for all loaded posts (background)
    const originals = posts.filter(p => !p.isRepost);
    recordSnapshots(originals).catch(() => {});

    // Check milestones for all posts
    for (const post of originals) {
      checkMilestones(post);
    }
    recentMilestones = getRecentMilestones(10);
  }

  function toggleStat(name: string) {
    expandedStat = expandedStat === name ? null : name;
  }

  function exportStatsSummary() {
    const lines = [
      `# CrispDeck Analytics Summary`,
      `Generated: ${new Date().toISOString()}`,
      `Date range: ${dateRange}`,
      ``,
      `## Overview`,
      `- Total posts: ${originalPosts.length}`,
      `- Total likes: ${totalLikes} (avg ${avgLikes}/post)`,
      `- Total boosts: ${totalReposts} (avg ${avgReposts}/post)`,
      `- Total replies received: ${totalReplies}`,
      `- Total engagement: ${totalLikes + totalReposts + totalReplies}`,
      `- Engagement rate: ${engagementRate}%`,
      ``,
      `## Platform Breakdown`,
      `- Bluesky: ${bskyCount} posts, ${bskyLikes} likes, ${bskyReposts} boosts, ${bskyReplies} replies`,
      `- Mastodon: ${mastoCount} posts, ${mastoLikes} likes, ${mastoReposts} boosts, ${mastoReplies} replies`,
      ``,
      `## Top 5 by Likes`,
      ...topByLikes.map((p, i) => `${i + 1}. [${p.likeCount} likes] ${p.text.substring(0, 80)}...`),
      ``,
      `## Top 5 by Boosts`,
      ...topByReposts.map((p, i) => `${i + 1}. [${p.repostCount} boosts] ${p.text.substring(0, 80)}...`),
      ``,
      `## Top 5 by Engagement`,
      ...topByEngagement.map((p, i) => `${i + 1}. [${(p.likeCount ?? 0) + (p.repostCount ?? 0)} engagement] ${p.text.substring(0, 80)}...`),
      ``,
      `## Posting Activity by Hour`,
      ...postsByHour.map((count, h) => count > 0 ? `- ${h}:00 — ${count} posts` : '').filter(Boolean),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crispdeck-analytics-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Filter by date range
  const cutoffDate = $derived.by(() => {
    if (dateRange === 'all') return 0;
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return Date.now() - days * 86400000;
  });

  const rangedPosts = $derived(
    cutoffDate === 0 ? posts : posts.filter(p => new Date(p.createdAt).getTime() >= cutoffDate)
  );
  const originalPosts = $derived(rangedPosts.filter(p => !p.isRepost));
  const totalLikes = $derived(originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const totalReposts = $derived(originalPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0));
  const totalReplies = $derived(originalPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0));
  const avgLikes = $derived(originalPosts.length > 0 ? (totalLikes / originalPosts.length).toFixed(1) : '0');
  const avgReposts = $derived(originalPosts.length > 0 ? (totalReposts / originalPosts.length).toFixed(1) : '0');
  const engagementRate = $derived(
    originalPosts.length > 0
      ? ((totalLikes + totalReposts + totalReplies) / originalPosts.length).toFixed(1)
      : '0'
  );

  const topByLikes = $derived(sortPosts([...originalPosts], 'likes').slice(0, 5));
  const topByReposts = $derived(sortPosts([...originalPosts], 'reposts').slice(0, 5));
  const topByEngagement = $derived(sortPosts([...originalPosts], 'engagement').slice(0, 5));

  const postsByHour = $derived.by(() => {
    const hours = Array(24).fill(0);
    originalPosts.forEach(p => { hours[new Date(p.createdAt).getHours()]++; });
    return hours;
  });
  const maxHourly = $derived(Math.max(...postsByHour, 1));

  // Platform breakdown — full stats
  const bskyPosts = $derived(originalPosts.filter(p => p.platform === 'bluesky'));
  const mastoPosts = $derived(originalPosts.filter(p => p.platform === 'mastodon'));
  const bskyCount = $derived(bskyPosts.length);
  const mastoCount = $derived(mastoPosts.length);
  const bskyLikes = $derived(bskyPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const mastoLikes = $derived(mastoPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0));
  const bskyReposts = $derived(bskyPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0));
  const mastoReposts = $derived(mastoPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0));
  const bskyReplies = $derived(bskyPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0));
  const mastoReplies = $derived(mastoPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0));
  const bskyEngRate = $derived(bskyCount > 0 ? ((bskyLikes + bskyReposts + bskyReplies) / bskyCount).toFixed(1) : '0');
  const mastoEngRate = $derived(mastoCount > 0 ? ((mastoLikes + mastoReposts + mastoReplies) / mastoCount).toFixed(1) : '0');

  const handle = $derived(accounts[0]?.handle ?? 'user');

  // Cross-platform comparison: hourly activity per platform
  const bskyByHour = $derived.by(() => {
    const hours = Array(24).fill(0);
    bskyPosts.forEach(p => { hours[new Date(p.createdAt).getHours()]++; });
    return hours;
  });
  const mastoByHour = $derived.by(() => {
    const hours = Array(24).fill(0);
    mastoPosts.forEach(p => { hours[new Date(p.createdAt).getHours()]++; });
    return hours;
  });

  // Day-of-week patterns
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const bskyByDay = $derived.by(() => {
    const days = Array(7).fill(0);
    bskyPosts.forEach(p => { days[new Date(p.createdAt).getDay()]++; });
    return days;
  });
  const mastoByDay = $derived.by(() => {
    const days = Array(7).fill(0);
    mastoPosts.forEach(p => { days[new Date(p.createdAt).getDay()]++; });
    return days;
  });

  // Avg engagement per platform per day of week
  const bskyEngByDay = $derived.by(() => {
    const eng = Array(7).fill(0);
    const cnt = Array(7).fill(0);
    bskyPosts.forEach(p => {
      const d = new Date(p.createdAt).getDay();
      eng[d] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
      cnt[d]++;
    });
    return eng.map((e, i) => cnt[i] > 0 ? e / cnt[i] : 0);
  });
  const mastoEngByDay = $derived.by(() => {
    const eng = Array(7).fill(0);
    const cnt = Array(7).fill(0);
    mastoPosts.forEach(p => {
      const d = new Date(p.createdAt).getDay();
      eng[d] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
      cnt[d]++;
    });
    return eng.map((e, i) => cnt[i] > 0 ? e / cnt[i] : 0);
  });

  // Best posting time per platform
  const bestBskyHour = $derived.by(() => {
    const eng = Array(24).fill(0);
    const cnt = Array(24).fill(0);
    bskyPosts.forEach(p => {
      const h = new Date(p.createdAt).getHours();
      eng[h] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
      cnt[h]++;
    });
    const avg = eng.map((e, i) => cnt[i] > 0 ? e / cnt[i] : 0);
    return avg.indexOf(Math.max(...avg));
  });
  const bestMastoHour = $derived.by(() => {
    const eng = Array(24).fill(0);
    const cnt = Array(24).fill(0);
    mastoPosts.forEach(p => {
      const h = new Date(p.createdAt).getHours();
      eng[h] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
      cnt[h]++;
    });
    const avg = eng.map((e, i) => cnt[i] > 0 ? e / cnt[i] : 0);
    return avg.indexOf(Math.max(...avg));
  });

  // Performance insights from the module (media, length, hashtag analysis)
  const insights = $derived(analyzePerformance(originalPosts));
</script>

<svelte:head><title>CrispDeck — Analytics</title><meta name="description" content="Post analytics and engagement stats" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Analytics tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/analytics" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Analytics</a>
    <a href="/calendar" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Calendar</a>
  </div>

  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <BarChart3 size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.analytics.title}</h1>
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
        <button onclick={() => exportAsMarkdown(originalPosts, handle)} class="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md">
          <Download size={10} /> MD
        </button>
        <button onclick={exportStatsSummary} class="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/30 border border-[var(--color-primary)]/30 rounded-md">
          <Download size={10} /> Stats
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
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-3">{i18n.t.analytics.loadPosts}</h3>
      <p class="text-sm text-[var(--color-text-muted)] mb-4">{i18n.t.analytics.loadHint}</p>
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
      <div class="max-w-md mx-auto mb-4">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-[var(--color-text-muted)]">{loadingAccount}</span>
          <span class="text-xs text-[var(--color-text-muted)]">{loadingPercent}%</span>
        </div>
        <div class="w-full h-2 bg-[var(--color-surface)] rounded-full border border-[var(--color-border)] overflow-hidden">
          <div
            class="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
            style="width: {loadingPercent}%"
          ></div>
        </div>
      </div>
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
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
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
      <button onclick={() => toggleStat('rate')} class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center hover:border-amber-500 transition-colors {expandedStat === 'rate' ? 'border-amber-500' : ''}">
        <Percent size={18} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-amber-400">{engagementRate}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Eng. per post</div>
      </button>
    </div>

    <!-- Expanded stat: top posts -->
    {#if expandedStat}
      <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <h3 class="text-sm font-semibold mb-3">
          Top 5 by {expandedStat === 'likes' ? 'Likes' : expandedStat === 'reposts' ? 'Boosts' : expandedStat === 'engagement' || expandedStat === 'rate' ? 'Engagement' : expandedStat === 'replies' ? 'Replies' : 'Recent'}
        </h3>
        <div class="space-y-2">
          {#each (expandedStat === 'likes' ? topByLikes : expandedStat === 'reposts' ? topByReposts : expandedStat === 'engagement' || expandedStat === 'rate' ? topByEngagement : originalPosts.slice(0, 5)) as post, i}
            <div class="flex items-start gap-3">
              <span class="text-xs text-[var(--color-text-muted)] font-bold mt-1 w-4">#{i + 1}</span>
              <div class="flex-1"><Post {post} /></div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Platform breakdown — detailed -->
    <div class="mb-6 grid grid-cols-2 gap-3">
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></span>
          <span class="text-sm font-medium">Bluesky</span>
          <span class="text-xs text-[var(--color-text-muted)] ml-auto">{bskyCount} posts</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex items-center gap-1.5">
            <Heart size={12} class="text-red-400" />
            <span class="text-[var(--color-text-muted)]">{bskyLikes.toLocaleString()} likes</span>
          </div>
          <div class="flex items-center gap-1.5">
            <Repeat size={12} class="text-green-400" />
            <span class="text-[var(--color-text-muted)]">{bskyReposts.toLocaleString()} boosts</span>
          </div>
          <div class="flex items-center gap-1.5">
            <MessageCircle size={12} class="text-blue-400" />
            <span class="text-[var(--color-text-muted)]">{bskyReplies.toLocaleString()} replies</span>
          </div>
          <div class="flex items-center gap-1.5">
            <TrendingUp size={12} class="text-amber-400" />
            <span class="text-[var(--color-text-muted)]">{bskyEngRate}/post</span>
          </div>
        </div>
      </div>
      <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></span>
          <span class="text-sm font-medium">Mastodon</span>
          <span class="text-xs text-[var(--color-text-muted)] ml-auto">{mastoCount} posts</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex items-center gap-1.5">
            <Heart size={12} class="text-red-400" />
            <span class="text-[var(--color-text-muted)]">{mastoLikes.toLocaleString()} likes</span>
          </div>
          <div class="flex items-center gap-1.5">
            <Repeat size={12} class="text-green-400" />
            <span class="text-[var(--color-text-muted)]">{mastoReposts.toLocaleString()} boosts</span>
          </div>
          <div class="flex items-center gap-1.5">
            <MessageCircle size={12} class="text-blue-400" />
            <span class="text-[var(--color-text-muted)]">{mastoReplies.toLocaleString()} replies</span>
          </div>
          <div class="flex items-center gap-1.5">
            <TrendingUp size={12} class="text-amber-400" />
            <span class="text-[var(--color-text-muted)]">{mastoEngRate}/post</span>
          </div>
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
        {#each postsByHour as count, hour}
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

    <!-- Cross-platform comparison -->
    {#if bskyCount > 0 && mastoCount > 0}
      <div class="mb-6">
        <h3 class="font-semibold text-sm mb-3 flex items-center gap-2">
          <TrendingUp size={16} />
          {i18n.t.analytics.comparison}
        </h3>

        <!-- Best posting times -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-1.5 mb-2">
              <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span>
              <span class="text-xs font-medium">{i18n.t.analytics.bestTime}</span>
            </div>
            <div class="text-2xl font-bold text-[var(--color-bluesky)]">{bestBskyHour}:00</div>
            <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.analytics.bestTimeHint}</p>
          </div>
          <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-1.5 mb-2">
              <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span>
              <span class="text-xs font-medium">{i18n.t.analytics.bestTime}</span>
            </div>
            <div class="text-2xl font-bold text-[var(--color-mastodon)]">{bestMastoHour}:00</div>
            <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.analytics.bestTimeHint}</p>
          </div>
        </div>

        <!-- Day-of-week engagement comparison -->
        <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)] mb-4">
          <h4 class="text-xs font-medium text-[var(--color-text-muted)] mb-3">{i18n.t.analytics.engagementByDay}</h4>
          <div class="grid grid-cols-7 gap-1">
            {#each dayNames as day, i}
              {@const bskyEng = bskyEngByDay[i]}
              {@const mastoEng = mastoEngByDay[i]}
              {@const maxEng = Math.max(...bskyEngByDay, ...mastoEngByDay, 1)}
              <div class="text-center">
                <div class="text-[9px] text-[var(--color-text-muted)] mb-1">{day}</div>
                <div class="flex gap-0.5 items-end h-16 justify-center">
                  <div
                    class="w-2.5 rounded-t bg-[var(--color-bluesky)]/60"
                    style="height: {(bskyEng / maxEng) * 100}%; min-height: 2px"
                    title="Bluesky: {bskyEng.toFixed(1)} avg engagement"
                  ></div>
                  <div
                    class="w-2.5 rounded-t bg-[var(--color-mastodon)]/60"
                    style="height: {(mastoEng / maxEng) * 100}%; min-height: 2px"
                    title="Mastodon: {mastoEng.toFixed(1)} avg engagement"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
          <div class="flex items-center justify-center gap-4 mt-2 text-[9px] text-[var(--color-text-muted)]">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-[var(--color-bluesky)]/60"></span> Bluesky</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-[var(--color-mastodon)]/60"></span> Mastodon</span>
          </div>
        </div>

        <!-- Activity comparison by hour -->
        <div class="bg-[var(--color-surface)] p-4 rounded-lg border border-[var(--color-border)]">
          <h4 class="text-xs font-medium text-[var(--color-text-muted)] mb-3">{i18n.t.analytics.activityByHour}</h4>
          <div class="flex items-end justify-between gap-0.5 h-20">
            {#each Array(24) as _, hour}
              {@const bskyH = bskyByHour[hour]}
              {@const mastoH = mastoByHour[hour]}
              {@const maxH = Math.max(...bskyByHour, ...mastoByHour, 1)}
              <div class="flex-1 flex gap-px items-end" title="{hour}:00 — Bluesky: {bskyH}, Mastodon: {mastoH}">
                <div class="flex-1 bg-[var(--color-bluesky)]/50 rounded-t" style="height: {(bskyH / maxH) * 100}%; min-height: 1px"></div>
                <div class="flex-1 bg-[var(--color-mastodon)]/50 rounded-t" style="height: {(mastoH / maxH) * 100}%; min-height: 1px"></div>
              </div>
            {/each}
          </div>
          <div class="flex justify-between mt-0.5">
            {#each Array(24) as _, h}
              <span class="text-[8px] text-[var(--color-text-muted)] flex-1 text-center">{h % 6 === 0 ? h : ''}</span>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Engagement Milestones -->
    {#if recentMilestones.length > 0}
      <div class="mt-6">
        <h3 class="text-sm font-semibold mb-3">🏆 Recent Milestones</h3>
        <div class="flex flex-wrap gap-2">
          {#each recentMilestones as ms}
            <div class="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs">
              <span class="font-bold text-[var(--color-primary)]">{ms.threshold}+</span>
              <span class="text-[var(--color-text-muted)]">{ms.metric}</span>
              <span class="text-[var(--color-text-muted)] text-[10px] ml-1">({ms.actualValue} actual)</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Performance Insights (media, length, hashtag patterns) -->
    {#if insights.length > 0}
      <div class="mt-6">
        <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingUp size={14} />
          Performance Insights
        </h3>
        <div class="space-y-2">
          {#each insights as insight}
            <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium text-[var(--color-primary)] px-1.5 py-0.5 bg-[var(--color-primary)]/10 rounded">{insight.category}</span>
                {#if insight.multiplier && insight.multiplier > 1}
                  <span class="text-xs font-bold text-green-400">{insight.multiplier.toFixed(1)}x</span>
                {/if}
              </div>
              <p class="text-sm text-[var(--color-text)]">{insight.description}</p>
              <p class="text-[10px] text-[var(--color-text-muted)] mt-1">{insight.metric}: {typeof insight.value === 'number' ? insight.value.toFixed(1) : insight.value}{insight.comparison ? ` vs ${insight.comparison.toFixed(1)} avg` : ''}</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
