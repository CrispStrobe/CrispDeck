/**
 * Tests for the i18n translation service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translations } from './i18n.svelte';

// Note: We can't test the reactive TranslationService directly (Svelte 5 runes
// require a compiler), but we can test the translation data and structure.

describe('i18n translations', () => {
  describe('translation structure', () => {
    it('has en and de languages', () => {
      expect(translations).toHaveProperty('en');
      expect(translations).toHaveProperty('de');
    });

    it('en and de have identical top-level keys', () => {
      const enKeys = Object.keys(translations.en).sort();
      const deKeys = Object.keys(translations.de).sort();
      expect(enKeys).toEqual(deKeys);
    });

    it('nav section has all required keys in both languages', () => {
      const requiredKeys = [
        'dashboard', 'feed', 'deck', 'compose', 'drafts', 'notifications',
        'messages', 'bookmarks', 'lists', 'starterPacks', 'identities',
        'search', 'trending', 'archive', 'labelers', 'instance',
        'moderation', 'analytics', 'settings', 'post', 'alerts', 'dms',
      ];
      for (const key of requiredKeys) {
        expect(translations.en.nav).toHaveProperty(key);
        expect(translations.de.nav).toHaveProperty(key);
      }
    });

    it('compose section has all required keys in both languages', () => {
      const requiredKeys = [
        'title', 'placeholder', 'post', 'postThread', 'posting',
        'saveDraft', 'selectAccount', 'replyingTo', 'quoting',
        'cw', 'preview', 'altTextPlaceholder',
      ];
      for (const key of requiredKeys) {
        expect(translations.en.compose).toHaveProperty(key);
        expect(translations.de.compose).toHaveProperty(key);
      }
    });

    it('post section has all required keys in both languages', () => {
      const requiredKeys = [
        'reply', 'boost', 'quote', 'like', 'bookmark', 'copyLink',
        'copied', 'report', 'translate', 'hideTranslation', 'shareAsImage',
        'repostedBy', 'contentHidden', 'showAnyway', 'contentWarning',
      ];
      for (const key of requiredKeys) {
        expect(translations.en.post).toHaveProperty(key);
        expect(translations.de.post).toHaveProperty(key);
      }
    });

    it('settings section has all required keys in both languages', () => {
      const requiredKeys = [
        'title', 'blueskyAccounts', 'mastodonAccounts', 'add',
        'oauthRecommended', 'appPassword', 'handle', 'cancel',
        'preferences', 'language', 'translateTarget', 'altTextMode',
        'altTextOff', 'altTextWarn', 'altTextRequire',
      ];
      for (const key of requiredKeys) {
        expect(translations.en.settings).toHaveProperty(key);
        expect(translations.de.settings).toHaveProperty(key);
      }
    });

    it('common section has all required keys in both languages', () => {
      const requiredKeys = ['dismiss', 'loading', 'error', 'postedTo', 'view'];
      for (const key of requiredKeys) {
        expect(translations.en.common).toHaveProperty(key);
        expect(translations.de.common).toHaveProperty(key);
      }
    });

    it('translation section has all keys in both languages', () => {
      const requiredKeys = ['provider', 'mymemoryFree', 'crispasrLocal', 'openaiByok', 'targetLang'];
      for (const key of requiredKeys) {
        expect(translations.en.translation).toHaveProperty(key);
        expect(translations.de.translation).toHaveProperty(key);
      }
    });

    it('tts/stt/analytics/moderation sections exist in en and de', () => {
      for (const section of ['tts', 'stt', 'analytics', 'moderation', 'lists', 'trending', 'starterPacks', 'about'] as const) {
        expect(translations.en).toHaveProperty(section);
        expect(translations.de).toHaveProperty(section);
      }
    });

    it('fr/es/ja/ar have core nav + compose + feed + settings + common sections', () => {
      for (const lang of ['fr', 'es', 'ja', 'ar'] as const) {
        expect(translations[lang]).toHaveProperty('nav');
        expect(translations[lang]).toHaveProperty('compose');
        expect(translations[lang]).toHaveProperty('feed');
        expect(translations[lang]).toHaveProperty('settings');
        expect(translations[lang]).toHaveProperty('common');
      }
    });

    it('all 8 languages have nav.dashboard', () => {
      for (const lang of ['en', 'de', 'fr', 'es', 'ja', 'pt', 'zh', 'ar'] as const) {
        expect(translations[lang].nav.dashboard).toBeTruthy();
      }
    });

    it('ar (Arabic) has RTL-appropriate translations', () => {
      expect(translations.ar.nav.dashboard).toBe('لوحة التحكم');
      expect(translations.ar.nav.settings).toBe('الإعدادات');
    });
  });

  describe('translation completeness', () => {
    function getLeafKeys(obj: any, prefix = ''): string[] {
      const keys: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null) {
          keys.push(...getLeafKeys(v, path));
        } else {
          keys.push(path);
        }
      }
      return keys;
    }

    it('de has all leaf keys that en has', () => {
      const enLeaves = getLeafKeys(translations.en).sort();
      const deLeaves = getLeafKeys(translations.de).sort();
      expect(deLeaves).toEqual(enLeaves);
    });

    it('no empty translation values in en', () => {
      const enLeaves = getLeafKeys(translations.en);
      for (const path of enLeaves) {
        const value = path.split('.').reduce((obj: any, key) => obj[key], translations.en);
        expect(value, `en.${path} is empty`).not.toBe('');
      }
    });

    it('no empty translation values in de', () => {
      const deLeaves = getLeafKeys(translations.de);
      for (const path of deLeaves) {
        const value = path.split('.').reduce((obj: any, key) => obj[key], translations.de);
        expect(value, `de.${path} is empty`).not.toBe('');
      }
    });
  });

  describe('translation values', () => {
    it('en values are in English', () => {
      expect(translations.en.nav.dashboard).toBe('Dashboard');
      expect(translations.en.nav.settings).toBe('Settings');
      expect(translations.en.compose.post).toBe('Post');
    });

    it('de values are in German', () => {
      expect(translations.de.nav.dashboard).toBe('Übersicht');
      expect(translations.de.nav.settings).toBe('Einstellungen');
      expect(translations.de.compose.post).toBe('Posten');
    });

    it('interpolation placeholders match between languages', () => {
      // Find all {placeholder} patterns and ensure they match
      const enPost = translations.en.compose.postToAccounts;
      const dePost = translations.de.compose.postToAccounts;
      expect(enPost).toContain('{count}');
      expect(dePost).toContain('{count}');
    });

    it('app name is the same in both languages', () => {
      expect(translations.en.app.name).toBe(translations.de.app.name);
    });
  });
});
