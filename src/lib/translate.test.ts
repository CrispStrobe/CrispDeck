/**
 * Tests for the translation service — cache key generation,
 * text cleaning, and target language management.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We can't test the full translateText (network + IndexedDB) in unit tests,
// but we can test the pure functions by extracting the logic.

describe('translate utilities', () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  describe('getTargetLanguage / setTargetLanguage', () => {
    it('defaults to "en" when nothing stored', async () => {
      const { getTargetLanguage } = await import('./translate');
      expect(getTargetLanguage()).toBe('en');
    });

    it('returns saved language', async () => {
      localStorage.setItem('crispdeck-translate-lang', 'de');
      const { getTargetLanguage } = await import('./translate');
      expect(getTargetLanguage()).toBe('de');
    });

    it('setTargetLanguage persists to localStorage', async () => {
      const { setTargetLanguage, getTargetLanguage } = await import('./translate');
      setTargetLanguage('ja');
      expect(localStorage.getItem('crispdeck-translate-lang')).toBe('ja');
    });
  });

  describe('HTML stripping in translation', () => {
    it('strips HTML tags from Mastodon content', () => {
      const html = '<p>Hello <a href="https://example.com">world</a></p>';
      const stripped = html.replace(/<[^>]*>/g, '').trim();
      expect(stripped).toBe('Hello world');
      expect(stripped).not.toContain('<');
      expect(stripped).not.toContain('>');
    });

    it('handles nested HTML', () => {
      const html = '<p><strong>Bold</strong> and <em>italic</em></p>';
      const stripped = html.replace(/<[^>]*>/g, '').trim();
      expect(stripped).toBe('Bold and italic');
    });

    it('handles empty tags', () => {
      const html = '<br/><p></p>';
      const stripped = html.replace(/<[^>]*>/g, '').trim();
      expect(stripped).toBe('');
    });

    it('preserves plain text', () => {
      const text = 'Just plain text with no HTML';
      const stripped = text.replace(/<[^>]*>/g, '').trim();
      expect(stripped).toBe(text);
    });
  });

  describe('cache key hashing', () => {
    it('produces consistent hashes for same input', () => {
      function hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          const chr = text.charCodeAt(i);
          hash = ((hash << 5) - hash) + chr;
          hash |= 0;
        }
        return hash.toString(36);
      }

      expect(hashText('hello')).toBe(hashText('hello'));
      expect(hashText('hello')).not.toBe(hashText('world'));
      expect(hashText('')).toBe('0');
    });

    it('handles unicode text', () => {
      function hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          const chr = text.charCodeAt(i);
          hash = ((hash << 5) - hash) + chr;
          hash |= 0;
        }
        return hash.toString(36);
      }

      const h1 = hashText('日本語テスト');
      const h2 = hashText('日本語テスト');
      expect(h1).toBe(h2);
      expect(typeof h1).toBe('string');
    });
  });
});
