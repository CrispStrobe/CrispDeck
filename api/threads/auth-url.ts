import { corsFor, preflight } from '../_lib/cors';
/**
 * Vercel serverless function: Generate Threads OAuth authorization URL.
 *
 * Returns the authorization URL with the server-side client_id so the
 * client never needs to know the Meta App credentials.
 *
 * Env vars required on Vercel:
 *   THREADS_CLIENT_ID — Meta App ID
 */

const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';


export async function GET(request: Request) {
  const clientId = process.env.THREADS_CLIENT_ID;

  if (!clientId) {
    return new Response(JSON.stringify({
      error: 'Threads API not configured. Set THREADS_CLIENT_ID in Vercel environment variables.',
      configured: false,
    }), { status: 503, headers: corsFor(request, 'GET, OPTIONS') });
  }

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');

  if (!redirectUri || !state) {
    return new Response(JSON.stringify({ error: 'Missing redirect_uri or state' }), { status: 400, headers: corsFor(request, 'GET, OPTIONS') });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_insights,threads_keyword_search,threads_manage_mentions,threads_profile_discovery',
    response_type: 'code',
    state,
  });

  return new Response(JSON.stringify({
    auth_url: `${THREADS_AUTH_URL}?${params.toString()}`,
    configured: true,
  }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
}

export function OPTIONS(request: Request) {
  return preflight(request, 'GET, OPTIONS');
}
