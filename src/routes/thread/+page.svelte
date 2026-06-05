<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { MessageCircle, Loader2, ArrowLeft, BookOpen } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let loading = $state(true);
  let error = $state('');
  let ancestors: UnifiedPost[] = $state([]);
  let mainPost: UnifiedPost | null = $state(null);
  let replies: UnifiedPost[] = $state([]);
  let platform: Platform = $state('bluesky');

  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const uri = params.get('uri') ?? '';
    platform = (params.get('platform') as Platform) ?? 'bluesky';
    const statusId = params.get('id') ?? '';

    if (!uri && !statusId) {
      error = 'No post URI specified';
      loading = false;
      return;
    }

    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;

      if (platform === 'bluesky' && uri) {
        await loadBskyThread(uri);
      } else if (platform === 'mastodon' && (statusId || uri)) {
        await loadMastoThread(statusId || uri);
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  function getBskyClient(): BlueskyClient | null {
    for (const [id, entry] of clientEntries) {
      if (accounts.find(a => a.id === id)?.platform === 'bluesky') return entry.client as BlueskyClient;
    }
    return BlueskyClient.readOnly('_');
  }

  async function loadBskyThread(uri: string) {
    const client = getBskyClient();
    if (!client) { error = 'No Bluesky client'; return; }

    const thread = await client.getPostThread(uri);
    if (!thread || thread.$type === 'app.bsky.feed.defs#notFoundPost') {
      error = 'Post not found';
      return;
    }

    // Extract main post
    if ('post' in thread) {
      mainPost = normalizePost({ post: thread.post, reason: undefined } as any, 'bluesky');
    }

    // Extract parent chain
    let parent = (thread as any).parent;
    const parentPosts: UnifiedPost[] = [];
    while (parent && 'post' in parent) {
      parentPosts.unshift(normalizePost({ post: parent.post, reason: undefined } as any, 'bluesky'));
      parent = parent.parent;
    }
    ancestors = parentPosts;

    // Extract replies
    const replyPosts: UnifiedPost[] = [];
    function collectReplies(node: any, depth: number) {
      if (!node?.replies || depth > 3) return;
      for (const reply of node.replies) {
        if ('post' in reply) {
          replyPosts.push(normalizePost({ post: reply.post, reason: undefined } as any, 'bluesky'));
          collectReplies(reply, depth + 1);
        }
      }
    }
    collectReplies(thread, 0);
    replies = replyPosts;
  }

  async function loadMastoThread(idOrUri: string) {
    let mastoClient: MastodonClient | null = null;
    for (const [id, entry] of clientEntries) {
      if (accounts.find(a => a.id === id)?.platform === 'mastodon') { mastoClient = entry.client as MastodonClient; break; }
    }
    if (!mastoClient) { error = 'No Mastodon client'; return; }

    // If URI, extract ID from it
    let statusId = idOrUri;
    if (idOrUri.includes('/')) {
      const parts = idOrUri.split('/');
      statusId = parts[parts.length - 1];
    }

    const status = await mastoClient.getStatus(statusId);
    mainPost = normalizePost(status, 'mastodon');

    const context = await mastoClient.getStatusContext(statusId);
    ancestors = context.ancestors.map(s => normalizePost(s, 'mastodon'));
    replies = context.descendants.map(s => normalizePost(s, 'mastodon'));
  }

  let articleMode = $state(false);

  /** Build a single article from the thread author's posts (ancestors + main + their replies) */
  const articlePosts = $derived.by(() => {
    if (!mainPost) return [];
    const authorHandle = mainPost.author.handle;
    const all = [...ancestors, mainPost, ...replies].filter(
      p => p.author.handle === authorHandle
    );
    // Deduplicate by URI
    const seen = new Set<string>();
    return all.filter(p => {
      if (seen.has(p.uri)) return false;
      seen.add(p.uri);
      return true;
    });
  });

  const articleText = $derived(articlePosts.map(p => p.text).join('\n\n'));
</script>

<svelte:head><title>CrispDeck — Thread</title></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-4">
    <a href="/feed" class="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <ArrowLeft size={14} /> {i18n.t.profile.backToFeed}
    </a>
    {#if mainPost && articlePosts.length > 1}
      <button
        onclick={() => articleMode = !articleMode}
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors {articleMode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]'}"
      >
        <BookOpen size={14} />
        {i18n.t.thread.readAsArticle}
      </button>
    {/if}
  </div>

  {#if error}
    <div class="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if articleMode && mainPost}
    <!-- Article (un-rolled thread) -->
    <article class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 md:p-8">
      <div class="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--color-border)]">
        {#if mainPost.author.avatar}
          <img src={mainPost.author.avatar} alt="" class="w-10 h-10 rounded-full" />
        {/if}
        <div>
          <p class="font-semibold">{mainPost.author.displayName || mainPost.author.handle}</p>
          <p class="text-xs text-[var(--color-text-muted)]">@{mainPost.author.handle} · {articlePosts.length} {i18n.t.thread.parts}</p>
        </div>
        <span class="ml-auto w-2 h-2 rounded-full" style="background: {platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"></span>
      </div>
      <div class="prose prose-invert max-w-none text-[var(--color-text)] leading-relaxed text-[15px] space-y-4">
        {#each articleText.split('\n\n') as paragraph}
          {#if paragraph.trim()}
            <p>{paragraph}</p>
          {/if}
        {/each}
      </div>
      <div class="mt-6 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
        {new Date(mainPost.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </article>
  {:else}
    <!-- Ancestors (parent chain) -->
    {#if ancestors.length > 0}
      <div class="space-y-0 mb-2">
        {#each ancestors as post, i}
          <div class="relative pl-6 {i < ancestors.length - 1 ? 'pb-0' : ''}">
            <div class="absolute left-8 top-12 bottom-0 w-0.5 bg-[var(--color-border)]"></div>
            <Post {post} />
          </div>
        {/each}
      </div>
    {/if}

    <!-- Main post (highlighted) -->
    {#if mainPost}
      <div class="border-l-4 border-[var(--color-primary)] rounded-r-lg mb-4">
        <Post post={mainPost} />
      </div>
    {/if}

    <!-- Replies -->
    {#if replies.length > 0}
      <div class="border-t border-[var(--color-border)] pt-4">
        <h3 class="text-sm font-semibold text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <MessageCircle size={14} /> {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </h3>
        <div class="space-y-2 pl-4 border-l-2 border-[var(--color-border)]">
          {#each replies as post}
            <Post {post} />
          {/each}
        </div>
      </div>
    {/if}

    {#if !mainPost && !error}
      <p class="text-center py-12 text-[var(--color-text-muted)]">Post not found.</p>
    {/if}
  {/if}
</div>
