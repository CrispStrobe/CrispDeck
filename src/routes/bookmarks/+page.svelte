<script lang="ts">
  import { onMount } from 'svelte';
  import { Bookmark, Loader2, Inbox, RefreshCw } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { listBookmarks, importPlatformBookmarks } from '$lib/bookmarks';
  import { getAllBlueskyBookmarks } from '$lib/api/bluesky-bookmarks';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';

  let posts: UnifiedPost[] = $state([]);
  let loading = $state(true);
  let syncing = $state(false);
  let syncResult = $state('');
  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
    } catch {}
    posts = await listBookmarks();
    loading = false;
  });

  async function syncBookmarks() {
    syncing = true;
    syncResult = '';
    let totalImported = 0;

    for (const acct of accounts) {
      const entry = clientEntries.get(acct.id);
      if (!entry) continue;

      try {
        if (acct.platform === 'bluesky') {
          // Official Bluesky bookmarks (app.bsky.bookmark.*, since Bluesky 1.108)
          const agent = entry.oauthAgent ?? (() => { try { const a = (entry.client as BlueskyClient).getAgent(); return a?.session ? a : null; } catch { return null; } })();
          if (agent) {
            const bookmarks = await getAllBlueskyBookmarks(agent);
            const normalized = bookmarks
              .filter(b => b.item?.$type === 'app.bsky.feed.defs#postView')
              .map(b => normalizePost({ post: b.item } as any, 'bluesky'));
            totalImported += await importPlatformBookmarks(normalized);
          }
        } else if (acct.platform === 'mastodon') {
          const client = entry.client as MastodonClient;
          const token = client.getAccessToken();
          if (token) {
            const resp = await fetch(`${client.getInstanceUrl()}/api/v1/bookmarks?limit=40`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (resp.ok) {
              const statuses = await resp.json();
              const normalized = statuses.map((s: any) => normalizePost(s, 'mastodon'));
              totalImported += await importPlatformBookmarks(normalized);
            }
          }
        }
      } catch (e) {
        console.error(`Bookmark sync failed for ${acct.handle}:`, e);
      }
    }

    posts = await listBookmarks();
    syncResult = totalImported > 0
      ? `Imported ${totalImported} new bookmark${totalImported > 1 ? 's' : ''}.`
      : 'All bookmarks already synced.';
    syncing = false;
  }
</script>

<svelte:head><title>CrispDeck — Bookmarks</title><meta name="description" content="Your saved posts" /></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <!-- Bookmarks tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/bookmarks" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Bookmarks</a>
    <a href="/reading-lists" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Reading Lists</a>
  </div>

  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Bookmark size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.bookmarks.title}</h1>
      {#if posts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)]">({posts.length})</span>
      {/if}
    </div>
    {#if accounts.some(a => a.platform === 'mastodon' || a.platform === 'bluesky')}
      <button
        onclick={syncBookmarks}
        disabled={syncing}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
        title="Import bookmarks from connected platforms"
      >
        {#if syncing}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
        {i18n.t.bookmarks.sync}
      </button>
    {/if}
  </div>

  {#if syncResult}
    <div class="mb-4 p-2 bg-blue-900/30 border border-blue-800 rounded-lg text-blue-200 text-xs">
      {syncResult}
      <button onclick={() => syncResult = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if posts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Bookmark size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.bookmarks.noBookmarks}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.bookmarks.hint}</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each posts as post (post.uri)}
        <Post {post} />
      {/each}
    </div>
  {/if}
</div>
