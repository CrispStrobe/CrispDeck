/**
 * Accessibility of the post markup itself.
 *
 * Lighthouse scores five routes, all logged out, so it has never seen a post.
 * The alternative was seeding a session and scoring /deck — but what that
 * would actually add is accessibility auditing of this markup, and asserting
 * it here is cheaper, runs in the ordinary suite, and needs no browser.
 *
 * These are the audits that would apply to a rendered post: every control
 * reachable and named, images described, structure announced. A screen reader
 * user meets a timeline as a list of hundreds of these.
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Post from '$lib/components/Post.svelte';
import type { UnifiedPost } from '$lib/types';

const basePost = {
  uri: 'at://did:plc:a/app.bsky.feed.post/1',
  text: 'a post with some text in it',
  createdAt: '2026-01-10T12:00:00.000Z',
  platform: 'bluesky',
  author: { handle: '@alice.bsky.social', displayName: 'Alice' },
  likeCount: 10,
  repostCount: 4,
  replyCount: 2,
  raw: { post: { uri: 'at://did:plc:a/app.bsky.feed.post/1', cid: 'bafy' } },
} as unknown as UnifiedPost;

const mounted: Array<{ c: unknown; t: HTMLElement }> = [];

function render(post: UnifiedPost = basePost, props: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const c = mount(Post, { target, props: { post, onlike: () => {}, onboost: () => {}, ...props } });
  flushSync();
  mounted.push({ c, t: target });
  return target;
}

/** The accessible name of an element, as a screen reader would compute it. */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label.trim();
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const ref = document.getElementById(labelledby);
    if (ref) return (ref.textContent ?? '').trim();
  }
  const title = el.getAttribute('title');
  if (title) return title.trim();
  return (el.textContent ?? '').trim();
}

afterEach(() => {
  for (const m of mounted.splice(0)) unmount(m.c as never);
  document.body.innerHTML = '';
});

describe('every control in a post has an accessible name', () => {
  it('names every button', () => {
    // axe's button-name rule. An unnamed button is announced as "button",
    // and a post has several of them in a row.
    const target = render();
    const unnamed = [...target.querySelectorAll('button')]
      .filter((b) => !accessibleName(b))
      .map((b) => b.outerHTML.slice(0, 70));

    expect(unnamed, `these buttons announce as just "button":\n${unnamed.join('\n')}`).toEqual([]);
  });

  it('names every link', () => {
    const target = render();
    const unnamed = [...target.querySelectorAll('a')]
      .filter((a) => !accessibleName(a))
      .map((a) => a.outerHTML.slice(0, 70));

    expect(unnamed).toEqual([]);
  });

  it('finds controls at all, so the assertions above are not vacuous', () => {
    const target = render();
    expect(target.querySelectorAll('button').length).toBeGreaterThan(2);
  });
});

describe('images carry alt text', () => {
  it('gives the author avatar an alt attribute', () => {
    // axe's image-alt rule: every img needs alt, even if empty for decoration.
    const target = render({ ...basePost, author: { ...basePost.author, avatar: 'https://cdn.test/a.png' } } as UnifiedPost);
    const missing = [...target.querySelectorAll('img')].filter((i) => i.getAttribute('alt') === null);
    expect(missing.map((i) => i.outerHTML.slice(0, 70))).toEqual([]);
  });

  it('describes post media with the author\'s alt text when there is one', () => {
    const post = {
      ...basePost,
      // The component reads post.embeds, not raw.post.embed.
      embeds: {
        $type: 'app.bsky.embed.images#view',
        images: [{ thumb: 'https://cdn.test/t.jpg', fullsize: 'https://cdn.test/f.jpg', alt: 'a hand-written note' }],
      },
    } as unknown as UnifiedPost;
    const target = render(post);
    const alts = [...target.querySelectorAll('img')].map((i) => i.getAttribute('alt'));
    expect(alts).toContain('a hand-written note');
  });
});

