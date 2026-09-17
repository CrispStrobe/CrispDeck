import { corsFor, preflight } from '../_lib/cors';
/**
 * Vercel serverless function: Resolve Threads repost permalink to original post.
 *
 * REPOST_FACADE posts don't expose reposted_post content via the API.
 * But the permalink redirects (301) to the original post URL.
 * This endpoint follows the redirect and returns the original author + shortcode.
 */


export async function GET(request: Request) {
  const url = new URL(request.url);
  const permalink = url.searchParams.get('url');

  if (!permalink) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), { status: 400, headers: corsFor(request, 'GET, OPTIONS') });
  }

  try {
    const resp = await fetch(permalink, { method: 'HEAD', redirect: 'manual' });
    const location = resp.headers.get('location');

    if (!location) {
      return new Response(JSON.stringify({ resolved: false, original_url: permalink }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
    }

    const match = location.match(/threads\.com\/@([^/]+)\/post\/([^/?#]+)/);
    if (!match) {
      return new Response(JSON.stringify({ resolved: false, original_url: location }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
    }

    return new Response(JSON.stringify({
      resolved: true,
      original_url: location,
      original_author: match[1],
      original_shortcode: match[2],
    }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsFor(request, 'GET, OPTIONS') });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, 'GET, OPTIONS');
}
