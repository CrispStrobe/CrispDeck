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
      localStorage.setItem('crispdeck-encrypt-seed', 'secret');
      localStorage.setItem('crispdeck-theme', 'dark');

      const data = exportSettings();
      expect(data.settings['crispdeck-encrypt-seed']).toBeUndefined();
      expect(data.settings['crispdeck-theme']).toBe('dark');
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
          'crispdeck-theme': 'dark',
        },
      };

      const count = importSettings(data);
      expect(count).toBe(1);
      expect(localStorage.getItem('crispdeck-encrypt-seed')).toBeNull();
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
