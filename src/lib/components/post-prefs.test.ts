import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Post from './Post.svelte';

/**
 * The prefs "singleton" in Post.svelte sat in the instance <script>, which in
 * Svelte 5 runs once per component instance. So the cache was per-instance —
 * it re-read localStorage for every post, which is the opposite of what its
 * comment claimed — and the invalidation listener was registered again for
 * every post and never removed.
 *
 * Measured before the fix: ten Post instances produced ten
 * 'crispdeck:prefs-changed' listeners and thirty localStorage reads, and
 * unmounting all ten removed none of them. A deck of eight columns at fifty
 * posts each holds several hundred, still attached after the posts scroll
 * away, all firing on every settings change.
 *
 * These assert the counts, because "it is a singleton now" is not something a
 * test can otherwise tell apart from the version that was not.
 */

const post: any = {
  uri: 'at://did:plc:x/app.bsky.feed.post/1',
  cid: 'c',
  platform: 'bluesky',
  author: { handle: 'a.test', displayName: 'A' },
  text: 'hello',
  createdAt: new Date().toISOString(),
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  raw: {},
};

function mountPosts(count: number) {
  const mounted: Array<{ component: unknown; target: HTMLElement }> = [];
  for (let i = 0; i < count; i++) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted.push({ component: mount(Post, { target, props: { post } }), target });
  }
  flushSync();
  return mounted;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('post preferences are read once for the module', () => {
  it('registers no new prefs listener per post', () => {
    const spy = vi.spyOn(window, 'addEventListener');

    const mounted = mountPosts(10);
    const added = spy.mock.calls.filter((c) => c[0] === 'crispdeck:prefs-changed').length;

    expect(added, '10 posts used to add 10 listeners that were never removed').toBe(0);
    for (const m of mounted) unmount(m.component as never);
  });

  it('does not re-read the preference keys for every post', () => {
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const KEYS = ['crispdeck-hide-engagement', 'crispdeck-media-preview', 'crispdeck-compact-posts'];

    const mounted = mountPosts(10);
    const prefReads = reads.mock.calls.filter((c) => KEYS.includes(String(c[0]))).length;

    // The module read them when it first loaded, before this test ran.
    expect(prefReads, '10 posts used to make 30 reads of these three keys').toBe(0);
    for (const m of mounted) unmount(m.component as never);
  });

  it('still picks up a settings change', () => {
    // The listener has to survive being registered only once — a fix that
    // simply deleted it would pass both assertions above.
    const mounted = mountPosts(1);
    localStorage.setItem('crispdeck-compact-posts', 'true');
    window.dispatchEvent(new Event('crispdeck:prefs-changed'));
    flushSync();

    // Reading through the module's accessor reflects the new value.
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const again = mountPosts(1);
    expect(reads.mock.calls.some((c) => c[0] === 'crispdeck-compact-posts')).toBe(true);

    localStorage.removeItem('crispdeck-compact-posts');
    for (const m of [...mounted, ...again]) unmount(m.component as never);
  });
});
