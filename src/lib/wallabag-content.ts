let DOMPurify: typeof import('dompurify').default | undefined;
let sanitizerLoad: Promise<void> | undefined;

/** Keep the sanitizer off the route's static download path, and await it. */
export function loadWallabagSanitizer(): Promise<void> {
  return sanitizerLoad ??= import('dompurify').then(module => {
    DOMPurify = module.default;
  }).catch(error => {
    sanitizerLoad = undefined;
    throw error;
  });
}

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
 * Parsoid and other extractors embed machine data in `data-mw` attributes.
 * A malformed attribute can leave the JSON behind as ordinary text, which a
 * sanitizer must keep (it is text, not markup). Drop these attributes before
 * parsing and remove the leaked fragments afterwards.
 */
function withoutEmbeddedMetadata(content: string): string {
  return content
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/\sdata-mw(?:-[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

/** True for a text node that is serialized template / JSON data, not prose. */
function looksLikeEmbeddedData(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  const jsonKeys = value.match(/"[A-Za-z_][\w-]*"\s*:/g)?.length ?? 0;
  const wikitext = /\[\[[^\]]+\]\]/.test(value);
  if (jsonKeys >= 2) return true;
  if (wikitext && /[{}]|"wt"|href/.test(value)) return true;
  if (value.length > 80) {
    const syntax = value.match(/[{}[\]"]/g)?.length ?? 0;
    if (syntax / value.length > 0.08) return true;
  }
  return false;
}

function removeEmbeddedData(fragment: DocumentFragment): void {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const remove: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    // A JSON sample inside a code block is the article, not leaked metadata.
    if (node.parentElement?.closest('pre, code, kbd, samp')) continue;
    if (looksLikeEmbeddedData(node.data)) remove.push(node);
  }
  for (const node of remove) node.remove();
}

/**
 * Wallabag content is captured from arbitrary websites, not trusted app HTML.
 * The reader must await loadWallabagSanitizer before setting an article. There
 * is no temporary regex fallback or unsanitized first frame: callers that miss
 * this precondition fail closed.
 */
export function sanitizeWallabagHtml(content: string, sourceUrl: string): string {
  if (!DOMPurify) throw new Error('The article sanitizer is not ready');
  const fragment = DOMPurify.sanitize(withoutEmbeddedMetadata(content), {
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
  removeEmbeddedData(fragment);
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
