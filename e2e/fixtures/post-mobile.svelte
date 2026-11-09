<script lang="ts">
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost } from '$lib/types';

  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#b8d9ed"/><path d="M0 280 Q150 200 300 280 T600 260 V360 H0Z" fill="#57824b"/></svg>');
  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#665ee8"/><text x="20" y="28" text-anchor="middle" font-size="24" fill="white">S</text></svg>');
  const base: UnifiedPost = {
    uri: 'at://did:plc:mobile/app.bsky.feed.post/1', text: '', createdAt: new Date().toISOString(), platform: 'bluesky', isRepost: false,
    author: { handle: 'long-handle-for-mobile-layout.bsky.social', displayName: 'Sebastian with a long display name', avatar },
    likeCount: 128123, repostCount: 23456, replyCount: 3456,
  };
  const photo = { $type: 'app.bsky.embed.images#view', images: [{ thumb: image, fullsize: image, alt: 'Landscape photo', aspectRatio: { width: 600, height: 360 } }] };
  const posts: UnifiedPost[] = [
    { ...base, embeds: photo },
    { ...base, uri: base.uri + '2', text: ('A long post that should expand without clipping its actions.\n').repeat(30) },
    { ...base, uri: base.uri + '3', text: 'A short, readable post with a link: https://example.com/story' },
    { ...base, uri: base.uri + '4', text: 'A photo gallery', embeds: { ...photo, images: Array.from({ length: 4 }, (_, index) => ({ ...photo.images[0], alt: `Gallery photo ${index + 1}` })) } },
  ];
  let quoteCount = $state(0);
  let replyCount = $state(0);
</script>

<div id="mobile-post-fixture" class="p-3 space-y-3">
  <h1 class="text-xl font-bold">Mobile post layout</h1>
  <output aria-label="Quote calls">{quoteCount}</output>
  <output aria-label="Reply calls">{replyCount}</output>
  {#each posts as post}
    <Post {post} feedPreview onlike={() => {}} onboost={() => {}} onreply={() => replyCount++} onquote={() => quoteCount++} />
  {/each}
</div>
