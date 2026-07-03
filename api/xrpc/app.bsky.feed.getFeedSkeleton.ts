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

// Simple in-memory cache: rkey → { query, expiry }
const queryCache = new Map<string, { query: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getQueryForRkey(rkey: string): Promise<string | null> {
  const cached = queryCache.get(rkey);
  if (cached && cached.expiry > Date.now()) {
    return cached.query;
  }

  try {
    const { list } = await import('@vercel/blob');
    const blobs = await list({ prefix: `feeds/${rkey}.json` });
    if (blobs.blobs.length === 0) return null;

    const resp = await fetch(blobs.blobs[0].url);
    if (!resp.ok) return null;

    const feedDef = await resp.json();
    const query = feedDef.query;

    if (query) {
      queryCache.set(rkey, { query, expiry: Date.now() + CACHE_TTL });
    }

    return query || null;
  } catch {
    return null;
  }
}

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
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
  const cursor = url.searchParams.get('cursor');

  if (!feedUri) {
    return new Response(JSON.stringify({ error: 'Missing feed parameter' }), { status: 400, headers: corsHeaders });
  }

  const match = feedUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.generator\/(.+)$/);
  if (!match) {
    return new Response(JSON.stringify({ error: 'Invalid feed URI' }), { status: 400, headers: corsHeaders });
  }

  const rkey = match[2];
  const query = await getQueryForRkey(rkey);
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
      `${BSKY_PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`
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
    return new Response(JSON.stringify({ error: 'Feed generation failed', detail: String(e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
