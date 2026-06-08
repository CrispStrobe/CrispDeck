<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Clock, Loader2, CheckCircle, Rss } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import Post from '$lib/components/Post.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import { buildCatchupFeed, scorePost, type CatchupWindow } from '$lib/catchup';
  import type { UnifiedPost, Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let allPosts: UnifiedPost[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let windowHours: CatchupWindow = $state(6);
  let reachedBottom = $state(false);

  let clientEntries: Map<number, ClientEntry> = new Map();

  const catchupPosts = $derived(buildCatchupFeed(allPosts, windowHours));

  const windowOptions: { value: CatchupWindow; label: string }[] = [
    { value: 1, label: '1h' },
    { value: 3, label: '3h' },
    { value: 6, label: '6h' },
    { value: 12, label: '12h' },
    { value: 24, label: '24h' },
  ];

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      if (accounts.length > 0) {
        await loadPosts();
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadPosts() {
    const posts: UnifiedPost[] = [];

    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      try {
        if (acct.platform === 'bluesky') {
          const bsky = entry.client as BlueskyClient;
          const r = await bsky.getTimeline();
          posts.push(...r.feed.map(p => normalizePost(p, 'bluesky')));
        } else {
          const masto = entry.client as MastodonClient;
          const statuses = await masto.getHomeTimeline();
          posts.push(...statuses.map(s => normalizePost(s, 'mastodon')));
        }
      } catch (e) {
        console.error(`Failed to load for ${acct.handle}:`, e);
      }
    }

    allPosts = posts;
  }

  async function handleLike(post: UnifiedPost) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (entry.client as BlueskyClient).like(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          await (entry.client as MastodonClient).favourite((post.raw as any).id);
        }
        return;
      } catch (e) { console.error('Like failed:', e); }
    }
  }

  async function handleBoost(post: UnifiedPost) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (entry.client as BlueskyClient).repost(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          await (entry.client as MastodonClient).reblog((post.raw as any).id);
        }
        return;
      } catch (e) { console.error('Boost failed:', e); }
    }
  }

  // Intersection observer for "caught up" detection
  let bottomSentinel: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!bottomSentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && catchupPosts.length > 0) {
        reachedBottom = true;
      }
    }, { threshold: 0.5 });
    observer.observe(bottomSentinel);
    return () => observer.disconnect();
  });

  // Reset "caught up" when changing window
  $effect(() => {
    windowHours; // track
    reachedBottom = false;
  });
</script>

<svelte:head><title>CrispDeck — {i18n.t.catchup.title}</title><meta name="description" content="Catch up on what you missed" /></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <!-- Discover tabs -->
  <div class="flex items-center gap-2 mb-4">
    <Clock size={24} />
    <h1 class="text-2xl font-bold">Discover</h1>
  </div>
  <div class="flex items-center gap-1 mb-4">
    <a href="/trending" class="px-4 py-2 text-sm font-medium rounded-t-md border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Trending</a>
    <a href="/catchup" class="px-4 py-2 text-sm font-medium rounded-t-md border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Catch Up</a>
  </div>

  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <h2 class="text-lg font-semibold">{i18n.t.catchup.title}</h2>
    </div>
    <div class="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-0.5">
      {#each windowOptions as opt}
        <button
          onclick={() => windowHours = opt.value}
          class="px-3 py-1 text-xs rounded-md transition-colors {windowHours === opt.value
            ? 'bg-[var(--color-primary)] text-white'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      <p class="text-sm text-[var(--color-text-muted)] mt-3">{i18n.t.catchup.loading}</p>
    </div>
  {:else if accounts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Rss size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <p class="text-[var(--color-text-muted)]">{i18n.t.catchup.noAccounts}</p>
    </div>
  {:else if catchupPosts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <CheckCircle size={48} class="text-green-400 mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">{i18n.t.catchup.allCaughtUp}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.catchup.nothingMissed.replace('{hours}', String(windowHours))}</p>
    </div>
  {:else}
    <!-- Post count -->
    <p class="text-sm text-[var(--color-text-muted)] mb-4">
      {i18n.t.catchup.postsInWindow.replace('{count}', String(catchupPosts.length)).replace('{hours}', String(windowHours))}
    </p>

    <!-- Posts sorted by engagement -->
    <div class="space-y-4">
      {#each catchupPosts as post, idx (post.uri)}
        <div class="relative">
          {#if idx < 3 && scorePost(post) > 0}
            <div class="absolute -left-2 -top-1 z-10">
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full {idx === 0 ? 'bg-yellow-500/20 text-yellow-300' : idx === 1 ? 'bg-gray-400/20 text-gray-300' : 'bg-amber-700/20 text-amber-400'}">
                #{idx + 1}
              </span>
            </div>
          {/if}
          <Post {post} onlike={handleLike} onboost={handleBoost} />
        </div>
      {/each}
    </div>

    <!-- Bottom sentinel & "caught up" message -->
    <div bind:this={bottomSentinel} class="py-8 text-center">
      {#if reachedBottom}
        <div class="inline-flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-700/50 rounded-full">
          <CheckCircle size={16} class="text-green-400" />
          <span class="text-sm text-green-300 font-medium">{i18n.t.catchup.allCaughtUp}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
