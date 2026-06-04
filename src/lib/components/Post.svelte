<script lang="ts">
  import { Heart, Repeat, MessageCircle, Quote, Bookmark, Share, Flag } from '@lucide/svelte';
  import { addBookmark, removeBookmark, isBookmarked } from '$lib/bookmarks';
  import { onMount } from 'svelte';
  import type { UnifiedPost } from '$lib/types';

  let { post, hideMedia = false, onlike, onboost, onreply, onquote }: {
    post: UnifiedPost;
    hideMedia?: boolean;
    onlike?: (post: UnifiedPost) => void;
    onboost?: (post: UnifiedPost) => void;
    onreply?: (post: UnifiedPost) => void;
    onquote?: (post: UnifiedPost) => void;
  } = $props();

  let liked = $state(false);
  let boosted = $state(false);
  let bookmarked = $state(false);

  onMount(async () => {
    bookmarked = await isBookmarked(post.uri);
  });

  let copied = $state(false);

  async function votePoll(pollId: string, choiceIndex: number) {
    try {
      // Find the Mastodon instance from the post URI
      const url = new URL(post.uri);
      // We need a token — this requires the onlike callback pattern
      // For now, use a direct fetch (the token will come from the parent page)
      const raw = post.raw as any;
      const instanceUrl = `${url.protocol}//${url.hostname}`;
      const resp = await fetch(`${instanceUrl}/api/v1/polls/${pollId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [choiceIndex] }),
      });
      if (resp.ok) {
        // Update the poll in-place to show results
        const updated = await resp.json();
        (post.raw as any).poll = updated;
      }
    } catch (e) {
      console.error('Vote failed:', e);
    }
  }

  async function handleShare() {
    const url = getPostUrl(post);
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch {
      // Fallback
      window.open(url, '_blank');
    }
  }

  function handleReport() {
    const reason = prompt('Report reason (optional):');
    if (reason === null) return; // Cancelled
    // Open the post on the platform's web UI where reporting is handled
    const url = getPostUrl(post);
    window.open(url, '_blank');
    alert('To complete the report, use the platform\'s reporting tool on the opened page.');
  }

  async function handleBookmark() {
    if (bookmarked) {
      await removeBookmark(post.uri);
    } else {
      await addBookmark(post);
    }
    bookmarked = !bookmarked;
  }
  let localLikeCount = $state(post.likeCount ?? 0);
  let localBoostCount = $state(post.repostCount ?? 0);

  async function handleLike() {
    if (!onlike) return;
    liked = !liked;
    localLikeCount += liked ? 1 : -1;
    onlike(post);
  }

  async function handleBoost() {
    if (!onboost) return;
    boosted = !boosted;
    localBoostCount += boosted ? 1 : -1;
    onboost(post);
  }

  function formatDate(dateString?: string): string {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getProfileUrl(p: UnifiedPost): string {
    const h = encodeURIComponent(p.author.handle);
    return `/profile?handle=${h}&platform=${p.platform}`;
  }

  function getExternalProfileUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      const account = raw.reblog ? raw.reblog.account : raw.account;
      return account?.url ?? '#';
    }
    return `https://bsky.app/profile/${p.author.handle}`;
  }

  function getThreadUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      const id = raw.reblog?.id ?? raw.id ?? '';
      return `/thread?id=${id}&platform=mastodon`;
    }
    return `/thread?uri=${encodeURIComponent(p.uri)}&platform=bluesky`;
  }

  function getPostUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      return (raw.reblog ? raw.reblog.url : p.uri) || p.uri;
    }
    const rkey = p.uri.split('/').pop();
    return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
  }

  function getMastodonHtml(): string {
    if (post.platform !== 'mastodon') return '';
    const raw = post.raw as any;
    return (raw.reblog ? raw.reblog.content : raw.content) ?? '';
  }

  function getMastodonMedia(): any[] {
    if (post.platform !== 'mastodon') return [];
    const raw = post.raw as any;
    const sources = [post.embeds, raw.mediaAttachments, raw.reblog?.mediaAttachments];
    for (const source of sources) {
      if (Array.isArray(source) && source.length > 0) {
        return source.filter((item: any) => item && item.type === 'image');
      }
    }
    return [];
  }

  function getBskyImages(): any[] {
    if (post.platform !== 'bluesky' || !post.embeds) return [];
    const embed = post.embeds as any;
    if (embed.$type === 'app.bsky.embed.images#view' && embed.images) {
      return embed.images;
    }
    return [];
  }

  function getBskyExternal(): any | null {
    if (post.platform !== 'bluesky' || !post.embeds) return null;
    const embed = post.embeds as any;
    if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
      return embed.external;
    }
    return null;
  }

  const mastodonMedia = $derived(getMastodonMedia());
  const bskyImages = $derived(getBskyImages());
  const bskyExternal = $derived(getBskyExternal());
  const mastodonHtml = $derived(getMastodonHtml());
  const platformColor = $derived(post.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)');

  // Labels on Bluesky posts
  const postLabels = $derived(() => {
    if (post.platform !== 'bluesky') return [];
    const raw = post.raw as any;
    const labels = raw?.post?.labels ?? raw?.labels ?? [];
    return labels.filter((l: any) => !l.neg).map((l: any) => l.val);
  });

  // Check label preferences
  function shouldWarnLabel(label: string): boolean {
    const prefs = JSON.parse(localStorage.getItem('crispdeck-label-prefs') ?? '{}');
    return prefs[label] === 'warn' || (!prefs[label] && ['porn', 'sexual', 'graphic-media', 'nudity'].includes(label));
  }

  function shouldHideLabel(label: string): boolean {
    const prefs = JSON.parse(localStorage.getItem('crispdeck-label-prefs') ?? '{}');
    return prefs[label] === 'hide';
  }

  const hiddenByLabel = $derived(postLabels().some(shouldHideLabel));
  const warnedLabels = $derived(postLabels().filter(shouldWarnLabel));
  let labelRevealed = $state(false);
