import { describe, it, expect } from 'vitest';
import { safeExternalUrl, hrefOrHash } from './safe-url';

/**
 * The gap this closes: the Bluesky facet builder escaped a link's URI before
 * putting it in an href, which stops it breaking out of the attribute and
 * does nothing at all about `javascript:`. Escaping is about quoting; this is
 * about the scheme.
 */

describe('safeExternalUrl', () => {
  it.each([
    'https://example.test/a?b=c#d',
    'http://example.test',
    'mailto:someone@example.test',
  ])('accepts %s', (url) => {
    expect(safeExternalUrl(url)).toBeTruthy();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'jAvAsCrIpT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.test/x',
  ])('refuses %s', (url) => {
    expect(safeExternalUrl(url)).toBeNull();
  });

  it('refuses a scheme hidden behind a control character', () => {
    // Some parsers strip the tab and read javascript: underneath.
    expect(safeExternalUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('java\u0000script:alert(1)')).toBeNull();
  });

  it('refuses leading whitespace around a bad scheme', () => {
    expect(safeExternalUrl('  javascript:alert(1)')).toBeNull();
  });

  it('keeps a relative URL as it was written', () => {
    // Resolving against the placeholder origin must not leak into the output.
    expect(safeExternalUrl('/profile?handle=a.test')).toBe('/profile?handle=a.test');
    expect(safeExternalUrl('/x')).not.toContain('relative.invalid');
  });

  it('refuses empty, blank and non-strings', () => {
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
    // An object that stringifies to an attack is still not a string.
    expect(safeExternalUrl({ toString: () => 'javascript:alert(1)' })).toBeNull();
  });

  it('preserves the query and fragment a real link needs', () => {
    expect(safeExternalUrl('https://x.test/p?a=1&b=2#f')).toBe('https://x.test/p?a=1&b=2#f');
  });

  it('does not mangle a unicode domain or path', () => {
    expect(safeExternalUrl('https://例え.test/ページ')).toContain('http');
  });
});

describe('hrefOrHash', () => {
  it('passes a good URL through', () => {
    expect(hrefOrHash('https://x.test')).toBe('https://x.test/');
  });

  it('falls back to # rather than empty', () => {
    // An empty href navigates to the current page, which looks like a link
    // that works and silently does nothing.
    expect(hrefOrHash('javascript:alert(1)')).toBe('#');
    expect(hrefOrHash(undefined)).toBe('#');
  });
});
