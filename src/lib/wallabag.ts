/** Wallabag's bookmarklet uses the browser's own sign-in session. */
export function wallabagBookmarklet(instance: string, link: string): string | null {
  try {
    const base = new URL(instance.trim());
    const target = new URL(link);
    if (!['http:', 'https:'].includes(base.protocol) || !['http:', 'https:'].includes(target.protocol) || base.username || base.password) return null;
    base.hash = ''; base.search = '';
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/bookmarklet`;
    base.searchParams.set('url', target.href);
    return base.href;
  } catch { return null; }
}
