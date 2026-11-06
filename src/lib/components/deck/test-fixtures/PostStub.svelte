<script lang="ts">
  import type { UnifiedPost } from '$lib/types';
  let { post, onlike }: { post: UnifiedPost; onlike?: (post: UnifiedPost, active?: boolean) => void | Promise<void> } = $props();
  let error = $state('');
  const liked = $derived.by(() => {
    const raw = post.raw as any;
    const record = post.platform === 'mastodon' ? raw?.reblog ?? raw : raw?.post ?? raw;
    return !!(post.platform === 'mastodon' ? record?.favourited : record?.viewer?.like);
  });
  async function toggleLike() {
    try { await onlike?.(post, !liked); }
    catch (cause) { error = String(cause); }
  }
</script>

<article data-post-uri={post.uri} data-liked={liked} data-like-count={post.likeCount}>
  <span>{post.author.displayName || post.author.handle}</span>
  <p>{post.text}</p>
  {#if onlike}<button data-test-like onclick={toggleLike} aria-label={post.uri}>{liked ? '−' : '+'}</button>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</article>
