import { describe, it, expect, vi } from 'vitest';
import { searchBlueskyAccount } from './bluesky-search';
import type { ClientEntry } from './client-factory';
const person = {did:'did:plc:polenz',handle:'polenz.bsky.social',displayName:'Ruprecht Polenz'};
const rawPost = {uri:'at://did:plc:polenz/app.bsky.feed.post/1',author:person,record:{text:'A podcast',createdAt:'2026-01-01T00:00:00Z'},indexedAt:'2026-01-01T00:00:00Z'};
function entry() {
  const client = {searchPosts:vi.fn(),searchActors:vi.fn().mockResolvedValue([person]),getAuthorFeed:vi.fn().mockResolvedValue({feed:[{post:rawPost}]})};
  const searchPosts = vi.fn().mockResolvedValue({data:{posts:[]}});
  return {client, searchPosts, value:{client, oauthAgent:{api:{app:{bsky:{feed:{searchPosts}}}}}} as unknown as ClientEntry};
}
describe('Bluesky account search', () => {
  it('uses the OAuth session and includes people and their recent posts', async () => {
    const e=entry(); const found=await searchBlueskyAccount(e.value,'Polenz');
    expect(e.searchPosts).toHaveBeenCalledWith({q:'Polenz',limit:50});
    expect(e.client.searchPosts).not.toHaveBeenCalled();
    expect(found.actors).toEqual([person]);
    expect(found.posts.map(p=>p.text)).toEqual(['A podcast']);
    expect(e.client.getAuthorFeed).toHaveBeenCalledWith(person.did,undefined,'posts_no_replies');
  });
  it('keeps account results and reports an unavailable post search', async () => {
    const e=entry(); e.searchPosts.mockRejectedValue(new Error('offline'));
    const found=await searchBlueskyAccount(e.value,'Polenz');
    expect(found.postFailed).toBe(true); expect(found.actors).toEqual([person]); expect(found.posts).toHaveLength(1);
  });
  it('does not treat search operators as a person name', async () => {
    const e=entry(); await searchBlueskyAccount(e.value,'from:polenz.bsky.social');
    expect(e.client.searchActors).not.toHaveBeenCalled(); expect(e.client.getAuthorFeed).not.toHaveBeenCalled();
  });
});
