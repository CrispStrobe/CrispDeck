<script lang="ts">
  import { base } from '$app/paths';
  import { onDestroy, onMount, tick } from 'svelte';
  import { initAllClients } from '$lib/api/client-factory';
  import { ArrowLeft, BookOpen, Share2 } from '@lucide/svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { i18n } from '$lib/i18n.svelte';
  import { detailCameFromDeck } from '$lib/deck-navigation';
  import { backToDeckLabel } from '$lib/deck-navigation-copy';
  import { loadThreadPage, parseThreadRequest, threadErrorMessage } from '$lib/thread-loader';
  import { partitionThreadReplies } from '$lib/thread-continuation';
  import { sameThreadAuthor, threadRows } from '$lib/thread-tree';
  import { performDeckAction } from '$lib/deck-actions';
  import { postContextParams } from '$lib/compose/context';
  import type { ClientEntry } from '$lib/api/client-factory';
  import { isThread, extractThreadText } from '$lib/thread-sync';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let loading = $state(true);
  let error = $state('');
  let ancestors: UnifiedPost[] = $state([]);
  let mainPost: UnifiedPost | null = $state(null);
  let replies: UnifiedPost[] = $state([]);
  let platform: Platform = $state('bluesky');

  let accounts: Account[] = $state([]);
  let clients: Map<number, ClientEntry> = new Map();
  let externalUrl = $state('');
  let requestSequence = 0;
  let disposed = false;
  let currentThreadUrl: URL | undefined;

  async function loadCurrentThread(url: URL) {
    currentThreadUrl = url;
    const sequence = ++requestSequence;
    loading = true; error = ''; articleMode = false;
    // Let the loading branch unmount Post before clearing its required props.
    // Query-only navigation reuses this page, including quoted-post links.
    await tick();
    if (disposed || sequence !== requestSequence) return;
    ancestors = []; mainPost = null; replies = []; externalUrl = '';
    try {
      const request = parseThreadRequest(url.searchParams);
      platform = request.platform;
      const result = await initAllClients();
      if (disposed || sequence !== requestSequence) return;
      accounts = result.accounts;
      clients = result.clients;
      const thread = await loadThreadPage(request, result.accounts, result.clients);
      if (disposed || sequence !== requestSequence) return;
      mainPost = thread.mainPost; ancestors = thread.ancestors; replies = thread.replies; externalUrl = thread.externalUrl ?? '';
    } catch (reason) {
      if (!disposed && sequence === requestSequence) error = threadErrorMessage(reason);
    } finally {
      if (!disposed && sequence === requestSequence) loading = false;
    }
  }

  // SvelteKit reuses this page for query-only navigation, including account
  // switches. Only the newest navigation may replace the visible thread.
  afterNavigate(({ to }) => { if (to?.url) void loadCurrentThread(to.url); });
  onMount(() => {
    const refreshAccount = () => { if (currentThreadUrl) void loadCurrentThread(currentThreadUrl); };
    window.addEventListener('crispdeck:accounts-changed', refreshAccount);
    return () => window.removeEventListener('crispdeck:accounts-changed', refreshAccount);
  });
  onDestroy(() => { disposed = true; requestSequence++; });

  let articleMode = $state(false);
  const groupedReplies = $derived(mainPost ? partitionThreadReplies(mainPost, replies) : { continuation: [], replies });
  const rows = $derived(mainPost ? threadRows(ancestors, mainPost, replies) : []);

  /** An article follows a contiguous self-thread, never jumps over another author. */
  const articlePosts = $derived.by(() => {
    if (!mainPost) return [];
    const prior: UnifiedPost[] = [];
    const seen = new Set<string>([mainPost.uri]);
    let child = mainPost;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const parent = ancestors[i];
      if (seen.has(parent.uri)) continue;
      if (!sameThreadAuthor(mainPost, parent)) break;
      const raw = parent.raw as { id?: string; reblog?: { id?: string } } | undefined;
      const id = raw?.reblog?.id ?? raw?.id;
      if (child.replyParentUri && child.replyParentUri !== parent.uri && child.replyParentUri !== id) break;
      prior.push(parent); seen.add(parent.uri); child = parent;
    }
    const continuation = groupedReplies.continuation.filter(post => {
      if (seen.has(post.uri)) return false;
      seen.add(post.uri); return true;
    });
    return [...prior.reverse(), mainPost, ...continuation];
  });

  const articleText = $derived(articlePosts.map(p => p.text).join('\n\n'));

  // Thread sync — detect if this is a thread by the same author (can be crossposted)
  const canSync = $derived(
    articlePosts.length >= 2 && isThread(articlePosts) &&
    accounts.some(a => a.handle === mainPost?.author.handle)
  );

  function syncToCompose() {
    if (!canSync) return;
    const text = extractThreadText(articlePosts);
    // Navigate to compose with the thread text pre-filled
    goto(`${base}/compose?text=${encodeURIComponent(text)}`);
  }

  function react(post: UnifiedPost, action: 'like' | 'repost', active = true) {
    return performDeckAction(post, action, active, clients, accounts.map(account => account.id));
  }
  function reply(post: UnifiedPost) {
    void goto(`${base}/compose?${postContextParams(post, 'reply')}`);
  }
  function quote(post: UnifiedPost) {
    void goto(`${base}/compose?${postContextParams(post, 'quote')}`);
  }
