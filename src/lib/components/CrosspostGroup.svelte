<script lang="ts">
  import Post from './Post.svelte';
  import type { CrosspostGroup } from '$lib/types';

  let { group, hideMedia = false }: { group: CrosspostGroup; hideMedia?: boolean } = $props();
</script>

<div class="p-4 bg-indigo-950/30 border-l-4 border-indigo-500 rounded-r-lg">
  <h3 class="font-semibold text-indigo-300 mb-3 text-sm">
    Crossposted Content
    <span class="text-xs font-normal text-indigo-400 ml-2">
      (Similarity: {(group.similarity * 100).toFixed(1)}%)
    </span>
  </h3>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    {#each group.posts as post}
      <Post {post} {hideMedia} />
    {/each}
  </div>
</div>
