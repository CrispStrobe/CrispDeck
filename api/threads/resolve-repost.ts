/**
 * Vercel serverless function: Resolve Threads repost permalink to original post.
 *
 * REPOST_FACADE posts don't expose reposted_post content via the API.
 * But the permalink redirects (301) to the original post URL.
 * This endpoint follows the redirect and returns the original author + shortcode.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const permalink = url.searchParams.get('url');

  if (!permalink) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), { status: 400, headers: corsHeaders });
  }

  try {
    const resp = await fetch(permalink, { method: 'HEAD', redirect: 'manual' });
    const location = resp.headers.get('location');

    if (!location) {
      return new Response(JSON.stringify({ resolved: false, original_url: permalink }), { status: 200, headers: corsHeaders });
    }

    const match = location.match(/threads\.com\/@([^/]+)\/post\/([^/?#]+)/);
    if (!match) {
      return new Response(JSON.stringify({ resolved: false, original_url: location }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      resolved: true,
      original_url: location,
      original_author: match[1],
      original_shortcode: match[2],
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
