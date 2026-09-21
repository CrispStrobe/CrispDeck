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
 *
 * Importers must write `from '../_lib/cors.js'`, with the extension, even
 * though this file is .ts. These functions run as Node ESM, where a bare
 * specifier without an extension does not resolve, and the failure surfaces
 * only in production as FUNCTION_INVOCATION_FAILED — the TypeScript check
 * passes either way, because moduleResolution is "bundler".
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
  if (origin && allowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * May an OAuth redirect_uri point here?
 *
 * `auth-url` builds a Threads authorization URL with *our* client_id and
 * whatever redirect_uri the caller supplies, and `token` spends a code against
 * whatever redirect_uri it is given. Nothing checked either. That left the
 * question of whether a stranger could aim our app at their own callback
 * entirely to Meta's registered-URI list — a control in someone else's
 * console, which this repo cannot see, test, or notice changing.
 *
 * The origin has to be one we would talk to anyway, so the same allowlist
 * answers both questions.
 */
export function isAllowedRedirect(redirectUri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  // The allowlist is the whole test, with no scheme rule layered on top. An
  // earlier version here required https, which would have rejected
  // `tauri://localhost` — the origin the desktop webview presents, and one the
  // allowlist already trusts. A rule that duplicates the allowlist only gets a
  // chance to disagree with it.
  //
  // `tauri://localhost` has no origin as far as the URL spec is concerned —
  // only "special" schemes (http, https, ws, ftp, file) get one, and
  // everything else parses to the string "null". The allowlist stores it the
  // way a browser sends it in an Origin header, so rebuild that shape from
  // the protocol and host when the parser declines to.
  //
  // javascript: and data: come through here as "javascript://" and "data://",
  // which are in no allowlist and so are refused by the same check.
  const originish =
    parsed.origin !== 'null' ? parsed.origin : `${parsed.protocol}//${parsed.host}`;
  return allowedOrigin(originish);
}

/** Is this exact origin one we deal with? Shared by CORS and the redirect check. */
function allowedOrigin(origin: string): boolean {
  const normalised = origin.replace(/\/$/, '');
  return allowed().includes(normalised) || LOCALHOST.test(normalised);
}

/**
 * What to tell a client when something threw.
 *
 * Five endpoints answered with `String(e)`. An exception's text is written for
 * whoever is reading the logs, not for the caller: it carries whatever the
 * runtime felt like including, and the Threads long-lived-token exchange puts
 * the client secret in a query string, so the URL appearing in an error is a
 * secret appearing in a response body. The detail belongs in the log.
 */
export function safeError(context: string, e: unknown): string {
  console.error(`[${context}]`, e);
  return `${context} failed. If this persists, check the server logs.`;
}

/** Answer a CORS preflight. */
export function preflight(request: Request, methods = 'POST, OPTIONS'): Response {
  return new Response(null, { status: 204, headers: corsFor(request, methods) });
}
