/**
 * Which sidebar item counts as active for the current path.
 *
 * Several pages share a sidebar entry — the drafts page lights up Compose, the
 * gallery lights up Archive — so this is not a plain prefix match. The mapping
 * and the rule lived inside +layout.svelte, where nothing could import them,
 * and layout.test.ts kept its own copy of both.
 *
 * Paths here are mount-relative: the hrefs double as the keys persisted in
 * `crispdeck-nav-hidden`, so they must not change shape with where the app is
 * served. The caller strips the mount point with routePath() first.
 */

/** Sidebar href → every path that should light it up. */
export const MERGED_ROUTES: Record<string, string[]> = {
  '/trending': ['/trending', '/catchup'],
  '/lists': ['/lists', '/feed-builder', '/starterpacks'],
  '/bookmarks': ['/bookmarks', '/reading-lists'],
  '/archive': ['/archive', '/gallery'],
  '/analytics': ['/analytics', '/calendar'],
  '/moderation': ['/moderation', '/labelers'],
  '/compose': ['/compose', '/drafts'],
  '/settings': ['/settings', '/instance'],
};

/**
 * Whether `href` is the active sidebar item for `path`.
 *
 * Dashboard is exact — every path starts with '/', so a prefix match would
 * leave it permanently lit.
 */
export function isNavItemActive(
  href: string,
  path: string,
  merged: Record<string, string[]> = MERGED_ROUTES,
): boolean {
  if (href === '/') return path === '/';
  const routes = merged[href];
  if (routes) return routes.some((r) => path.startsWith(r));
  return path.startsWith(href);
}
