import DOMPurify from 'dompurify';

/** Article URLs must never be resolved against CrispDeck's own origin. */
export function wallabagArticleUrl(input: unknown, articleUrl?: string): string | null {
  if (typeof input !== 'string' || !input.trim() || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = articleUrl ? new URL(input.trim(), articleUrl) : new URL(input.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Wallabag content is captured from arbitrary websites, not trusted app HTML.
 * This reader-only module loads DOMPurify before it can render anything. There
 * is no temporary regex fallback or unsanitized first frame.
 */
export function sanitizeWallabagHtml(content: string, sourceUrl: string): string {
  const fragment = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      'a', 'p', 'br', 'span', 'em', 'strong', 'b', 'i', 'del', 's', 'small', 'sub', 'sup',
      'pre', 'code', 'kbd', 'samp', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'img',
      'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'lang', 'dir', 'colspan', 'rowspan', 'scope', 'start', 'reversed'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const base = wallabagArticleUrl(sourceUrl) ?? undefined;
  for (const anchor of fragment.querySelectorAll('a')) {
    const href = wallabagArticleUrl(anchor.getAttribute('href'), base);
    if (!href) {
      anchor.removeAttribute('href');
      continue;
    }
    anchor.setAttribute('href', href);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  for (const image of fragment.querySelectorAll('img')) {
    const src = wallabagArticleUrl(image.getAttribute('src'), base);
    if (!src) {
      // Keep useful alternative text without leaving a broken, unsafe image.
      image.replaceWith(document.createTextNode(image.getAttribute('alt') ?? ''));
      continue;
    }
    image.setAttribute('src', src);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('referrerpolicy', 'no-referrer');
    if (!image.hasAttribute('alt')) image.setAttribute('alt', '');
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
