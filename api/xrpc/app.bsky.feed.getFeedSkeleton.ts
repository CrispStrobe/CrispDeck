/**
 * Vercel serverless function: Bluesky Feed Generator — getFeedSkeleton
 *
 * Implements the AT Protocol feed generator endpoint.
 * Feed queries are encoded as base64url in the record rkey,
 * so no server-side storage is needed.
 *
 * Called by the Bluesky AppView when a user subscribes to a CrispDeck-published feed.
 *
 * Query params:
 *   feed   — AT URI: at://<did>/app.bsky.feed.generator/<rkey>
 *   limit  — max posts to return (default 30, max 100)
 *   cursor — pagination cursor from previous response
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

/** Decode base64url to UTF-8 string */
function b64urlDecode(s: string): string {
  // Convert base64url to standard base64
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // Pad if needed
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

  // Decode the search query from the rkey
  let query: string;
  try {
    query = b64urlDecode(rkey);
  } catch {
    return res.status(400).json({ error: 'Invalid feed rkey — could not decode query' });
  }

  if (!query.trim()) {
    return res.status(400).json({ error: 'Empty feed query' });
  }

  try {
    // Execute the search on the public Bluesky API
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

    // Return feed skeleton (just post URIs, not full posts)
    const feed = (data.posts ?? []).map((p: any) => ({ post: p.uri }));

    return res.status(200).json({
      feed,
      cursor: data.cursor,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Feed generation failed', detail: String(e) });
  }
}
