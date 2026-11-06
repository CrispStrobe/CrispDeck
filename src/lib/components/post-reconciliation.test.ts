import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { UnifiedPost } from '$lib/types';
import type { CountUpdate } from '$lib/jetstream';

const boundaries = vi.hoisted(() => ({ watchPost: vi.fn(), unwatchPost: vi.fn(), error: vi.fn() }));
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: vi.fn(), removeBookmark: vi.fn() }));
vi.mock('$lib/jetstream', () => ({ jetstream: { watchPost: boundaries.watchPost, unwatchPost: boundaries.unwatchPost } }));
vi.mock('$lib/toast.svelte', () => ({ toast: { error: boundaries.error, warning: vi.fn(), success: vi.fn() } }));
import Post from './Post.svelte';

const uri = 'at://did:plc:alice/app.bsky.feed.post/1';
function post(liked = false, likeCount = 10, boosted = false, repostCount = 4, sourceAccountId = 2): UnifiedPost {
  return { uri, text: 'A post in multiple columns', platform: 'bluesky', sourceAccountId, sourceAccount: `account-${sourceAccountId}.bsky.social`,
    author: { handle: 'alice.bsky.social' }, createdAt: '2026-01-01T00:00:00Z', isRepost: false, likeCount, repostCount,
    raw: { post: { uri, cid: 'post-cid', viewer: { like: liked ? 'at://did:plc:writer/app.bsky.feed.like/1' : undefined,
      repost: boosted ? 'at://did:plc:writer/app.bsky.feed.repost/1' : undefined } } },
  };
}
const instances: ReturnType<typeof createClassComponent>[] = [];
type Action = (value: UnifiedPost, active?: boolean) => void | Promise<void>;
function render(value: UnifiedPost, onlike: Action = async () => {}, onboost: Action = async () => {}) {
  const target = document.createElement('div'); document.body.append(target);
  const instance = createClassComponent({ component: Post, target, props: { post: value, onlike, onboost } });
  instances.push(instance); flushSync();
  function button(action: 'like' | 'boost' = 'like') {
    const pattern = action === 'like' ? /^(?:Unlike|Like) \(/ : /^(?:Undo boost|Boost) \(/;
    const result = [...target.querySelectorAll('button')].find(item => pattern.test(item.getAttribute('aria-label') ?? ''));
    if (!result) throw new Error(`Missing ${action} control`);
    return result;
  }
  return { target, button,
    count: (action: 'like' | 'boost' = 'like') => Number(button(action).textContent?.trim()),
    active: (action: 'like' | 'boost' = 'like') => button(action).getAttribute('aria-pressed') === 'true',
    click: (action: 'like' | 'boost' = 'like') => { button(action).click(); flushSync(); },
    update: (next: UnifiedPost) => { instance.$set({ post: next }); flushSync(); },
  };
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(async () => {
  for (const instance of instances.splice(0)) instance.$destroy();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  document.body.innerHTML = '';
});

describe('scoped post reaction reconciliation', () => {
  it('uses refreshed viewer flags and server counts for both like and repost controls', () => {
    const view = render(post(true, 10, true, 4));
    expect(view.active()).toBe(true); expect(view.active('boost')).toBe(true);
    view.update(post(false, 9, false, 3));
    expect(view.active()).toBe(false); expect(view.count()).toBe(9);
    expect(view.active('boost')).toBe(false); expect(view.count('boost')).toBe(3);
    view.update(post(true, 12, true, 5));
    expect(view.active()).toBe(true); expect(view.count()).toBe(12);
    expect(view.active('boost')).toBe(true); expect(view.count('boost')).toBe(5);
  });

  it('reflects an unlike in another column without retaining an extra decrement on the clicked copy', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => finish = resolve);
    const first = render(post(true, 10), () => pending);
    const second = render(post(true, 10));
    const otherAccount = render(post(true, 20, false, 4, 7));
    first.click();
    expect(first.active()).toBe(false); expect(first.count()).toBe(9);
    expect(second.active()).toBe(true);
    // The route replaces same-account copies with viewer + count together.
    first.update(post(false, 9)); second.update(post(false, 9));
    expect(first.count()).toBe(9); expect(second.count()).toBe(9); expect(second.active()).toBe(false);
    expect(otherAccount.active()).toBe(true); expect(otherAccount.count()).toBe(20);
    finish(); await pending;
    await vi.waitFor(() => { flushSync(); expect(first.button().disabled).toBe(false); });
    expect(first.count()).toBe(9); expect(second.count()).toBe(9);
  });

  it('reconciles authoritative viewer and count updates on the same row object', () => {
    const value = post(true, 10, true, 4);
    const view = render(value);
    (value.raw as any).post.viewer = {};
    value.likeCount = 9; value.repostCount = 3;
    view.update(value);
    expect(view.active()).toBe(false); expect(view.count()).toBe(9);
    expect(view.active('boost')).toBe(false); expect(view.count('boost')).toBe(3);
  });

  it.each(['like', 'boost'] as const)('preserves pending %s feedback through a stale refresh and drops its offset when acknowledged', async action => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => finish = resolve);
    const view = render(post(), action === 'like' ? () => pending : async () => {}, action === 'boost' ? () => pending : async () => {});
    view.click(action);
    expect(view.active(action)).toBe(true);
    expect(view.count(action)).toBe(action === 'like' ? 11 : 5);
    view.update(post(false, 12, false, 6));
    expect(view.active(action)).toBe(true);
    expect(view.count(action)).toBe(action === 'like' ? 13 : 7);
    expect(view.button(action).disabled).toBe(true);
    view.update(post(action === 'like', 13, action === 'boost', 7));
    expect(view.count(action)).toBe(action === 'like' ? 13 : 7);
    finish(); await pending;
    await vi.waitFor(() => { flushSync(); expect(view.button(action).disabled).toBe(false); });
    expect(view.active(action)).toBe(true);
    expect(view.count(action)).toBe(action === 'like' ? 13 : 7);
  });

  it('rolls a failed action back to the latest authoritative viewer/count instead of subtracting twice', async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => fail = reject);
    const view = render(post(), () => pending);
    view.click();
    // Another tab confirms that this account already likes the post.
    view.update(post(true, 12));
    expect(view.count()).toBe(12);
    fail(new Error('Request failed'));
    await vi.waitFor(() => { flushSync(); expect(view.button().disabled).toBe(false); });
    expect(view.active()).toBe(true); expect(view.count()).toBe(12);
    expect(boundaries.error).toHaveBeenCalledOnce();
  });

  it('resets live count offsets when a refreshed server count includes those events', async () => {
    const view = render(post());
    await vi.waitFor(() => expect(boundaries.watchPost).toHaveBeenCalledOnce());
    const listener = boundaries.watchPost.mock.calls[0][1] as (update: CountUpdate) => void;
    listener({ uri, type: 'like', delta: 1 }); listener({ uri, type: 'repost', delta: 1 }); flushSync();
    expect(view.count()).toBe(11); expect(view.count('boost')).toBe(5);
    view.update(post(false, 11, false, 5));
    expect(view.count()).toBe(11); expect(view.count('boost')).toBe(5);
  });

  it('does not apply a previous account’s failed request to a newly scoped copy', async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => fail = reject);
    const callback = vi.fn(() => pending);
    const view = render(post(), callback);
    view.click();
    view.update(post(false, 5, false, 2, 7));
    expect(view.active()).toBe(false); expect(view.count()).toBe(5);
    expect(view.button().disabled).toBe(false);
    fail(new Error('The previous account disconnected'));
    await vi.waitFor(() => expect(boundaries.error).toHaveBeenCalledOnce());
    flushSync();
    expect(view.active()).toBe(false); expect(view.count()).toBe(5);
  });
});
