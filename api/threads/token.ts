/**
 * Vercel serverless function: Threads OAuth token exchange.
 *
 * Proxies the authorization code → access token exchange so the
 * client_secret never leaves the server. Users just click
 * "Connect Threads" — no Meta Developer account needed.
 *
 * Env vars required on Vercel:
 *   THREADS_CLIENT_ID     — Meta App ID
 *   THREADS_CLIENT_SECRET — Meta App Secret
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json({
      error: 'Threads API not configured. Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET in Vercel environment variables.',
    });
  }

  const { code, redirect_uri, action } = req.body ?? {};

  try {
    // Action: exchange code for short-lived token, then immediately get long-lived token
    if (action === 'exchange' || !action) {
      if (!code || !redirect_uri) {
        return res.status(400).json({ error: 'Missing code or redirect_uri' });
      }

      // Step 1: Exchange code for short-lived token
      const tokenResp = await fetch(THREADS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          redirect_uri,
          code,
        }),
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({}));
        return res.status(tokenResp.status).json({
          error: err.error_message || `Token exchange failed: ${tokenResp.statusText}`,
        });
      }

      const shortLived = await tokenResp.json();

      // Step 2: Immediately exchange for long-lived token (58 days)
      const longLivedResp = await fetch(
        `${THREADS_API_BASE}/access_token?` +
        new URLSearchParams({
          grant_type: 'th_exchange_token',
          client_secret: clientSecret,
          access_token: shortLived.access_token,
        }),
      );

      if (!longLivedResp.ok) {
        // Return short-lived token if long-lived exchange fails
        return res.status(200).json({
          access_token: shortLived.access_token,
          token_type: 'bearer',
          user_id: shortLived.user_id,
          long_lived: false,
        });
      }

      const longLived = await longLivedResp.json();

      return res.status(200).json({
        access_token: longLived.access_token,
        token_type: 'bearer',
        expires_in: longLived.expires_in,
        user_id: shortLived.user_id,
        long_lived: true,
      });
    }

    // Action: refresh a long-lived token
    if (action === 'refresh') {
      const { access_token } = req.body ?? {};
      if (!access_token) {
        return res.status(400).json({ error: 'Missing access_token' });
      }

      const refreshResp = await fetch(
        `${THREADS_API_BASE}/access_token?` +
        new URLSearchParams({
          grant_type: 'th_refresh_token',
          access_token,
        }),
      );

      if (!refreshResp.ok) {
        const err = await refreshResp.json().catch(() => ({}));
        return res.status(refreshResp.status).json({
          error: err.error_message || `Token refresh failed: ${refreshResp.statusText}`,
        });
      }

      const refreshed = await refreshResp.json();
      return res.status(200).json({
        access_token: refreshed.access_token,
        token_type: 'bearer',
        expires_in: refreshed.expires_in,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
