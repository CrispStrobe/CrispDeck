import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';
import { postToBluesky, postToMastodon, postToThreads, postThreadToBluesky, postThreadToMastodon, postThreadToThreads } from './adapter';
const dimensions = vi.hoisted(() => vi.fn());
vi.mock('./image-dimensions', () => ({ readImageDimensions: dimensions }));
vi.mock('$lib/api/atproto-sdk', () => ({
  loadAtprotoSdk: async () => ({ RichText: class {
    text: string; facets = [];
    constructor({ text }: { text: string }) { this.text = text; }
    async detectFacets() {}
  } }),
}));

function photos(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const file = new File(['photo'], `photo-${index}.png`, { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([index]).buffer });
    return file;
  });
}
function bluesky() {
  let sequence = 0;
  const createRecord = vi.fn(async () => ({ data: { uri: `at://did:plc:writer/app.bsky.feed.post/${++sequence}`, cid: `cid${sequence}` } }));
  const uploadBlob = vi.fn(async () => ({ data: { blob: { ref: 'blob', mimeType: 'image/png', size: 5 } } }));
  const agent = { did: 'did:plc:writer', uploadBlob, api: { com: { atproto: { repo: { createRecord } } } } } as unknown as Agent;
  const client = { getAgent: () => agent, uploadVideo: vi.fn() } as unknown as BlueskyClient;
  return { client, agent, createRecord, uploadBlob };
}
function threads() {
  let sequence = 0;
  return {
    createCarouselItemContainer: vi.fn(async () => `item-${++sequence}`),
    createCarouselContainer: vi.fn(async () => 'carousel'), createTextContainer: vi.fn(async () => 'text'),
    createImageContainer: vi.fn(async () => 'image'), createVideoContainer: vi.fn(async () => 'video'),
    waitForContainer: vi.fn(async () => ({})), publishContainer: vi.fn(async (id: string) => ({ id: `posted-${id}` })),
    getPost: vi.fn(async () => ({ permalink: 'https://threads.net/post/example' })),
  };
}
beforeEach(() => { vi.clearAllMocks(); dimensions.mockResolvedValue({ width: 1600, height: 900 }); });
afterEach(() => vi.unstubAllGlobals());

