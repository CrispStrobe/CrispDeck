import { safeError } from '../_lib/cors.js';
import { isAccountDid } from '../_lib/feed-auth.js';
import { isFeedRkey, readOwnedFeed } from '../_lib/feed-storage.js';
/**
 * Vercel serverless function: Bluesky Feed Generator — getFeedSkeleton
 *
 * Implements the AT Protocol feed generator endpoint.
 * Looks up the feed definition from Vercel Blob by rkey,
 * executes the stored search query, and returns post URIs.
 *
 * Query params:
 *   feed   — AT URI: at://<did>/app.bsky.feed.generator/<rkey>
 *   limit  — max posts to return (default 30, max 100)
 *   cursor — pagination cursor from previous response
 */

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

// Full feed URI → { query, expiry }. A record key alone is not an identity.
const queryCache = new Map<string, { query: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_LIMIT = 256;

async function getQueryForFeed(userDid: string, rkey: string): Promise<string | null> {
  const key = `${userDid}/${rkey}`;
  const cached = queryCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.query;
  }

  try {
    const feedDef = await readOwnedFeed(userDid, rkey);
    const query = feedDef?.query;
    if (typeof query !== 'string' || !query.trim() || query.length > 8192) return null;
    queryCache.delete(key);
    if (queryCache.size >= CACHE_LIMIT) queryCache.delete(queryCache.keys().next().value!);
    queryCache.set(key, { query, expiry: Date.now() + CACHE_TTL });
    return query;
  } catch {
    return null;
  }
}

/**
 * Deliberately wildcard CORS: this endpoint is not called by our app. It is
 * part of the AT Protocol feed generator contract and is fetched by Bluesky's
 * own infrastructure and by any client resolving the feed, none of which are
 * on an origin we could enumerate. Restricting it to an allowlist would break
 * the feed for everyone but us.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const feedUri = url.searchParams.get('feed');
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 30;
  const cursor = url.searchParams.get('cursor');

  if (!feedUri) {
    return new Response(JSON.stringify({ error: 'Missing feed parameter' }), { status: 400, headers: corsHeaders });
  }

  const match = feedUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.generator\/(.+)$/);
  if (!match || !isAccountDid(match[1]) || !isFeedRkey(match[2])) {
    return new Response(JSON.stringify({ error: 'Invalid feed URI' }), { status: 400, headers: corsHeaders });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor && cursor.length > 2048)) {
    return new Response(JSON.stringify({ error: 'Invalid limit or cursor' }), { status: 400, headers: corsHeaders });
  }

  const rkey = match[2];
  const query = await getQueryForFeed(match[1], rkey);
  if (!query) {
    return new Response(JSON.stringify({ error: 'Feed not found', rkey }), { status: 404, headers: corsHeaders });
  }

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    if (cursor) params.set('cursor', cursor);

    const resp = await fetch(
      `${BSKY_PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`,
      { redirect: 'error', signal: AbortSignal.timeout(10_000) },
    );

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: `Bluesky API error: ${resp.status}`, detail: text }), { status: 502, headers: corsHeaders });
    }

    const data = await resp.json();
    const feed = (data.posts ?? []).map((p: any) => ({ post: p.uri }));

    return new Response(JSON.stringify({
      feed,
      cursor: data.cursor,
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: safeError('Feed generation', e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
