import { readJsonObject } from './request.js';

export function isFeedRkey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:~-]{1,512}$/.test(value) && value !== '.' && value !== '..';
}

/** Record keys are unique within one account, never globally. */
export function feedPath(userDid: string, rkey: string): string {
  return `feeds/${encodeURIComponent(userDid)}/${rkey}.json`;
}

export async function readFeedDefinition(pathname: string): Promise<Record<string, unknown> | null> {
  const { get } = await import('@vercel/blob');
  const blob = await get(pathname, { access: 'public', abortSignal: AbortSignal.timeout(5_000) });
  if (!blob || blob.statusCode !== 200) return null;
  return readJsonObject(new Response(blob.stream));
}

/** Preserve existing feeds, but never borrow a different owner's legacy rkey. */
export async function readOwnedFeed(userDid: string, rkey: string): Promise<Record<string, unknown> | null> {
  const feed = await readFeedDefinition(feedPath(userDid, rkey)) ??
    await readFeedDefinition(`feeds/${rkey}.json`);
  if (feed?.userDid !== userDid || feed.rkey !== rkey) return null;
  return feed;
}
