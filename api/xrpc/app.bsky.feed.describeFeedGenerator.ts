/**
 * Vercel serverless function: Bluesky Feed Generator — describeFeedGenerator
 *
 * Returns metadata about this feed generator service.
 * Called by the Bluesky AppView to verify the generator is valid.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const GENERATOR_DID = 'did:web:crispdeck.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    did: GENERATOR_DID,
    feeds: [],
  });
}