</script>

{#if hiddenByLabel && !labelRevealed}
  <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
    <p class="text-xs text-[var(--color-text-muted)]">Content hidden: {postLabels().join(', ')}</p>
    <button onclick={() => labelRevealed = true} class="text-xs text-[var(--color-primary)] hover:underline mt-1">Show anyway</button>
  </div>
{:else}
<div class="group p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
  <!-- Label warnings -->
  {#if warnedLabels.length > 0 && !labelRevealed}
    <div class="mb-2 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-xs text-yellow-300 flex items-center justify-between">
      <span>Content warning: {warnedLabels.join(', ')}</span>
      <button onclick={() => labelRevealed = true} class="text-yellow-400 hover:underline ml-2">Show</button>
    </div>
  {/if}

  <!-- Label badges -->
  {#if postLabels().length > 0}
    <div class="mb-2 flex items-center gap-1 flex-wrap">
      {#each postLabels() as label}
        <span class="text-[9px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded">{label}</span>
      {/each}
    </div>
  {/if}
  {#if post.isRepost && post.repostAuthor}
    <div class="text-sm text-[var(--color-text-muted)] flex items-center gap-2 mb-2">
      <Repeat size={14} />
      <span>Reposted by {post.repostAuthor.displayName || post.repostAuthor.handle}</span>
    </div>
  {/if}

  <div class="flex items-start gap-3">
    <a href={getProfileUrl(post)}>
      {#if post.author.avatar}
        <img src={post.author.avatar} alt="" class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)]" />
      {:else}
        <div class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          {post.author.handle.charAt(0).toUpperCase()}
        </div>
      {/if}
    </a>
    <div class="flex-1 min-w-0">
      <a href={getProfileUrl(post)} class="flex items-center gap-2 mb-1 group">
        <span class="font-semibold text-[var(--color-text)] group-hover:underline truncate text-sm">
          {post.author.displayName || post.author.handle}
        </span>
        <span class="text-[var(--color-text-muted)] text-xs truncate">{post.author.handle}</span>
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background: {platformColor}"></span>
      </a>
      <a href={getThreadUrl(post)} class="block min-w-0 hover:bg-[var(--color-surface-hover)]/30 rounded -mx-1 px-1 transition-colors">
        {#if post.platform === 'mastodon' && mastodonHtml}
          <div class="text-sm text-[var(--color-text)] break-words prose-invert [&_a]:text-blue-400 [&_a]:hover:underline">
            {@html mastodonHtml}
          </div>
        {:else}
          <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{post.text}</p>
        {/if}
      </a>
    </div>
  </div>

  {#if !hideMedia}
    <div class="mt-2 pl-13">
      <!-- Bluesky images -->
      {#if bskyImages.length > 0}
        <div class="grid grid-cols-2 gap-2 pt-2">
          {#each bskyImages as image}
            <a href={image.fullsize} target="_blank" rel="noopener noreferrer">
              <img src={image.thumb} alt={image.alt || ''} class="rounded-md w-full aspect-video object-cover" />
            </a>
          {/each}
        </div>
      {/if}

      <!-- Bluesky external link -->
      {#if bskyExternal}
        <a href={bskyExternal.uri} target="_blank" rel="noopener noreferrer" class="mt-2 block border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
          {#if bskyExternal.thumb}
            <img src={bskyExternal.thumb} alt="" class="w-full h-32 object-cover" />
          {/if}
          <div class="p-3">
            <p class="text-xs text-[var(--color-text-muted)]">{new URL(bskyExternal.uri).hostname}</p>
            <p class="font-semibold text-sm text-[var(--color-text)]">{bskyExternal.title}</p>
            {#if bskyExternal.description}
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-2">{bskyExternal.description}</p>
            {/if}
          </div>
        </a>
      {/if}

      <!-- Mastodon images -->
      {#if mastodonMedia.length > 0}
        <div class="grid grid-cols-2 gap-2 pt-2">
          {#each mastodonMedia as attachment, i}
            {@const imageUrl = attachment.previewUrl || attachment.url || attachment.remoteUrl}
            {#if imageUrl}
              <a href={attachment.url || imageUrl} target="_blank" rel="noopener noreferrer">
                <img src={imageUrl} alt={attachment.description || `Image ${i + 1}`} class="rounded-md w-full aspect-video object-cover bg-[var(--color-surface-hover)]" loading="lazy" />
              </a>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Mastodon poll -->
      {#if post.platform === 'mastodon' && (post.raw as any)?.poll}
        {@const poll = (post.raw as any).poll}
        {@const hasVoted = poll.voted || poll.ownVotes?.length > 0}
        <div class="mt-2 space-y-1.5">
          {#each poll.options as option, i}
            {@const total = poll.votesCount || poll.options.reduce((s: number, o: any) => s + (o.votesCount ?? 0), 0) || 1}
            {@const pct = Math.round(((option.votesCount ?? 0) / total) * 100)}
            {@const isMyVote = poll.ownVotes?.includes(i)}
            {#if hasVoted || poll.expired}
              <div class="relative overflow-hidden rounded-md border border-[var(--color-border)] {isMyVote ? 'border-[var(--color-primary)]' : ''}">
                <div class="absolute inset-0 bg-[var(--color-primary)]/15" style="width: {pct}%"></div>
                <div class="relative flex items-center justify-between px-3 py-1.5">
                  <span class="text-xs">{isMyVote ? '✓ ' : ''}{option.title}</span>
                  <span class="text-[10px] text-[var(--color-text-muted)] font-medium">{pct}%</span>
                </div>
              </div>
            {:else}
              <button
                onclick={() => votePoll(poll.id, i)}
                class="w-full text-left px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
              >
                {option.title}
              </button>
            {/if}
          {/each}
          <p class="text-[10px] text-[var(--color-text-muted)]">
            {poll.votesCount ?? '?'} votes · {poll.expired ? 'Closed' : hasVoted ? 'Voted' : 'Open'}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex items-center justify-between mt-3 pl-13">
    <div class="flex items-center gap-4">
      {#if onreply}
        <button onclick={() => onreply?.(post)} class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-blue-400 transition-colors" title="Reply">
          <MessageCircle size={14} />
          <span class="text-xs">{post.replyCount ?? 0}</span>
        </button>
      {:else}
        <div class="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <MessageCircle size={14} />
          <span class="text-xs">{post.replyCount ?? 0}</span>
        </div>
      {/if}

      <button
        onclick={handleBoost}
        disabled={!onboost}
        class="flex items-center gap-1.5 transition-colors {boosted ? 'text-green-400' : 'text-[var(--color-text-muted)]'} {onboost ? 'hover:text-green-400' : ''}"
        title="Boost"
      >
        <Repeat size={14} />
        <span class="text-xs">{localBoostCount}</span>
      </button>

      {#if onquote}
        <button
          onclick={() => onquote?.(post)}
          class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-purple-400 transition-colors"
          title="Quote"
        >
          <Quote size={14} />
        </button>
      {/if}

      <button
        onclick={handleLike}
        disabled={!onlike}
        class="flex items-center gap-1.5 transition-colors {liked ? 'text-red-400' : 'text-[var(--color-text-muted)]'} {onlike ? 'hover:text-red-400' : ''}"
        title="Like"
      >
        <Heart size={14} class={liked ? 'fill-current' : ''} />
        <span class="text-xs">{localLikeCount}</span>
      </button>

      <button
        onclick={handleBookmark}
        class="flex items-center gap-1.5 transition-colors {bookmarked ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'} hover:text-yellow-400"
        title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Bookmark size={14} class={bookmarked ? 'fill-current' : ''} />
      </button>

      <button
        onclick={handleShare}
        class="flex items-center gap-1.5 transition-colors {copied ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'} hover:text-[var(--color-text)]"
        title={copied ? 'Copied!' : 'Copy link'}
      >
        <Share size={14} />
      </button>

      <button
        onclick={handleReport}
        class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors opacity-0 group-hover:opacity-100"
        title="Report"
      >
        <Flag size={12} />
      </button>
    </div>
    <a href={getPostUrl(post)} target="_blank" rel="noopener noreferrer" class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline">
      {formatDate(post.createdAt)}
    </a>
  </div>
</div>
{/if}
