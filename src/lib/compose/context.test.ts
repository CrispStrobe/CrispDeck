import { describe, expect, it } from 'vitest';
import type { Account, UnifiedPost } from '$lib/types';
import { postContext, postContextKey, hasDraftContent, postContextParams, composeContextFromParams } from './context';
import { snapshot } from '$lib/publishing/snapshots';

const post: UnifiedPost = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/123', text: 'Quoted text', platform: 'bluesky',
  author: { handle: 'alice.bsky.social' }, isRepost: false, createdAt: '2026-01-01T00:00:00Z',
  raw: { post: { cid: 'cid123', record: { reply: { root: { uri: 'at://did:plc:root/app.bsky.feed.post/root', cid: 'root-cid' } } } } },
};

describe('post context', () => {
  it.each(['reply', 'quote'] as const)('carries %s metadata and source identity through URL navigation', action => {
    const scoped = { ...post, sourceAccountId: 4, raw: (post.raw as any).post };
    const params = postContextParams(scoped, action);
    expect(params.get('account')).toBe('4');
    const restored = composeContextFromParams(params, [
      { id: 1, platform: 'bluesky', handle: 'personal.bsky.social' },
      { id: 4, platform: 'bluesky', handle: 'work.bsky.social' },
    ] as Account[]);
    expect(restored).toMatchObject({
      ...postContext(action === 'reply' ? scoped : null, action === 'quote' ? scoped : null), accountIds: [4],
    });
  });
  it('carries a boosted Mastodon reply local ID and quote URL independently', () => {
    const scoped = { ...post, platform: 'mastodon' as const, sourceAccountId: 2,
      uri: 'https://remote.example/@alice/123', raw: { id: 'boost-local', reblog: { id: 'local-parent' } } };
    expect(postContextParams(scoped, 'reply').get('replyId')).toBe('local-parent');
    const quote = postContextParams(scoped, 'quote');
    expect(quote.get('quoteUrl')).toBe(scoped.uri);
    expect(quote.has('quoteUri')).toBe(false);
  });
  it('keeps Bluesky reply parent and root, for both timeline and direct-post shapes', () => {
    const first = postContext(post, null);
    const direct = postContext({ ...post, raw: (post.raw as any).post }, null);
    expect(direct).toEqual(first);
    expect(first.options.replyTo).toMatchObject({ uri: post.uri, cid: 'cid123', rootUri: 'at://did:plc:root/app.bsky.feed.post/root', rootCid: 'root-cid', platform: 'bluesky' });
  });
  it('has a native Bluesky quote and a web link for crossposting the quote to Mastodon', () => {
    expect(postContext(null, post)).toEqual({
      options: { quoteUri: post.uri, quoteCid: 'cid123', quoteUrl: 'https://bsky.app/profile/alice.bsky.social/post/123' },
      display: { quoteAuthor: 'alice.bsky.social', quoteText: 'Quoted text', replyAuthor: '' },
    });
  });
  it('retains Mastodon reply ids and HTTPS quote links without AT protocol metadata', () => {
    const mastodon = { ...post, platform: 'mastodon' as const, uri: 'https://social.example/@alice/123', raw: { id: '123' } };
    expect(postContext(mastodon, null).options.replyTo).toMatchObject({ id: '123', platform: 'mastodon' });
    expect(postContext({ ...mastodon, raw: { id: 'boost-456', reblog: { id: '123' } } }, null).options.replyTo).toMatchObject({ id: '123', platform: 'mastodon' });
    expect(postContext(null, mastodon).options).toEqual({ quoteUrl: mastodon.uri });
  });
  it('compares the post identity without letting text edits change context', () => {
    expect(postContextKey(postContext(post, null).options)).toBe(postContextKey(postContext({ ...post, text: 'Changed' }, null).options));
    expect(postContextKey(postContext(null, post).options)).not.toBe(postContextKey(postContext(post, null).options));
    expect(postContextKey({})).toBe('');
  });
  it('treats destination overrides and public media URLs as draft content', () => {
    expect(hasDraftContent(snapshot('test', '', [1], { '1': 'My custom post' }, {}))).toBe(true);
    expect(hasDraftContent(snapshot('test', '', [1], {}, { mediaUrls: ['https://media.example/photo.png'] }))).toBe(true);
    expect(hasDraftContent(snapshot('test', '  ', [1], { '1': ' ' }, {}))).toBe(false);
  });
});
