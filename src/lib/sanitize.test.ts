import { describe, it, expect, beforeAll } from 'vitest';
import { sanitizeHtml, injectCustomEmoji, safeImageUrl, preloadSanitizer } from './sanitize';

/**
 * Custom emoji used to be spliced into already-sanitized HTML as a string:
 *
 *   html.replaceAll(`:${e.shortcode}:`, `<img src="${e.url}" ...>`)
 *
 * The URL comes from whatever instance served the post, it was not escaped,
 * and this ran after DOMPurify — so a quote in the URL broke out of the
 * attribute with nothing left to catch it. `img` is not in ALLOWED_TAGS
 * either, so the replacement was stepping around the allowlist rather than
 * being covered by it.
 */

beforeAll(async () => {
  // DOMPurify loads lazily; without it sanitizeHtml falls back to stripping
  // every tag, and these tests would pass for the wrong reason.
  preloadSanitizer();
  await new Promise((r) => setTimeout(r, 50));
});

const emoji = (over: Partial<{ shortcode: string; url: string }> = {}) => [
  { shortcode: 'party', url: 'https://cdn.example/party.png', ...over },
];

describe('injectCustomEmoji', () => {
  it('replaces a shortcode with an image', () => {
    const out = injectCustomEmoji('<p>hello :party:</p>', emoji());
    expect(out).toContain('<img');
    expect(out).toContain('https://cdn.example/party.png');
    expect(out).not.toContain(':party:</p>');
  });

  it('keeps the surrounding text intact', () => {
    const out = injectCustomEmoji('<p>a :party: b</p>', emoji());
    expect(out).toContain('a ');
    expect(out).toContain(' b');
  });

  it('replaces every occurrence', () => {
    const out = injectCustomEmoji('<p>:party: :party:</p>', emoji());
    expect(out.match(/<img/g)).toHaveLength(2);
  });

  it('leaves a shortcode the instance did not define', () => {
    const out = injectCustomEmoji('<p>:unknown:</p>', emoji());
    expect(out).toContain(':unknown:');
    expect(out).not.toContain('<img');
  });

  it('gives the image an alt so it is not silent to a screen reader', () => {
    expect(injectCustomEmoji('<p>:party:</p>', emoji())).toContain('alt=":party:"');
  });

  describe('a hostile instance', () => {
    it('cannot break out of the src attribute', () => {
      // The exact shape the old string splice was vulnerable to. Asserted by
      // parsing rather than by string match: the quote survives as %22 inside
      // the URL, which is inert, and "onerror" as characters in a path is not
      // the thing that matters. What matters is that no such attribute exists.
      const out = injectCustomEmoji('<p>:party:</p>', emoji({ url: 'https://x/a.png" onerror="alert(1)' }));
      const img = new DOMParser().parseFromString(out, 'text/html').querySelector('img');

      expect(img).not.toBeNull();
      expect(img!.getAttribute('onerror')).toBeNull();
      expect(img!.attributes.length).toBe(4);           // src, alt, class, draggable
      expect(img!.getAttribute('src')).not.toContain('"');
    });

    it('percent-encodes the quote rather than emitting it raw', () => {
      const out = injectCustomEmoji('<p>:party:</p>', emoji({ url: 'https://x/a.png" onerror="alert(1)' }));
      expect(out).toContain('%22');
    });

    it('cannot use a javascript: URL', () => {
      const out = injectCustomEmoji('<p>:party:</p>', emoji({ url: 'javascript:alert(1)' }));
      expect(out).not.toContain('javascript:');
      expect(out).toContain(':party:');   // left as plain text
    });

    it('cannot use a data: URL, which can carry executable SVG', () => {
      const out = injectCustomEmoji('<p>:party:</p>', emoji({ url: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==' }));
      expect(out).not.toContain('data:');
    });

    it('cannot inject through the shortcode either', () => {
      const out = injectCustomEmoji('<p>:a:</p>', [{ shortcode: 'a"><script>x</script>', url: 'https://cdn.example/a.png' }]);
      expect(out).not.toContain('<script');
    });

    it('cannot reach into an attribute value', () => {
      // A shortcode sitting in a title= would previously be replaced there,
      // and the quotes in the injected tag would break the attribute.
      const out = injectCustomEmoji('<a href="https://x.test" title=":party:">t</a>', emoji());
      expect(out).not.toContain('<img');
      expect(out).toContain('title=":party:"');
    });
  });

  it('returns the input unchanged when there are no emojis', () => {
    expect(injectCustomEmoji('<p>hi</p>', [])).toBe('<p>hi</p>');
    expect(injectCustomEmoji('<p>hi</p>', undefined)).toBe('<p>hi</p>');
  });
});

describe('safeImageUrl', () => {
  it('accepts http and https', () => {
    expect(safeImageUrl('https://a.test/x.png')).toBe('https://a.test/x.png');
    expect(safeImageUrl('http://a.test/x.png')).toBe('http://a.test/x.png');
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'blob:https://a.test/x', 'file:///etc/passwd'])(
    'rejects %s', (url) => expect(safeImageUrl(url)).toBeNull(),
  );

  it('rejects a non-string', () => {
    expect(safeImageUrl(undefined)).toBeNull();
    expect(safeImageUrl(42)).toBeNull();
  });
});

describe('sanitizeHtml still does its job', () => {
  it('strips a script tag', () => {
    expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).not.toContain('script');
  });

  it('strips an event handler', () => {
    expect(sanitizeHtml('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });

  it('strips a javascript: href', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('keeps the formatting a post actually uses', () => {
    const out = sanitizeHtml('<p>a <strong>b</strong> <a href="https://x.test">c</a></p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('https://x.test');
  });
});
