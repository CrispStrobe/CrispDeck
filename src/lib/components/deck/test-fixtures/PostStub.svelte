<script lang="ts">
  import type { UnifiedPost } from '$lib/types';
  let { post }: { post: UnifiedPost } = $props();
</script>

<article data-post-uri={post.uri}>
  <span>{post.author.displayName || post.author.handle}</span>
  <p>{post.text}</p>
</article>
