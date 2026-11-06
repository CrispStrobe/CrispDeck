import { describe, expect, it } from 'vitest';
import { partitionThreadReplies } from './thread-continuation';
import type { UnifiedPost } from './types';
const post = (id: string, author: string, parent?: string): UnifiedPost => ({uri:`at://${author}/app.bsky.feed.post/${id}`, author:{handle:author}, text:id, platform:'bluesky', createdAt:`2026-01-01T00:00:0${id}Z`, isRepost:false, replyParentUri:parent});
describe('thread continuations', () => {
  it('groups direct author chains in order and retains other replies, including OP replies to others', () => {
    const main=post('1','did:plc:op'), other=post('2','did:plc:other',main.uri), first=post('3','did:plc:op',main.uri), second=post('4','did:plc:op',first.uri), response=post('5','did:plc:op',other.uri);
    const result=partitionThreadReplies(main,[other,second,response,first,first]);
    expect(result.continuation.map(p=>p.text)).toEqual(['3','4']);
    expect(result.replies.map(p=>p.text)).toEqual(['2','5']);
  });
  it('matches Mastodon parent IDs and avoids confusing authors with the same handle', () => {
    const main={...post('1','a'),platform:'mastodon',uri:'https://a/1',raw:{id:'1',account:{id:'A'}}} as UnifiedPost;
    const own={...main,uri:'https://a/2',raw:{id:'2',account:{id:'A'}},replyParentUri:'1'};
    const impostor={...main,uri:'https://a/3',raw:{id:'3',account:{id:'B'}},replyParentUri:'1'};
    const result=partitionThreadReplies(main,[impostor,own]);
    expect(result.continuation).toEqual([own]);
    expect(result.replies).toEqual([impostor]);
  });
});
