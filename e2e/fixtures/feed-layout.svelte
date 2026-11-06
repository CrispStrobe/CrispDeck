<script lang="ts">
 import Post from '$lib/components/Post.svelte';
 import LinkContextMenu from '$lib/components/LinkContextMenu.svelte';
 let menuHarness = $state(false);
 import type { UnifiedPost } from '$lib/types';
 const img='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="600"><rect width="360" height="600" fill="orange"/></svg>');
 const base={uri:'at://did:plc:a/app.bsky.feed.post/1', text:'A sample post', createdAt:'2026-01-10T12:00:00Z',platform:'bluesky',author:{handle:'alice.bsky.social',displayName:'Alice'},likeCount:1,repostCount:1,replyCount:1,raw:{post:{uri:'at://did:plc:a/app.bsky.feed.post/1',cid:'x'}}};
 const photo={ $type:'app.bsky.embed.images#view',images:[{thumb:img,fullsize:img,alt:'orange image',aspectRatio:{width:360,height:600}}]};
 const textQuote=(embeds: unknown[] = []) => ({$type:'app.bsky.embed.record#view',record:{$type:'app.bsky.embed.record#viewRecord',uri:base.uri,author:base.author,value:{text:'Quoted text belongs below the original'},embeds}});
 const posts=[{...base, text:'A short post with a portrait image',embeds:photo}, {...base,uri:base.uri+'2',text:('A long post with lots of text.\n').repeat(30),embeds:photo}, {...base,uri:base.uri+'3',text:'A quoted post',embeds:{$type:'app.bsky.embed.record#view',record:{$type:'app.bsky.embed.record#viewRecord',uri:base.uri,author:base.author,value:{text:'Quoted image post'},embeds:[photo]}}}, {...base,uri:base.uri+'4',text:'Original text-only quote',embeds:textQuote()}, {...base,uri:base.uri+'5',text:'Original quote with link',embeds:textQuote([{$type:'app.bsky.embed.external#view',external:{uri:'https://example.com',title:'Example',thumb:img}}])}, {...base,uri:base.uri+'6',text:'Link card',embeds:{$type:'app.bsky.embed.external#view',external:{uri:'https://www.freiheitmachtpolitik.de/podcast/fm-politik',title:'Podcast',thumb:img}}}, {...base,uri:base.uri+'7',text:'A reply',replyParentUri:base.uri,raw:{reply:{parent:{$type:'app.bsky.feed.defs#postView',uri:base.uri,author:{displayName:'Parent author'},record:{text:'Parent message context'},labels:[]}}}}];
 if(typeof document!=='undefined')document.documentElement.dataset.sideMedia='true';
</script>
<div id="test-feed" style="height:100vh;overflow:auto;padding:16px">
 <h1>Feed heading</h1>
 {#each posts as post}<div class="fixture-post"><Post post={post as UnifiedPost} feedPreview onlike={() => {}} onboost={() => {}} /></div>{/each}
</div>

<button type="button" onclick={() => menuHarness = true}>Enable menu test</button>
{#if menuHarness}<LinkContextMenu />{/if}
