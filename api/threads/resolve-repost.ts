import { corsFor, preflight, safeError } from '../_lib/cors.js';
/**
 * Vercel serverless function: Resolve Threads repost permalink to original post.
 *
 * REPOST_FACADE posts don't expose reposted_post content via the API.
 * But the permalink redirects (301) to the original post URL.
 * This endpoint follows the redirect and returns the original author + shortcode.
 */
const THREADS_HOSTS = new Set(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com']);
const POST_PATH = /^\/@([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)\/?$/;

/** Only fetch public Threads post permalinks, never a caller-selected server. */
function parsePermalink(value: string, base?: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !THREADS_HOSTS.has(url.hostname) || !POST_PATH.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const permalink = url.searchParams.get('url');

  if (!permalink) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), { status: 400, headers: corsFor(request, 'GET, OPTIONS') });
  }

  const source = parsePermalink(permalink);
  if (!source) {
    return new Response(JSON.stringify({ error: 'Expected an HTTPS Threads post permalink' }), { status: 400, headers: corsFor(request, 'GET, OPTIONS') });
  }

  try {
    // Do not follow redirects: even a trusted host can return an untrusted
    // Location. Validate that destination before exposing it to the client.
    const resp = await fetch(source.href, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const location = resp.headers.get('location');

    const target = location && resp.status >= 300 && resp.status < 400
      ? parsePermalink(location, source.href) : null;
    if (!target) {
      return new Response(JSON.stringify({ resolved: false, original_url: source.href }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
    }

    const match = target.pathname.match(POST_PATH)!;

    return new Response(JSON.stringify({
      resolved: true,
      original_url: target.href,
      original_author: match[1],
      original_shortcode: match[2],
    }), { status: 200, headers: corsFor(request, 'GET, OPTIONS') });
  } catch (e) {
    return new Response(JSON.stringify({ error: safeError('Resolving the repost', e) }), { status: 500, headers: corsFor(request, 'GET, OPTIONS') });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, 'GET, OPTIONS');
}
