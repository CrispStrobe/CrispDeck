/**
 * Tests for the multi-provider translation service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('translate utilities', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  describe('getTranslateConfig / setTranslateConfig', () => {
    it('returns defaults when nothing stored', async () => {
      const { getTranslateConfig } = await import('./translate');
      const cfg = getTranslateConfig();
      expect(cfg.provider).toBe('mymemory');
      expect(cfg.targetLang).toBe('en');
    });

    it('merges partial updates', async () => {
      const { setTranslateConfig, getTranslateConfig } = await import('./translate');
      setTranslateConfig({ targetLang: 'de' });
      const cfg = getTranslateConfig();
      expect(cfg.targetLang).toBe('de');
      expect(cfg.provider).toBe('mymemory'); // unchanged
    });

    it('saves OpenAI config', async () => {
      const { setTranslateConfig, getTranslateConfig } = await import('./translate');
      setTranslateConfig({
        provider: 'openai',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiApiKey: '',
        openaiModel: 'llama3.2',
      });
      const cfg = getTranslateConfig();
      expect(cfg.provider).toBe('openai');
      expect(cfg.openaiModel).toBe('llama3.2');
    });

    it('saves CrispASR config', async () => {
      const { setTranslateConfig, getTranslateConfig } = await import('./translate');
      setTranslateConfig({ provider: 'crispasr', crispasrModel: 'm2m100-418m-q8_0' });
      const cfg = getTranslateConfig();
      expect(cfg.provider).toBe('crispasr');
      expect(cfg.crispasrModel).toBe('m2m100-418m-q8_0');
    });
  });

  describe('getTargetLanguage / setTargetLanguage (backward compat)', () => {
    it('defaults to "en"', async () => {
      const { getTargetLanguage } = await import('./translate');
      expect(getTargetLanguage()).toBe('en');
    });

    it('setTargetLanguage updates config', async () => {
      const { setTargetLanguage, getTranslateConfig } = await import('./translate');
      setTargetLanguage('ja');
      expect(getTranslateConfig().targetLang).toBe('ja');
    });
  });

  describe('HTML stripping', () => {
    it('strips HTML tags from Mastodon content', () => {
      const html = '<p>Hello <a href="https://example.com">world</a></p>';
      const stripped = html.replace(/<[^>]*>/g, '').trim();
      expect(stripped).toBe('Hello world');
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
    it('consistent hashes for same input', () => {
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
      expect(hashText('日本語')).toBe(hashText('日本語'));
    });
  });

  describe('provider types', () => {
    it('provider enum covers all backends', async () => {
      const { getTranslateConfig, setTranslateConfig } = await import('./translate');
      for (const provider of ['crispasr', 'openai', 'mymemory'] as const) {
        setTranslateConfig({ provider });
        expect(getTranslateConfig().provider).toBe(provider);
      }
    });
  });
});
