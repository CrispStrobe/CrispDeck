import DOMPurify from 'dompurify';

/** Sanitize HTML from untrusted sources (Mastodon API, instance descriptions).
 *  Allows safe subset: links, formatting, mentions, hashtags. Strips scripts, events, iframes. */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['a', 'p', 'br', 'span', 'em', 'strong', 'b', 'i', 'del', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'title', 'lang', 'dir'],
    ALLOW_DATA_ATTR: false,
  });
}
