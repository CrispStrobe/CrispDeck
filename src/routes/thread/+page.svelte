<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { MessageCircle, Loader2, ArrowLeft } from '@lucide/svelte';
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
  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

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
      accounts = await listAccounts();
      await initClients();

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

  async function initClients() {
    for (const acct of accounts) {
      try {
        const creds = JSON.parse(await getDecryptedCredentials(acct.id));
        if (acct.platform === 'bluesky') {
          clients.set(acct.id, new BlueskyClient(acct.handle, creds.app_password));
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch {}
    }
  }

  function getBskyClient(): BlueskyClient | null {
    // Try read-only first
    for (const [id, c] of clients) {
      if (accounts.find(a => a.id === id)?.platform === 'bluesky') return c as BlueskyClient;
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
    for (const [id, c] of clients) {
      if (accounts.find(a => a.id === id)?.platform === 'mastodon') { mastoClient = c as MastodonClient; break; }
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
</script>

<div class="p-6 max-w-3xl mx-auto">
  <a href="/feed" class="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-4">
    <ArrowLeft size={14} /> Back to feed
  </a>

  {#if error}
    <div class="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
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
