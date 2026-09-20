/**
 * URLs that arrive from a server and end up in an href.
 *
 * Escaping is not enough on its own. `escapeHtml(uri)` stops a URL breaking
 * out of the attribute, and then renders `href="javascript:alert(1)"`
 * perfectly safely as markup — which runs when the user clicks it. The scheme
 * has to be checked, not just the quoting.
 *
 * Everything displayed here is remote: Bluesky facet links and external card
 * URIs come from the post's author, Mastodon card and trending URLs from the
 * instance. A self-hosted PDS or instance serves whatever it likes.
 *
 * Images are a weaker case — javascript: does not run in a src — but data:
 * can carry SVG with script in it, so safeImageUrl in sanitize.ts applies the
 * same idea there.
 */

/** Schemes worth linking to. Everything else is refused. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL if it is safe to put in an href, otherwise null.
 *
 * Relative URLs are resolved against a placeholder origin purely to parse
 * them; a relative path has no scheme of its own and so cannot smuggle one.
 */
export function safeExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Control characters are how "java\tscript:" slips past a prefix check:
  // some parsers strip them and read the scheme underneath. URL parsing
  // normalises them anyway, but refusing here keeps the intent visible.
  if (/[\u0000-\u0020]/.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed, 'https://relative.invalid');
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
    // A relative input resolved against the placeholder: hand back the
    // original rather than a URL pointing at a domain that does not exist.
    if (parsed.origin === 'https://relative.invalid' && !/^https?:/i.test(trimmed)) {
      return trimmed;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Same check, with a fallback for use directly in a template.
 *
 * '#' rather than '' because an anchor with an empty href navigates to the
 * current page, which looks like a working link that silently does nothing;
 * '#' at least stays put.
 */
export function hrefOrHash(url: unknown): string {
  return safeExternalUrl(url) ?? '#';
}
