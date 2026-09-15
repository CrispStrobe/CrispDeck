/**
 * Canonical route paths, independent of where the app is mounted.
 *
 * The Vercel deployment is served at the root of its origin; a GitHub Pages
 * project site is served under `/<repo>/`. Links handle that by prefixing
 * `base` from `$app/paths`, which is '' in the first case.
 *
 * Comparisons need the inverse. `page.url.pathname` on a Pages deployment is
 * `/CrispDeck/feed`, so anything that asks "which nav item is active?" or
 * "is this route hidden in simple mode?" has to strip the mount point back off
 * first — otherwise every comparison silently fails and the sidebar highlights
 * nothing. Route ids also persist in localStorage (hidden nav items), so they
 * must stay stable regardless of where the app happens to be served from.
 */

import { base } from '$app/paths';

/**
 * The route part of a pathname, with the app's mount point removed.
 * Always starts with '/'. Identity when the app is mounted at the root.
 */
export function routePath(pathname: string, mount: string = base): string {
  if (!mount) return pathname || '/';
  if (pathname === mount) return '/';
  if (pathname.startsWith(mount + '/')) return pathname.slice(mount.length);
  // Not under the mount point at all — a 404 or an external path. Returning it
  // unchanged keeps callers comparing against something real rather than a
  // truncated fragment that might accidentally match a route.
  return pathname || '/';
}
