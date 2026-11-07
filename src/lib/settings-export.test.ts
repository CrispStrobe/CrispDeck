/**
 * Tests for settings export/import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSettings, importSettings, listExportableKeys } from './settings-export';

describe('settings export/import', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    });
  });

  describe('exportSettings', () => {
    it('exports crispdeck- prefixed keys', () => {
      localStorage.setItem('crispdeck-theme', 'dark');
      localStorage.setItem('crispdeck-deck-columns', '[]');
      localStorage.setItem('other-key', 'ignored');

      const data = exportSettings();
      expect(data.version).toBe(1);
      expect(data.exported_at).toBeTruthy();
      expect(data.settings['crispdeck-theme']).toBe('dark');
      expect(data.settings['crispdeck-deck-columns']).toBe('[]');
      expect(data.settings['other-key']).toBeUndefined();
    });

    it('excludes credential keys', () => {
      const secrets = ['crispdeck-encrypt-seed', 'crispdeck-key', 'crispdeck-salt-v2', 'crispdeck-crypto-v2', 'crispdeck-mastodon-apps', 'crispdeck-threads-config', 'crispdeck-wallabag-session'];
      for (const key of secrets) localStorage.setItem(key, 'secret');
      localStorage.setItem('crispdeck-theme', 'dark');

      const data = exportSettings();
      for (const key of secrets) expect(data.settings[key]).toBeUndefined();
      expect(data.settings['crispdeck-theme']).toBe('dark');
      expect(listExportableKeys().map(entry => entry.key)).toEqual(['crispdeck-theme']);
    });

    it.each(['https://reader:private-test-secret@wallabag.example', 'https://wallabag.example?access_token=private-test-secret', 'javascript:alert(1)'])('does not export credentials or invalid schemes in a legacy Wallabag address', value => {
      localStorage.setItem('crispdeck-wallabag-url', value);
      expect(exportSettings().settings['crispdeck-wallabag-url']).toBeUndefined();
      expect(listExportableKeys()).toEqual([]);
    });

    it('exports a normalized Wallabag server without exporting its session', () => {
      localStorage.setItem('crispdeck-wallabag-url', ' HTTPS://wallabag.example:443/read/ ');
      localStorage.setItem('crispdeck-wallabag-session', 'encrypted-test-secret');
      expect(exportSettings().settings).toEqual({ 'crispdeck-wallabag-url': 'https://wallabag.example/read' });
    });

    it('exports provider preferences without AI, translation, or future secret fields', () => {
      localStorage.setItem('crispdeck-ai-compose-config', JSON.stringify({ provider: 'openai', baseUrl: 'https://api.example/v1', model: 'model', apiKey: 'compose-secret', futureSecret: 'secret' }));
      localStorage.setItem('crispdeck-translate-config', JSON.stringify({ provider: 'openai', targetLang: 'de', openaiApiKey: 'translation-secret', libreTranslateApiKey: 'libre-secret' }));
      const data = exportSettings();
      expect(JSON.parse(data.settings['crispdeck-ai-compose-config'])).toEqual({ provider: 'openai', baseUrl: 'https://api.example/v1', model: 'model' });
      expect(JSON.parse(data.settings['crispdeck-translate-config'])).toEqual({ provider: 'openai', targetLang: 'de' });
      expect(JSON.stringify(data)).not.toContain('secret');
    });

    it('does not leak malformed credential-bearing config', () => {
      localStorage.setItem('crispdeck-ai-compose-config', '{"apiKey":"secret"');
      localStorage.setItem('crispdeck-translate-config', '"secret"');
      expect(exportSettings().settings).toEqual({});
      expect(listExportableKeys()).toEqual([]);
    });

    it('excludes OAuth state', () => {
      localStorage.setItem('crispdeck-oauth-state', '{}');
      localStorage.setItem('crispdeck-threads-oauth-state', 'abc');

      const data = exportSettings();
      expect(data.settings['crispdeck-oauth-state']).toBeUndefined();
      expect(data.settings['crispdeck-threads-oauth-state']).toBeUndefined();
    });

    it('returns empty settings when nothing stored', () => {
      const data = exportSettings();
      expect(Object.keys(data.settings)).toHaveLength(0);
    });
  });

  describe('importSettings', () => {
    it('imports valid settings', () => {
      const data = {
        version: 1,
        exported_at: '2026-01-01',
        settings: {
          'crispdeck-theme': 'oled',
          'crispdeck-deck-columns': '[{"id":"1"}]',
        },
      };

      const count = importSettings(data);
      expect(count).toBe(2);
      expect(localStorage.getItem('crispdeck-theme')).toBe('oled');
      expect(localStorage.getItem('crispdeck-deck-columns')).toBe('[{"id":"1"}]');
    });

    it('rejects invalid format', () => {
      expect(() => importSettings({} as any)).toThrow('Invalid settings file format');
      expect(() => importSettings({ version: 2, settings: {} } as any)).toThrow();
      expect(() => importSettings({ version: 1, settings: 'bad' } as any)).toThrow();
      expect(() => importSettings({ version: 1, settings: [] } as any)).toThrow();
    });

    it('does not overwrite device encryption material from an older backup', () => {
      localStorage.setItem('crispdeck-key', 'current-key');
      localStorage.setItem('crispdeck-salt-v2', 'current-salt');
      const count = importSettings({ version: 1, exported_at: '', settings: {
        'crispdeck-key': 'other-device-key', 'crispdeck-salt-v2': 'other-device-salt', 'crispdeck-crypto-v2': 'true',
        'crispdeck-mastodon-apps': '{"client_secret":"secret"}', 'crispdeck-threads-config': '{"client_secret":"secret"}',
      } });
      expect(count).toBe(0);
      expect(localStorage.getItem('crispdeck-key')).toBe('current-key');
      expect(localStorage.getItem('crispdeck-salt-v2')).toBe('current-salt');
    });

    it('strips secrets from older backups and never attaches an existing key to an imported endpoint', () => {
      localStorage.setItem('crispdeck-ai-compose-config', JSON.stringify({ apiKey: 'current-secret', baseUrl: 'https://trusted.example' }));
      importSettings({ version: 1, exported_at: '', settings: {
        'crispdeck-ai-compose-config': JSON.stringify({ apiKey: 'imported-secret', baseUrl: 'https://new.example', model: 'new-model' }),
        'crispdeck-translate-config': JSON.stringify({ targetLang: 'fr', openaiApiKey: 'secret', libreTranslateApiKey: 'secret' }),
      } });
      expect(JSON.parse(localStorage.getItem('crispdeck-ai-compose-config')!)).toEqual({ baseUrl: 'https://new.example', model: 'new-model' });
      expect(JSON.parse(localStorage.getItem('crispdeck-translate-config')!)).toEqual({ targetLang: 'fr' });
    });

    it('reports a failed write instead of claiming the settings were imported', () => {
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
      expect(() => importSettings({ version: 1, exported_at: '', settings: { 'crispdeck-theme': 'dark' } })).toThrow('storage failed after 0 saved settings');
    });

    it('skips non-crispdeck keys', () => {
      const data = {
        version: 1,
        exported_at: '2026-01-01',
        settings: {
          'crispdeck-theme': 'light',
          'malicious-key': 'bad',
        },
      };

      const count = importSettings(data);
      expect(count).toBe(1);
      expect(localStorage.getItem('malicious-key')).toBeNull();
    });

    it('skips credential keys even if present in file', () => {
      const data = {
        version: 1,
        exported_at: '2026-01-01',
        settings: {
          'crispdeck-encrypt-seed': 'stolen-secret',
          'crispdeck-wallabag-session': 'stolen-token',
          'crispdeck-theme': 'dark',
        },
      };

      const count = importSettings(data);
      expect(count).toBe(1);
      expect(localStorage.getItem('crispdeck-encrypt-seed')).toBeNull();
      expect(localStorage.getItem('crispdeck-wallabag-session')).toBeNull();
    });

    it('skips imported Wallabag addresses containing credentials without replacing the current server', () => {
      localStorage.setItem('crispdeck-wallabag-url', 'https://wallabag.example');
      expect(importSettings({ version: 1, exported_at: '', settings: {
        'crispdeck-wallabag-url': 'https://reader:private-test-secret@other.example',
      } })).toBe(0);
      expect(localStorage.getItem('crispdeck-wallabag-url')).toBe('https://wallabag.example');
    });
  });

  describe('listExportableKeys', () => {
    it('lists crispdeck- keys with sizes', () => {
      localStorage.setItem('crispdeck-theme', 'dark');
      localStorage.setItem('crispdeck-lang', 'en');
      localStorage.setItem('other', 'x');

      const keys = listExportableKeys();
      expect(keys).toHaveLength(2);
      expect(keys.find(k => k.key === 'crispdeck-theme')).toBeTruthy();
      expect(keys.find(k => k.key === 'other')).toBeUndefined();
    });
  });
});
