/**
 * Where CrispDeck's own serverless functions live.
 *
 * Most deployments answer their own /api/* — Vercel, the dev server, and the
 * Tauri build, which talks to the production origin through its own config.
 * GitHub Pages does not: it serves static files only, so Threads sign-in, web
 * push and feed publishing all 404 there. Pointing those calls at the Vercel
 * deployment is what makes the mirror a mirror rather than a subset.
 *
 * The origin is chosen at build time rather than sniffed at runtime. A runtime
 * check ("am I on github.io?") would have to be updated for every new host and
 * is invisible in the build output; a build constant is explicit, greppable,
 * and the Pages workflow sets PUBLIC_API_ORIGIN right next to BASE_PATH.
 */

/** '' means same-origin, which is what every deployment but Pages wants. */
const ORIGIN = (typeof __API_ORIGIN__ === 'string' ? __API_ORIGIN__ : '').replace(/\/$/, '');

/**
 * Absolute URL for one of our own API routes.
 *
 * `path` starts with `/api/`. Returns it unchanged when the current origin
 * serves the functions itself, so nothing changes for Vercel or dev.
 */
export function apiUrl(path: string): string {
  return ORIGIN ? `${ORIGIN}${path}` : path;
}

/** True when API calls cross an origin, so the caller can expect CORS rules. */
export const apiIsCrossOrigin = ORIGIN !== '';

/**
 * The origin serving the API, for messages that need to name it.
 * Empty string when the API is same-origin.
 */
export const apiOrigin = ORIGIN;
