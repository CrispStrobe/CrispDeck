/**
 * Vercel serverless function: Threads OAuth token exchange.
 *
 * Proxies the authorization code → access token exchange so the
 * client_secret never leaves the server.
 *
 * Env vars required on Vercel:
 *   THREADS_CLIENT_ID     — Meta App ID
 *   THREADS_CLIENT_SECRET — Meta App Secret
 */

const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function POST(request: Request) {
  const clientId = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({
      error: 'Threads API not configured. Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET in Vercel environment variables.',
    }), { status: 503, headers: corsHeaders });
  }

  const body = await request.json();
  const { code, redirect_uri, action, access_token } = body ?? {};

  try {
    // Action: exchange code for short-lived token, then immediately get long-lived token
    if (action === 'exchange' || !action) {
      if (!code || !redirect_uri) {
        return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), { status: 400, headers: corsHeaders });
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
        return new Response(JSON.stringify({
          error: err.error_message || `Token exchange failed: ${tokenResp.statusText}`,
        }), { status: tokenResp.status, headers: corsHeaders });
      }

      // Parse response as text first to preserve large user_id precision
      const shortLivedText = await tokenResp.text();
      const shortLived = JSON.parse(shortLivedText);
      const userIdMatch = shortLivedText.match(/"user_id"\s*:\s*(\d+)/);
      const safeUserId = userIdMatch ? userIdMatch[1] : String(shortLived.user_id);

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
        return new Response(JSON.stringify({
          access_token: shortLived.access_token,
          token_type: 'bearer',
          user_id: safeUserId,
          long_lived: false,
        }), { status: 200, headers: corsHeaders });
      }

      const longLived = await longLivedResp.json();

      return new Response(JSON.stringify({
        access_token: longLived.access_token,
        token_type: 'bearer',
        expires_in: longLived.expires_in,
        user_id: safeUserId,
        long_lived: true,
      }), { status: 200, headers: corsHeaders });
    }

    // Action: refresh a long-lived token
    if (action === 'refresh') {
      if (!access_token) {
        return new Response(JSON.stringify({ error: 'Missing access_token' }), { status: 400, headers: corsHeaders });
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
        return new Response(JSON.stringify({
          error: err.error_message || `Token refresh failed: ${refreshResp.statusText}`,
        }), { status: refreshResp.status, headers: corsHeaders });
      }

      const refreshed = await refreshResp.json();
      return new Response(JSON.stringify({
        access_token: refreshed.access_token,
        token_type: 'bearer',
        expires_in: refreshed.expires_in,
      }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
