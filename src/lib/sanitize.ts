let _DOMPurify: typeof import('dompurify').default | null = null;
let _loading = false;

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['a', 'p', 'br', 'span', 'em', 'strong', 'b', 'i', 'del', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'title', 'lang', 'dir'],
  ALLOW_DATA_ATTR: false,
};

/** Preload DOMPurify so it's ready before any Mastodon posts render.
 *  Call this from layout onMount for instant first-post rendering. */
export function preloadSanitizer(): void {
  if (_DOMPurify || _loading) return;
  _loading = true;
  import('dompurify').then(m => { _DOMPurify = m.default; _loading = false; });
}

/** Sanitize HTML from untrusted sources (Mastodon API, instance descriptions).
 *  Allows safe subset: links, formatting, mentions, hashtags. Strips scripts, events, iframes.
 *  DOMPurify is loaded on first call (~30KB, not bundled into every page). */
export function sanitizeHtml(dirty: string): string {
  if (!_DOMPurify) {
    // Synchronous fallback: strip all tags until DOMPurify loads
    if (!_loading) preloadSanitizer();
    return dirty.replace(/<[^>]*>/g, '');
  }
  return _DOMPurify.sanitize(dirty, PURIFY_CONFIG);
}
