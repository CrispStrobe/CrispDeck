/**
 * Optimistic like/repost, and putting it back when the network disagrees.
 *
 * The heart fills, the count moves and the phone buzzes before the request is
 * made — that part is right, waiting on a round trip to acknowledge a tap feels
 * broken. What was missing is the other half: the call was fired and never
 * awaited, so a failed like left the post looking liked, the count wrong, and
 * the only trace a console line the user would never see.
 *
 * Mounting the component is what makes this testable at all; see #2.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Post from '$lib/components/Post.svelte';
import { clearLogs, getLogs } from '$lib/debug-log';
import { getToasts, dismissToast } from '$lib/toast.svelte';
import type { UnifiedPost } from '$lib/types';

const post: UnifiedPost = {
  uri: 'at://did:plc:a/app.bsky.feed.post/1',
  text: 'a post to like',
  createdAt: '2026-01-10T12:00:00.000Z',
  platform: 'bluesky',
  author: { handle: '@alice.bsky.social', displayName: 'Alice' },
  likeCount: 10,
  repostCount: 4,
  replyCount: 0,
  raw: { post: { uri: 'at://did:plc:a/app.bsky.feed.post/1', cid: 'bafy' } },
} as UnifiedPost;

function render(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(Post, { target, props: { post, ...props } as any });
  flushSync();
  /**
   * Read a count off its own button, not off the whole component.
   *
   * An earlier version of this asserted against target.textContent, and
   * "puts the count back" passed against the unfixed component because some
   * other number in the post happened to contain the digits it looked for.
   */
  const countOn = (label: RegExp): string => {
    const btn = [...target.querySelectorAll('button')]
      .find((b) => label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    if (!btn) throw new Error(`no button matching ${label}`);
    return (btn.textContent ?? '').replace(/\s+/g, '');
  };

  return {
    target,
    likeCount: () => countOn(/like/i),
    boostCount: () => countOn(/repost|boost/i),
    counts: () => (target.textContent ?? '').replace(/\s+/g, ' '),
    click: (label: RegExp) => {
      const btn = [...target.querySelectorAll('button')]
        .find((b) => label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
      if (!btn) throw new Error(`no button matching ${label}`);
      btn.click();
      flushSync();
      return btn;
    },
    destroy: () => { unmount(app); target.remove(); },
  };
}

beforeEach(() => {
  clearLogs();
  for (const t of getToasts()) dismissToast(t.id);
});
afterEach(() => { document.body.innerHTML = ''; });

describe('like', () => {
  it('shows the new count immediately, before the request resolves', async () => {
    let release: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    const view = render({ onlike: () => pending });

    view.click(/like/i);
    expect(view.likeCount()).toBe('11');   // optimistic

    release!();
    await pending;
    flushSync();
    expect(view.likeCount()).toBe('11');   // and it stays
    view.destroy();
  });

  it('puts the count back when the like fails', async () => {
    const onlike = vi.fn(async () => { throw new Error('429 rate limited'); });
    const view = render({ onlike });

    view.click(/like/i);
    expect(view.likeCount()).toBe('11');   // optimistic

    await vi.waitFor(() => expect(view.likeCount()).toBe('10'));
    view.destroy();
  });

  it('tells the user it failed rather than only the console', async () => {
    const view = render({ onlike: async () => { throw new Error('nope'); } });
    view.click(/like/i);
    await vi.waitFor(() => expect(getToasts().map(t => t.type)).toContain('error'));
    view.destroy();
  });

  it('records the failure against a context for the log viewer', async () => {
    const view = render({ onlike: async () => { throw new Error('nope'); } });
    view.click(/like/i);
    await vi.waitFor(() => {
      expect(getLogs().map(l => l.source)).toContain('Post.handleLike');
    });
    view.destroy();
  });

  it('unliking that fails restores the liked state too', async () => {
    let attempt = 0;
    const onlike = vi.fn(async () => { if (++attempt === 2) throw new Error('nope'); });
    const view = render({ onlike });

    view.click(/like/i);                                   // like succeeds
    await vi.waitFor(() => expect(view.likeCount()).toBe('11'));
    view.click(/like/i);                                   // unlike fails
    await vi.waitFor(() => expect(view.likeCount()).toBe('11'));
    view.destroy();
  });

  it('a successful like raises no toast', async () => {
    const view = render({ onlike: async () => {} });
    view.click(/like/i);
    await vi.waitFor(() => expect(view.likeCount()).toBe('11'));
    expect(getToasts()).toHaveLength(0);
    view.destroy();
  });
});

describe('repost', () => {
  it('puts the count back when the repost fails', async () => {
    const view = render({ onboost: async () => { throw new Error('nope'); } });
    view.click(/repost|boost/i);
    await vi.waitFor(() => expect(view.boostCount()).toBe('4'));
    view.destroy();
  });

  it('tells the user it failed', async () => {
    const view = render({ onboost: async () => { throw new Error('nope'); } });
    view.click(/repost|boost/i);
    await vi.waitFor(() => expect(getToasts().map(t => t.type)).toContain('error'));
    view.destroy();
  });
});

describe('no handler attached', () => {
  it('does nothing and does not throw', () => {
    const view = render({});
    expect(() => view.click(/like/i)).not.toThrow();
    expect(getToasts()).toHaveLength(0);
    view.destroy();
  });
});
