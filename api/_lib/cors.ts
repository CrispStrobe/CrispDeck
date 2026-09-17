/**
 * Which origins may call CrispDeck's own API.
 *
 * These endpoints were returning `Access-Control-Allow-Origin: *`. That was
 * not exploitable for token theft — the Threads client secret never leaves the
 * server, and Meta binds an authorization code to a redirect_uri registered
 * against our app, so a code obtained elsewhere is useless here. But a
 * wildcard lets any page on the web spend our rate limit and our Vercel
 * invocations, and there is no reason to offer that.
 *
 * The allowlist exists because the GitHub Pages mirror is a genuine second
 * origin: Pages serves static files only, so its Threads sign-in, web push and
 * feed publishing have to call these functions cross-origin or not work at all.
 *
 * ALLOWED_ORIGINS (comma-separated) extends the list without a deploy.
 */

const DEFAULT_ALLOWED = [
  'https://crispdeck.vercel.app',
  'https://crispstrobe.github.io',
  // Tauri's webview origins. It normally talks to the production origin
  // directly, but the desktop build can present either of these.
  'tauri://localhost',
  'http://tauri.localhost',
];

/** Localhost on any port, for the dev server. */
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowed(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [...DEFAULT_ALLOWED, ...extra];
}

/**
 * CORS headers for a request, echoing the Origin only when it is allowed.
 *
 * A request with no Origin header is not a browser cross-origin call — curl,
 * a server, the feed generator being polled by Bluesky — and needs no ACAO at
 * all. A disallowed Origin gets no ACAO either, which is what makes the
 * browser refuse it.
 */
export function corsFor(request: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    // The response differs per Origin, so a shared cache must not serve one
    // origin's response to another.
    Vary: 'Origin',
  };
  const origin = request.headers.get('origin');
  if (origin && (allowed().includes(origin.replace(/\/$/, '')) || LOCALHOST.test(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** Answer a CORS preflight. */
export function preflight(request: Request, methods = 'POST, OPTIONS'): Response {
  return new Response(null, { status: 204, headers: corsFor(request, methods) });
}
