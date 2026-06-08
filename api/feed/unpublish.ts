/**
 * Vercel serverless function: Remove a feed definition from Vercel Blob.
 *
 * Called by the CrispDeck client when unpublishing a feed.
 *
 * POST body: { rkey }
 *
 * Env vars required: BLOB_READ_WRITE_TOKEN (auto-set by Vercel Blob)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del, list } from '@vercel/blob';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rkey } = req.body ?? {};

  if (!rkey) {
    return res.status(400).json({ error: 'Missing required field: rkey' });
  }

  try {
    // Find and delete the blob
    const blobs = await list({ prefix: `feeds/${rkey}.json` });
    for (const blob of blobs.blobs) {
      await del(blob.url);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete feed definition', detail: String(e) });
  }
}