it('opens a multi-image post in a screen-level gallery and navigates between images', () => {
  const post = {
    ...basePost,
    embeds: {
      $type: 'app.bsky.embed.images#view',
      images: [
        { thumb: 'https://cdn.test/one-thumb.jpg', fullsize: 'https://cdn.test/one.jpg', alt: 'First image' },
        { thumb: 'https://cdn.test/two-thumb.jpg', fullsize: 'https://cdn.test/two.jpg', alt: 'Second image' },
      ],
    },
  } as unknown as UnifiedPost;
  const target = render(post);
  const thumbnail = target.querySelector('img[alt="First image"]') as HTMLImageElement;
  expect(thumbnail.classList.contains('media-preview-image')).toBe(true);
  flushSync(() => thumbnail.closest('button')!.click());
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/one.jpg');
  flushSync(() => (dialog.querySelector('button[aria-label="Next image"]') as HTMLButtonElement).click());
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/two.jpg');
  flushSync(() => (dialog.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps four images in one scrollable row and provides scroll controls', () => {
  const post = {
    ...basePost,
    embeds: {
      $type: 'app.bsky.embed.images#view',
      images: [1, 2, 3, 4].map((n) => ({ thumb: `https://cdn.test/${n}.jpg`, fullsize: `https://cdn.test/full-${n}.jpg`, alt: `Image ${n}` })),
    },
  } as unknown as UnifiedPost;
  const target = render(post);
  const strip = target.querySelector('.media-strip') as HTMLElement;
  expect(strip.querySelectorAll('.media-tile')).toHaveLength(4);
  const scrollBy = vi.fn();
  strip.scrollBy = scrollBy;
  flushSync(() => (target.querySelector('[aria-label="Scroll images right"]') as HTMLButtonElement).click());
  expect(scrollBy).toHaveBeenCalled();
});

it('uses fitted image previews for an external link and a quoted photo', () => {
  const post = {
    ...basePost,
    embeds: {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.com/article', title: 'Article', thumb: 'https://cdn.test/link.jpg' } },
      record: { record: { $type: 'app.bsky.embed.record#viewRecord', uri: 'at://did:plc:a/app.bsky.feed.post/2', author: { handle: 'alice.test' }, value: { text: 'Quoted post' }, embeds: [{ $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.test/quote.jpg', fullsize: 'https://cdn.test/quote-full.jpg', alt: 'Article page' }] }] } },
    },
  } as unknown as UnifiedPost;
  const target = render(post);
  const linkImage = target.querySelector('img[src="https://cdn.test/link.jpg"]')!;
  const quoteImage = target.querySelector('img[src="https://cdn.test/quote.jpg"]')!;
  expect(linkImage.classList.contains('link-preview-image')).toBe(true);
  expect(quoteImage.classList.contains('link-preview-image')).toBe(true);
  expect(linkImage.classList.contains('object-cover')).toBe(false);
  expect(quoteImage.classList.contains('object-cover')).toBe(false);
});

describe('the post is announced as a unit', () => {
  it('exposes an article role, so a reader can jump post to post', () => {
    // Without it a timeline is one undifferentiated run of text.
    const target = render();
    expect(target.querySelector('article, [role="article"]')).not.toBeNull();
  });

  it('marks the timestamp up as a time element', () => {
    // "2h" alone is meaningless read aloud; <time datetime> carries the real
    // instant for anything that wants it.
    const target = render();
    const time = target.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('datetime') || accessibleName(time!)).toBeTruthy();
  });
});

describe('interactive elements are reachable by keyboard', () => {
  it('uses no positive tabindex, which would reorder the whole page', () => {
    const target = render();
    const positive = [...target.querySelectorAll('[tabindex]')]
      .filter((el) => Number(el.getAttribute('tabindex')) > 0);
    expect(positive).toEqual([]);
  });

  it('puts no click handler on a element that cannot be focused', () => {
    // A div that responds to a click and nothing else is invisible to a
    // keyboard. Anything clickable should be a button, a link, or carry a
    // role and a tabindex.
    const target = render();
    const offenders = [...target.querySelectorAll('div[onclick], span[onclick]')]
      .filter((el) => !el.hasAttribute('tabindex') && !el.hasAttribute('role'))
      .map((el) => el.outerHTML.slice(0, 70));
    expect(offenders).toEqual([]);
  });
});

describe('post action disclosure', () => {
  it('reveals secondary controls on demand and returns focus after Escape', () => {
    const target = render();
    const toggle = target.querySelector<HTMLButtonElement>('[aria-label="More post actions"]')!;
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click(); flushSync();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const translate = panel.querySelector<HTMLButtonElement>('[aria-label="Translate post"]')!;
    translate.focus();
    translate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it('gives repeated posts distinct disclosures and dismisses an open one when tapping elsewhere', () => {
    const first = render();
    const second = render();
    const toggles = [first, second].map(target => target.querySelector<HTMLButtonElement>('[aria-label="More post actions"]')!);
    expect(toggles[0].getAttribute('aria-controls')).not.toBe(toggles[1].getAttribute('aria-controls'));
    toggles[0].click(); flushSync();
    toggles[1].dispatchEvent(new Event('pointerdown', { bubbles: true })); flushSync();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1].getAttribute('aria-expanded')).toBe('false');
  });
});

describe('feed preview', () => {
  it('offers an explicit expansion when content exceeds its preview', () => {
    const originalObserver = globalThis.ResizeObserver;
    class Observer {
      observe() {} disconnect() {} unobserve() {}
    }
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
    const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const oldClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    try {
      const target = render({ ...basePost, text: 'Long post\n'.repeat(50) } as UnifiedPost, { feedPreview: true });
      const expand = [...target.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Show full post');
      expect(expand).toBeDefined();
      expect(target.querySelector('.feed-preview')).not.toBeNull();
      expand!.click();
      flushSync();
      expect(target.querySelector('.feed-preview')).toBeNull();
      expect(target.textContent).toContain('Show less');
    } finally {
      globalThis.ResizeObserver = originalObserver;
      if (oldScroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', oldScroll);
      if (oldClient) Object.defineProperty(HTMLElement.prototype, 'clientHeight', oldClient);
    }
  });
});
