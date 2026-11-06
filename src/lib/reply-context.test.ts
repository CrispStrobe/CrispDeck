import { describe, it, expect } from 'vitest';
import { replyContext } from './reply-context';
import type { UnifiedPost } from './types';
const post = { platform:'bluesky', uri:'at://did:plc:reply/app.bsky.feed.post/1', replyParentUri:'at://did:plc:parent/app.bsky.feed.post/2', author:{handle:'reply'}, text:'response', createdAt:'2026-01-01',isRepost:false } as UnifiedPost;
describe('feed reply context', () => {
  it('shows the immediate parent supplied by Bluesky', () => {
    const parent = {$type:'app.bsky.feed.defs#postView',uri:post.replyParentUri,author:{displayName:'Arne',handle:'arne.bsky.social'},record:{text:'Parent post'},labels:[]};
    expect(replyContext({...post,raw:{reply:{parent}}})).toEqual({uri:post.replyParentUri,author:'Arne',text:'Parent post'});
  });
  it('keeps a generic link when the parent is blocked, missing or untrusted', () => {
    for (const parent of [undefined, {$type:'app.bsky.feed.defs#blockedPost'}, {$type:'app.bsky.feed.defs#postView',uri:'wrong'}])
      expect(replyContext({...post,raw:{reply:{parent}}})).toEqual({uri:post.replyParentUri});
  });
  it('does not expose labelled parent text', () => {
    const parent={$type:'app.bsky.feed.defs#postView',uri:post.replyParentUri,author:{handle:'a'},record:{text:'hidden'},labels:[{val:'adult'}]};
    expect(replyContext({...post,raw:{reply:{parent}}})?.text).toBeUndefined();
    expect(replyContext({...post,replyParentUri:undefined})).toBeNull();
  });
});
