<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Archive, Search, Loader2, Download, Trash2, Database, RefreshCw } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost } from '$lib/api/unified';
  import { archivePosts, searchArchive, getArchiveStats, clearArchive, type ArchivedPost, type ArchiveType } from '$lib/archive';
  import { exportAsJson, exportAsCsv, exportAsMarkdown } from '$lib/utils/export';
  import Post from '$lib/components/Post.svelte';
  import type { Account, UnifiedPost, Platform } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let building = $state(false);
  let buildProgress = $state('');
  let error = $state('');

  // Archive stats
  let stats = $state({ total: 0, byType: { post: 0, like: 0, repost: 0, reply: 0 }, byPlatform: { bluesky: 0, mastodon: 0 }, dateRange: null as { oldest: string; newest: string } | null });

  // Search
  let query = $state('');
  let filterType: ArchiveType | '' = $state('');
  let filterPlatform: Platform | '' = $state('');
  let results: ArchivedPost[] = $state([]);
  let searched = $state(false);

  onMount(async () => {
    try {
      accounts = await listAccounts();
      stats = await getArchiveStats();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function buildArchive() {
    building = true;
    error = '';
    let total = 0;

    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);

        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();

          // Own posts
          let cursor: string | undefined;
          do {
            buildProgress = `Bluesky posts: ${total}...`;
            const r = await client.getAuthorFeed(acct.handle, cursor);
            const posts = r.feed.map(p => normalizePost(p, 'bluesky'));
            await archivePosts(posts, 'post');
            total += posts.length;
            cursor = r.cursor;
          } while (cursor);

          // Likes
          cursor = undefined;
          do {
            buildProgress = `Bluesky likes: ${total}...`;
            try {
              const r = await client.getActorLikes(acct.handle, cursor);
              const posts = r.feed.map(p => normalizePost(p, 'bluesky'));
              await archivePosts(posts, 'like');
              total += posts.length;
              cursor = r.cursor;
            } catch { cursor = undefined; }
          } while (cursor);

        } else {
          const client = new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          );
          const account = await client.getAccountByHandle(acct.handle);

          // Own posts
          let cursor: string | undefined;
          do {
            buildProgress = `Mastodon posts: ${total}...`;
            const statuses = await client.getAccountStatuses(account.id, cursor);
            const posts = statuses.map(p => normalizePost(p, 'mastodon'));
            await archivePosts(posts, 'post');
            total += posts.length;
            cursor = statuses.length >= 40 ? statuses[statuses.length - 1].id : undefined;
          } while (cursor);

          // Likes
          const token = client.getAccessToken();
          if (token) {
            try {
              buildProgress = `Mastodon likes: ${total}...`;
              const likesResp = await fetch(`${client.getInstanceUrl()}/api/v1/favourites?limit=40`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (likesResp.ok) {
                const likes = await likesResp.json();
                // snakeToCamel needed
                const posts = likes.map((s: any) => normalizePost(s, 'mastodon'));
                await archivePosts(posts, 'like');
                total += posts.length;
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error(`Archive build failed for ${acct.handle}:`, e);
      }
    }

    buildProgress = `Done! ${total} items archived.`;
    stats = await getArchiveStats();
    building = false;
  }

  async function doSearch() {
    searched = true;
    results = await searchArchive({
      query: query || undefined,
      type: filterType || undefined,
      platform: filterPlatform || undefined,
      limit: 100,
    });
  }

  async function handleClear() {
    if (confirm('Delete entire archive? This cannot be undone.')) {
      await clearArchive();
      stats = await getArchiveStats();
      results = [];
    }
  }

  function archiveToUnified(ap: ArchivedPost): UnifiedPost {
    return {
      uri: ap.uri,
      text: ap.text,
      author: { handle: ap.authorHandle, displayName: ap.authorName },
      createdAt: ap.createdAt,
      platform: ap.platform,
      likeCount: ap.likeCount,
      repostCount: ap.repostCount,
      replyCount: ap.replyCount,
      isRepost: ap.type === 'repost',
      raw: ap.raw,
    };
  }

  function exportResults() {
    const posts = results.map(archiveToUnified);
    exportAsJson(posts, 'archive');
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Archive size={24} />
      <h1 class="text-2xl font-bold">Archive</h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={buildArchive}
        disabled={building || accounts.length === 0}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-md disabled:opacity-50"
      >
        {#if building}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
        {building ? 'Building...' : stats.total > 0 ? 'Refresh' : 'Build Archive'}
      </button>
      {#if stats.total > 0}
        <button onclick={handleClear} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" title="Clear archive">
          <Trash2 size={14} />
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if building}
    <div class="mb-4 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-sm flex items-center gap-2">
      <Loader2 size={14} class="animate-spin text-[var(--color-primary)]" />
      {buildProgress}
    </div>
  {/if}

  <!-- Stats -->
  {#if stats.total > 0}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center">
        <Database size={16} class="text-[var(--color-text-muted)] mx-auto mb-1" />
        <div class="text-lg font-bold text-[var(--color-primary)]">{stats.total}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Total Archived</div>
      </div>
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center">
        <div class="text-lg font-bold text-[var(--color-text)]">{stats.byType.post}</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">Posts · {stats.byType.like} Likes · {stats.byType.repost} Reposts</div>
      </div>
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center">
        <div class="flex items-center justify-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span>
          <span class="text-sm">{stats.byPlatform.bluesky}</span>
          <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span>
          <span class="text-sm">{stats.byPlatform.mastodon}</span>
        </div>
        <div class="text-[10px] text-[var(--color-text-muted)]">By Platform</div>
      </div>
      <div class="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--color-border)] text-center">
        {#if stats.dateRange}
          <div class="text-xs text-[var(--color-text)]">{formatDate(stats.dateRange.oldest)}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">to {formatDate(stats.dateRange.newest)}</div>
        {/if}
      </div>
    </div>

    <!-- Search -->
    <form onsubmit={(e) => { e.preventDefault(); doSearch(); }} class="mb-6">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={query}
          placeholder="Search your archive..."
          class="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
        />
        <select bind:value={filterType} class="px-2 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text)]">
          <option value="">All types</option>
          <option value="post">Posts</option>
          <option value="like">Likes</option>
          <option value="repost">Reposts</option>
          <option value="reply">Replies</option>
        </select>
        <select bind:value={filterPlatform} class="px-2 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text)]">
          <option value="">All platforms</option>
          <option value="bluesky">Bluesky</option>
          <option value="mastodon">Mastodon</option>
        </select>
        <button type="submit" class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm">
          <Search size={14} />
        </button>
      </div>
    </form>

    <!-- Results -->
    {#if searched}
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm text-[var(--color-text-muted)]">{results.length} results</p>
        {#if results.length > 0}
          <button onclick={exportResults} class="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
            <Download size={12} /> Export results
          </button>
        {/if}
      </div>
      <div class="space-y-2">
        {#each results as item (item.uri)}
          <div class="relative">
            <span class="absolute -left-6 top-3 text-[10px] text-[var(--color-text-muted)] capitalize">{item.type}</span>
            <Post post={archiveToUnified(item)} />
          </div>
        {/each}
        {#if results.length === 0}
          <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No results. Try different search terms or filters.</p>
        {/if}
      </div>
    {/if}
  {:else if !loading && !building}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Archive size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Archive Yet</h3>
      <p class="text-sm text-[var(--color-text-muted)] mb-4">Build a local archive of your posts, likes, and reposts for fast searching and export.</p>
      <button
        onclick={buildArchive}
        disabled={building || accounts.length === 0}
        class="px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-md text-sm font-medium disabled:opacity-50"
      >
        Build Archive
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {/if}
</div>
