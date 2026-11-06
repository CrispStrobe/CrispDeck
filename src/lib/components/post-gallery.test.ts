import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { UnifiedPost } from '$lib/types';
import { getBskyImages } from './post-embeds';
const navigation = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: navigation.goto }));
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: vi.fn(), removeBookmark: vi.fn() }));
import Post from './Post.svelte';
const gallery = {
  $type: 'app.bsky.embed.gallery#view',
  items: Array.from({ length: 10 }, (_, i) => ({
    $type: 'app.bsky.embed.gallery#viewImage', thumbnail: `https://media.example/thumb-${i}.png`,
    fullsize: `https://media.example/full-${i}.png`, alt: `Photo ${i}`, aspectRatio: { width: 1600, height: 900 },
  })),
};
const post: UnifiedPost = { uri: 'at://did:plc:a/app.bsky.feed.post/1', text: 'Photo story', createdAt: '2026-01-01T00:00:00Z', platform: 'bluesky', sourceAccountId: 2, author: { handle: 'photos.example' }, isRepost: false };
let app: ReturnType<typeof mount> | undefined;
afterEach(() => { if (app) unmount(app); app = undefined; document.body.innerHTML = ''; vi.clearAllMocks(); });
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
    expect(target.querySelectorAll('.media-strip .media-tile')).toHaveLength(10);
    target.querySelector<HTMLImageElement>('img[alt="Photo 9"]')!.closest('button')!.click(); flushSync();
    expect(document.body.querySelector('[role=dialog]')?.parentElement).toBe(document.body);
    expect(document.body.querySelector('[role=dialog] img')?.getAttribute('src')).toBe('https://media.example/full-9.png');
    expect(document.body.querySelector('[role=dialog]')?.textContent).toContain('10');
  });
  it.each(['split', 'inline'])('keeps the source account and all ten quoted gallery images in the %s layout', layout => {
    const quote = { $type: 'app.bsky.embed.record#view', record: {
      $type: 'app.bsky.embed.record#viewRecord', uri: 'at://did:plc:q/app.bsky.feed.post/2', author: { handle: 'quoted.example' }, value: { text: 'Quoted gallery' }, embeds: [gallery],
    } };
    const embed = layout === 'split' ? quote : { $type: 'app.bsky.embed.recordWithMedia#view', record: quote,
      media: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.com/story', title: 'Related story' } } };
    const target = render(embed);
    const quoteButton = [...target.querySelectorAll('button')].find(button => button.textContent?.includes('Quoted gallery'))!;
    expect(quoteButton.classList.contains('quote-copy')).toBe(layout === 'split');
    quoteButton.click(); flushSync();
    expect(navigation.goto).toHaveBeenCalledWith('/thread?uri=at%3A%2F%2Fdid%3Aplc%3Aq%2Fapp.bsky.feed.post%2F2&platform=bluesky&account=2');
    target.querySelector<HTMLElement>('[aria-label="View quoted post images"]')!.click(); flushSync();
    expect(document.body.querySelector('[role=dialog] img')?.getAttribute('src')).toBe('https://media.example/full-0.png');
    expect(document.body.querySelector('[role=dialog]')?.textContent).toContain('10');
    expect(navigation.goto).toHaveBeenCalledTimes(1);
  });
});
