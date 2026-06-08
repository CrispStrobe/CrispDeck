/**
 * Vercel serverless function: Store a feed definition in Vercel Blob.
 *
 * Called by the CrispDeck client when publishing a feed to the Bluesky network.
 * The client also creates the app.bsky.feed.generator record on the user's PDS.
 *
 * POST body: { rkey, query, name, description, userDid }
 *
 * Env vars required: BLOB_READ_WRITE_TOKEN (auto-set by Vercel Blob)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rkey, query, name, description, userDid } = req.body ?? {};

  if (!rkey || !query || !userDid) {
    return res.status(400).json({ error: 'Missing required fields: rkey, query, userDid' });
  }

  try {
    const feedDef = {
      rkey,
      query,
      name: name || 'CrispDeck Feed',
      description: description || '',
      userDid,
      createdAt: new Date().toISOString(),
    };

    // Store in Vercel Blob under feeds/<rkey>.json
    const blob = await put(`feeds/${rkey}.json`, JSON.stringify(feedDef), {
      contentType: 'application/json',
      access: 'public',
      addRandomSuffix: false,
    });

    return res.status(200).json({ ok: true, url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to store feed definition', detail: String(e) });
  }
}