</script>

<svelte:head><title>CrispDeck — Thread</title></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-4">
    <button onclick={() => goto(`${base}/${detailCameFromDeck() ? 'deck' : 'feed'}`)} class="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <ArrowLeft size={14} /> {detailCameFromDeck() ? backToDeckLabel(i18n.lang) : i18n.t.profile.backToFeed}
    </button>
    <div class="flex items-center gap-2">
      {#if canSync}
        <button
          onclick={syncToCompose}
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-md transition-colors"
        >
          <Share2 size={14} />
          Crosspost thread
        </button>
      {/if}
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
  </div>

  {#if error}
    <div role="alert" class="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if externalUrl}
    <a href={externalUrl} target="_blank" rel="noopener noreferrer" class="inline-flex px-4 py-2 rounded bg-[var(--color-primary)] text-white">{i18n.t.common.openInBrowser}</a>
  {/if}

  {#if loading}
    <!-- Thread skeleton -->
    <div class="space-y-3 animate-pulse">
      <!-- Parent post skeleton -->
      <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 relative">
        <div class="absolute left-7 top-14 bottom-0 w-0.5 bg-[var(--color-border)]/50"></div>
        <div class="flex items-start gap-3">
          <div class="w-8 h-8 rounded-full bg-[var(--color-border)]"></div>
          <div class="flex-1">
            <div class="h-3 w-32 bg-[var(--color-border)] rounded mb-2"></div>
            <div class="h-3 w-full bg-[var(--color-border)]/60 rounded mb-1"></div>
            <div class="h-3 w-2/3 bg-[var(--color-border)]/40 rounded"></div>
          </div>
        </div>
      </div>
      <!-- Main post skeleton (highlighted) -->
      <div class="bg-[var(--color-surface)] rounded-lg border-2 border-[var(--color-primary)]/30 p-4">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-full bg-[var(--color-border)]"></div>
          <div class="flex-1">
            <div class="h-3.5 w-36 bg-[var(--color-border)] rounded mb-2"></div>
            <div class="space-y-1.5 mb-3">
              <div class="h-3 w-full bg-[var(--color-border)] rounded"></div>
              <div class="h-3 w-5/6 bg-[var(--color-border)] rounded"></div>
              <div class="h-3 w-2/3 bg-[var(--color-border)]/70 rounded"></div>
            </div>
            <div class="flex gap-6"><div class="h-3 w-8 bg-[var(--color-border)]/50 rounded"></div><div class="h-3 w-8 bg-[var(--color-border)]/50 rounded"></div><div class="h-3 w-8 bg-[var(--color-border)]/50 rounded"></div></div>
          </div>
        </div>
      </div>
      <!-- Reply skeletons -->
      {#each { length: 2 } as _}
        <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 ml-6">
          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-full bg-[var(--color-border)]"></div>
            <div class="flex-1">
              <div class="h-3 w-28 bg-[var(--color-border)] rounded mb-2"></div>
              <div class="h-3 w-full bg-[var(--color-border)]/60 rounded mb-1"></div>
              <div class="h-3 w-1/2 bg-[var(--color-border)]/40 rounded"></div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if articleMode && mainPost}
    <!-- Article (un-rolled thread) -->
    <article class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 md:p-8">
      <div class="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--color-border)]">
        {#if mainPost.author.avatar}
          <img loading="lazy" decoding="async" src={mainPost.author.avatar} alt="" width="40" height="40" class="w-10 h-10 rounded-full" />
        {/if}
        <div>
          <p class="font-semibold">{mainPost.author.displayName || mainPost.author.handle}</p>
          <p class="text-xs text-[var(--color-text-muted)]">@{mainPost.author.handle} · {articlePosts.length} {i18n.t.thread.parts}</p>
        </div>
        <span class="ml-auto w-2 h-2 rounded-full" style="background: var(--color-{platform})"></span>
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
    {#if mainPost}
      <div class="overflow-x-auto" aria-label={i18n.t.thread.discussionLabel}>
        {#each rows as row (row.post.uri)}
          <div class="mb-2 {row.selected ? 'border-l-4 border-[var(--color-primary)] rounded-r-lg' : ''}"
            style:margin-left="{row.depth * 16}px" style:min-width="min(22rem, 100%)" data-thread-depth={row.depth}>
            <Post post={row.post} onlike={(post, active) => react(post, 'like', active)} onboost={(post, active) => react(post, 'repost', active)} onreply={reply} onquote={quote} />
          </div>
        {/each}
      </div>
    {/if}

    {#if !mainPost && !error && !externalUrl}
      <p class="text-center py-12 text-[var(--color-text-muted)]">{i18n.t.thread.postNotFound}</p>
    {/if}
  {/if}
</div>
