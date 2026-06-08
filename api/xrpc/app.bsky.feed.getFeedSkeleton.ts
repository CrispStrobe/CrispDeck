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

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

// Simple in-memory cache: rkey → { query, expiry }
const queryCache = new Map<string, { query: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getQueryForRkey(rkey: string): Promise<string | null> {
  // Check cache first
  const cached = queryCache.get(rkey);
  if (cached && cached.expiry > Date.now()) {
    return cached.query;
  }

  // Look up from Vercel Blob
  try {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Cache feed responses for 60s at the CDN layer
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const feedUri = req.query.feed as string;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const cursor = req.query.cursor as string | undefined;

  if (!feedUri) {
    return res.status(400).json({ error: 'Missing feed parameter' });
  }

  // Parse AT URI: at://<did>/app.bsky.feed.generator/<rkey>
  const match = feedUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.generator\/(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid feed URI' });
  }

  const rkey = match[2];

  // Look up the feed query from Vercel Blob
  const query = await getQueryForRkey(rkey);
  if (!query) {
    return res.status(404).json({ error: 'Feed not found', rkey });
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
      return res.status(502).json({ error: `Bluesky API error: ${resp.status}`, detail: text });
    }

    const data = await resp.json();

    // Return feed skeleton (just post URIs)
    const feed = (data.posts ?? []).map((p: any) => ({ post: p.uri }));

    return res.status(200).json({
      feed,
      cursor: data.cursor,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Feed generation failed', detail: String(e) });
  }
}
