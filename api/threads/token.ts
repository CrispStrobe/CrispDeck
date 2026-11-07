import { corsFor, preflight, isAllowedRedirect, safeError } from '../_lib/cors.js';
import { HttpError, readJsonObject } from '../_lib/request.js';
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
const THREADS_REFRESH_URL = 'https://graph.threads.net/refresh_access_token';

function tokenHeaders(request: Request): Record<string, string> {
  return { ...corsFor(request, 'POST, OPTIONS'), 'Cache-Control': 'no-store', Pragma: 'no-cache' };
}

function hasToken(value: unknown): value is { access_token: string; expires_in?: number } {
  return !!value && typeof value === 'object' && typeof (value as { access_token?: unknown }).access_token === 'string' &&
    (value as { access_token: string }).access_token.length > 0;
}

export async function POST(request: Request) {
  const clientId = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({
      error: 'Threads API not configured. Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET in Vercel environment variables.',
    }), { status: 503, headers: tokenHeaders(request) });
  }

  try {
    const { code, redirect_uri, action = 'exchange', access_token } = await readJsonObject(request);
    // Action: exchange code for short-lived token, then immediately get long-lived token
    if (action === 'exchange') {
      if (typeof code !== 'string' || !code || code.length > 8192 || typeof redirect_uri !== 'string' || !redirect_uri || redirect_uri.length > 2048) {
        throw new HttpError(400, 'Invalid code or redirect_uri');
      }

      // The code is spent against this URI with our client_secret. Same
      // reasoning as auth-url: do not take a stranger's word for where the
      // callback lives.
      if (!isAllowedRedirect(redirect_uri)) {
        throw new HttpError(400, 'redirect_uri is not one of ours');
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
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenResp.ok) {
        await tokenResp.body?.cancel();
        return new Response(JSON.stringify({
          error: `Threads token exchange failed (HTTP ${tokenResp.status})`,
        }), { status: tokenResp.status, headers: tokenHeaders(request) });
      }

      // Parse response as text first to preserve large user_id precision
      const shortLivedText = await tokenResp.text();
      const shortLived = JSON.parse(shortLivedText);
      const userIdMatch = shortLivedText.match(/"user_id"\s*:\s*(\d+)(?=\s*[,}])/);
      const safeUserId = userIdMatch ? userIdMatch[1] : shortLived?.user_id;
      if (!hasToken(shortLived) || typeof safeUserId !== 'string' || !/^\d+$/.test(safeUserId)) {
        throw new HttpError(502, 'Threads returned an invalid token response');
      }

      // The authorization code has been consumed. An optional upgrade failure
      // must not discard the valid short-lived token and force another sign-in.
      try {
        const longLivedResp = await fetch(
          `${THREADS_API_BASE}/access_token?` +
          new URLSearchParams({
            grant_type: 'th_exchange_token',
            client_secret: clientSecret,
            access_token: shortLived.access_token,
          }),
          { redirect: 'error', signal: AbortSignal.timeout(10_000) },
        );
        if (longLivedResp.ok) {
          const longLived = await longLivedResp.json();
          if (hasToken(longLived) && typeof longLived.expires_in === 'number' && Number.isSafeInteger(longLived.expires_in) && longLived.expires_in > 0) {
            return new Response(JSON.stringify({
              access_token: longLived.access_token,
              token_type: 'bearer',
              expires_in: longLived.expires_in,
              user_id: safeUserId,
              long_lived: true,
            }), { status: 200, headers: tokenHeaders(request) });
          }
        } else {
          await longLivedResp.body?.cancel();
        }
      } catch {
        // Fetch errors can include the URL containing client_secret/token.
        // The fallback response is sufficient; never log those credentials.
      }
      return new Response(JSON.stringify({
        access_token: shortLived.access_token,
        token_type: 'bearer',
        expires_in: 3600,
        user_id: safeUserId,
        long_lived: false,
      }), { status: 200, headers: tokenHeaders(request) });
    }

    // Action: refresh a long-lived token
    if (action === 'refresh') {
      if (typeof access_token !== 'string' || !access_token || access_token.length > 8192) {
        throw new HttpError(400, 'Invalid access_token');
      }

      const refreshResp = await fetch(
        `${THREADS_REFRESH_URL}?` +
        new URLSearchParams({
          grant_type: 'th_refresh_token',
          access_token,
        }),
        { redirect: 'error', signal: AbortSignal.timeout(10_000) },
      );

      if (!refreshResp.ok) {
        await refreshResp.body?.cancel();
        return new Response(JSON.stringify({
          error: `Threads token refresh failed (HTTP ${refreshResp.status})`,
        }), { status: refreshResp.status, headers: tokenHeaders(request) });
      }

      const refreshed = await refreshResp.json();
      if (!hasToken(refreshed) || typeof refreshed.expires_in !== 'number' || !Number.isSafeInteger(refreshed.expires_in) || refreshed.expires_in <= 0) {
        throw new HttpError(502, 'Threads returned an invalid token response');
      }
      return new Response(JSON.stringify({
        access_token: refreshed.access_token,
        token_type: 'bearer',
        expires_in: refreshed.expires_in,
      }), { status: 200, headers: tokenHeaders(request) });
    }

    throw new HttpError(400, 'Unknown token action');
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: tokenHeaders(request) });
    // An upstream exception can contain a URL with account or app secrets.
    return new Response(JSON.stringify({ error: safeError('Threads token exchange', { name: e instanceof Error ? e.name : 'UnknownError' }) }), { status: 502, headers: tokenHeaders(request) });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, 'POST, OPTIONS');
}
