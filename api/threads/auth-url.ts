/**
 * Vercel serverless function: Generate Threads OAuth authorization URL.
 *
 * Returns the authorization URL with the server-side client_id so the
 * client never needs to know the Meta App credentials.
 *
 * Env vars required on Vercel:
 *   THREADS_CLIENT_ID — Meta App ID
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.THREADS_CLIENT_ID;

  if (!clientId) {
    return res.status(503).json({
      error: 'Threads API not configured. Set THREADS_CLIENT_ID in Vercel environment variables.',
      configured: false,
    });
  }

  const redirectUri = req.query.redirect_uri as string;
  const state = req.query.state as string;

  if (!redirectUri || !state) {
    return res.status(400).json({ error: 'Missing redirect_uri or state' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_insights',
    response_type: 'code',
    state,
  });

  return res.status(200).json({
    auth_url: `${THREADS_AUTH_URL}?${params.toString()}`,
    configured: true,
  });
}
