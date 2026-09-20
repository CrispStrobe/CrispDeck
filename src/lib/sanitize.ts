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

/**
 * Replace :shortcode: with the instance's custom emoji image.
 *
 * This used to be a string replace over the already-sanitized HTML:
 *
 *   html = html.replaceAll(`:${e.shortcode}:`, `<img src="${e.url}" ...>`)
 *
 * which had two problems. The emoji URL comes from the remote instance and was
 * interpolated into an attribute unescaped, so a URL containing a quote broke
 * out of it — and because this ran *after* DOMPurify, the sanitizer could not
 * help. `img` is not even in ALLOWED_TAGS, so the replacement was stepping
 * around the allowlist rather than being covered by it. The shortcode could
 * also land inside an attribute value (a link title, say) and inject there.
 *
 * So it works on the parsed DOM instead, and only ever inside text nodes.
 * Nothing is interpolated into markup: the element is built with
 * createElement and the URL is assigned as a property after being checked, so
 * there is no attribute context to escape.
 */
export function injectCustomEmoji(
  sanitized: string,
  emojis: Array<{ shortcode: string; url: string }> | undefined,
): string {
  if (!sanitized || !emojis?.length) return sanitized;
  if (typeof DOMParser === 'undefined') return sanitized;

  const byShortcode = new Map<string, string>();
  for (const emoji of emojis) {
    const url = safeImageUrl(emoji.url);
    // A shortcode is [a-zA-Z0-9_] per Mastodon; anything else is not one, and
    // letting it through would make the split pattern below attacker-shaped.
    if (url && /^\w+$/.test(emoji.shortcode)) byShortcode.set(emoji.shortcode, url);
  }
  if (byShortcode.size === 0) return sanitized;

  const doc = new DOMParser().parseFromString(sanitized, 'text/html');
  const pattern = /:(\w+):/g;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const text of textNodes) {
    const value = text.nodeValue ?? '';
    if (!value.includes(':')) continue;
    pattern.lastIndex = 0;
    if (!pattern.test(value)) continue;

    pattern.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const url = byShortcode.get(match[1]);
      if (!url) continue;
      if (match.index > last) {
        fragment.appendChild(doc.createTextNode(value.slice(last, match.index)));
      }
      const img = doc.createElement('img');
      img.setAttribute('src', url);
      img.setAttribute('alt', `:${match[1]}:`);
      img.setAttribute('class', 'inline-emoji');
      img.setAttribute('draggable', 'false');
      fragment.appendChild(img);
      last = match.index + match[0].length;
    }
    if (last === 0) continue;
    if (last < value.length) fragment.appendChild(doc.createTextNode(value.slice(last)));
    text.parentNode?.replaceChild(fragment, text);
  }

  return doc.body.innerHTML;
}

/**
 * An http(s) URL suitable for an image src, or null.
 *
 * Emoji URLs come from whatever instance served the post. javascript: does not
 * execute in an img src, but data: does carry SVG, which can, and blob:/file:
 * have no business here either.
 */
export function safeImageUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url, 'https://invalid.example');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
