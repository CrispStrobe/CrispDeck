import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { UnifiedPost } from '$lib/types';
import { getBskyImages } from './post-embeds';
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: vi.fn(), removeBookmark: vi.fn() }));
import Post from './Post.svelte';
const gallery = {
  $type: 'app.bsky.embed.gallery#view',
  items: Array.from({ length: 10 }, (_, i) => ({
    $type: 'app.bsky.embed.gallery#viewImage', thumbnail: `https://media.example/thumb-${i}.png`,
    fullsize: `https://media.example/full-${i}.png`, alt: `Photo ${i}`, aspectRatio: { width: 1600, height: 900 },
  })),
};
const post: UnifiedPost = { uri: 'at://did:plc:a/app.bsky.feed.post/1', text: 'Photo story', createdAt: '2026-01-01T00:00:00Z', platform: 'bluesky', author: { handle: 'photos.example' }, isRepost: false };
let app: ReturnType<typeof mount> | undefined;
afterEach(() => { if (app) unmount(app); app = undefined; document.body.innerHTML = ''; });
function render(embeds: unknown) {
  const target = document.createElement('div'); document.body.append(target);
  app = mount(Post, { target, props: { post: { ...post, embeds } } }); flushSync(); return target;
}

describe('Bluesky gallery views', () => {
  it('normalizes direct galleries and galleries attached to quote posts', () => {
    expect(getBskyImages(gallery)).toHaveLength(10);
    expect(getBskyImages({ $type: 'app.bsky.embed.recordWithMedia#view', media: gallery })).toEqual(getBskyImages(gallery));
    expect(getBskyImages(gallery)[9]).toMatchObject({ thumb: 'https://media.example/thumb-9.png', alt: 'Photo 9', aspectRatio: { width: 1600, height: 900 } });
    expect(getBskyImages({ $type: 'app.bsky.embed.gallery#view', items: [null, { $type: 'future-media' }] })).toEqual([]);
  });
  it('renders every gallery image and opens the selected full-size item', () => {
    const target = render(gallery);
    expect(target.querySelectorAll('img[src^="https://media.example/thumb-"]')).toHaveLength(10);
    target.querySelector<HTMLImageElement>('img[alt="Photo 9"]')!.closest('button')!.click(); flushSync();
    expect(document.querySelector('[role=dialog] img')?.getAttribute('src')).toBe('https://media.example/full-9.png');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('10');
  });
  it('opens all ten images from the preview of a quoted gallery', () => {
    const target = render({ $type: 'app.bsky.embed.record#view', record: {
      $type: 'app.bsky.embed.record#viewRecord', uri: 'at://did:plc:q/app.bsky.feed.post/2', author: { handle: 'quoted.example' }, value: { text: 'Quoted gallery' }, embeds: [gallery],
    } });
    target.querySelector<HTMLElement>('[aria-label="View quoted post images"]')!.click(); flushSync();
    expect(document.querySelector('[role=dialog] img')?.getAttribute('src')).toBe('https://media.example/full-0.png');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('10');
  });
});