describe('complete media delivery', () => {
  it('uses a gallery for ten images with all descriptions and real aspect ratios', async () => {
    const { client, agent, uploadBlob, createRecord } = bluesky();
    const result = await postToBluesky(client, { text: 'Ten photos', mediaFiles: photos(10), altTexts: Array.from({ length: 10 }, (_, i) => `Photo ${i}`) }, agent);
    expect(result.success).toBe(true);
    expect(uploadBlob).toHaveBeenCalledTimes(10);
    expect(dimensions).toHaveBeenCalledTimes(10);
    const record = (createRecord.mock.calls[0] as any)[0].record;
    expect(record.embed.$type).toBe('app.bsky.embed.gallery');
    expect(record.embed.items).toHaveLength(10);
    expect(record.embed.items[9]).toMatchObject({ $type: 'app.bsky.embed.gallery#image', alt: 'Photo 9', aspectRatio: { width: 1600, height: 900 } });
  });
  it('keeps legacy image embeds for four photos and supports galleries alongside quotes', async () => {
    const first = bluesky();
    await postToBluesky(first.client, { text: 'Four', mediaFiles: photos(4) }, first.agent);
    expect((first.createRecord.mock.calls[0] as any)[0].record.embed.$type).toBe('app.bsky.embed.images');
    expect(dimensions).not.toHaveBeenCalled();
    const second = bluesky();
    await postToBluesky(second.client, { text: 'Quoted gallery', mediaFiles: photos(5), quoteUri: 'at://did:plc:original/app.bsky.feed.post/1', quoteCid: 'original-cid' }, second.agent);
    const embed = (second.createRecord.mock.calls[0] as any)[0].record.embed;
    expect(embed.$type).toBe('app.bsky.embed.recordWithMedia');
    expect(embed.media.items).toHaveLength(5);
    expect(embed.record.record.cid).toBe('original-cid');
  });
  it('fails before uploading if any required gallery dimensions cannot be read', async () => {
    const { client, agent, uploadBlob, createRecord } = bluesky();
    dimensions.mockRejectedValueOnce(new Error('Broken photo'));
    const result = await postToBluesky(client, { text: 'Five photos', mediaFiles: photos(5) }, agent);
    expect(result).toMatchObject({ success: false, error: 'Error: Broken photo' });
    expect(uploadBlob).not.toHaveBeenCalled(); expect(createRecord).not.toHaveBeenCalled();
  });
  it('rejects too many images and mixed video without uploading or silently truncating', async () => {
    const { client, agent, uploadBlob, createRecord } = bluesky();
    expect((await postToBluesky(client, { text: 'Too many', mediaFiles: photos(11) }, agent)).success).toBe(false);
    expect((await postToBluesky(client, { text: 'Mixed', mediaFiles: [...photos(1), new File(['video'], 'v.mp4', { type: 'video/mp4' })] }, agent)).success).toBe(false);
    expect(uploadBlob).not.toHaveBeenCalled(); expect(createRecord).not.toHaveBeenCalled();
    expect(client.uploadVideo).not.toHaveBeenCalled();
  });
  it('rejects a fifth Mastodon attachment in both post and legacy thread entry points', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const client = { getInstanceUrl: () => 'https://social.example', getAccessToken: () => 'test' } as unknown as MastodonClient;
    expect((await postToMastodon(client, { text: 'Photos', mediaFiles: photos(5) })).error).toContain('4 attachments');
    expect((await postThreadToMastodon(client, ['First', 'Second'], { mediaFiles: photos(5) }))).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps all gallery images on the first part of a legacy Bluesky thread', async () => {
    const { client, createRecord, uploadBlob } = bluesky();
    const results = await postThreadToBluesky(client, ['First', 'Second'], { mediaFiles: photos(7) });
    expect(results.every(result => result.success)).toBe(true);
    expect(uploadBlob).toHaveBeenCalledTimes(7);
    const first = (createRecord.mock.calls[0] as any)[0].record;
    const second = (createRecord.mock.calls[1] as any)[0].record;
    expect(first.embed.items).toHaveLength(7); expect(second.embed).toBeUndefined();
    expect(second.reply).toEqual({ root: { uri: results[0].uri, cid: results[0].cid }, parent: { uri: results[0].uri, cid: results[0].cid } });
  });
  it('rejects excess or invalid Threads URLs instead of publishing a shortened carousel', async () => {
    const client = threads();
    const urls = Array.from({ length: 11 }, (_, i) => `https://media.example/${i}.png`);
    expect((await postToThreads(client as unknown as ThreadsClient, { text: 'Many', mediaUrls: urls })).success).toBe(false);
    expect((await postToThreads(client as unknown as ThreadsClient, { text: 'Bad', mediaUrls: ['https://media.example/1.png', 'http://media.example/2.png'] })).success).toBe(false);
    expect(client.createCarouselItemContainer).not.toHaveBeenCalled(); expect(client.publishContainer).not.toHaveBeenCalled();
  });
  it('keeps the original thread root when publishing a multi-part reply', async () => {
    const { client, createRecord } = bluesky();
    const replyTo = { uri: 'at://did:plc:original/app.bsky.feed.post/root', cid: 'original-cid' };
    const results = await postThreadToBluesky(client, ['Reply part one', 'Reply part two'], { replyTo });
    const second = (createRecord.mock.calls[1] as any)[0].record;
    expect(second.reply).toEqual({ root: replyTo, parent: { uri: results[0].uri, cid: results[0].cid } });
  });
  it('keeps Threads media on the first part and then replies to the published container', async () => {
    const client = threads();
    const urls = ['https://media.example/1.png', 'https://media.example/2.mp4?token=public'];
    const results = await postThreadToThreads(client as unknown as ThreadsClient, ['First', 'Second'], { mediaUrls: urls });
    expect(results.every(result => result.success)).toBe(true);
    expect(client.createCarouselItemContainer.mock.calls).toEqual([['IMAGE', urls[0]], ['VIDEO', urls[1]]]);
    expect(client.createTextContainer).toHaveBeenCalledWith('Second', 'posted-carousel');
  });
});
