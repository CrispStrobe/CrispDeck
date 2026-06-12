/**
 * Tests for the i18n translation service.
 */
import { describe, it, expect } from 'vitest';
import { translations } from './i18n.svelte';
import de from './i18n/de';
import fr from './i18n/fr';
import es from './i18n/es';
import ja from './i18n/ja';
import pt from './i18n/pt';
import zh from './i18n/zh';
import ar from './i18n/ar';

const allLangs: Record<string, any> = { en: translations.en, de, fr, es, ja, pt, zh, ar };

describe('i18n translations', () => {
  describe('translation structure', () => {
    it('has en and de languages', () => {
      expect(translations).toHaveProperty('en');
      expect(de).toBeTruthy();
    });

    it('en and de have identical top-level keys', () => {
      const enKeys = Object.keys(translations.en).sort();
      const deKeys = Object.keys(de).sort();
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
        expect(de.nav).toHaveProperty(key);
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
        expect(de.compose).toHaveProperty(key);
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
        expect(de.post).toHaveProperty(key);
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
        expect(de.settings).toHaveProperty(key);
      }
    });

    it('common section has all required keys in both languages', () => {
      const requiredKeys = ['dismiss', 'loading', 'error', 'postedTo', 'view'];
      for (const key of requiredKeys) {
        expect(translations.en.common).toHaveProperty(key);
        expect(de.common).toHaveProperty(key);
      }
    });

    it('translation section has all keys in both languages', () => {
      const requiredKeys = ['provider', 'mymemoryFree', 'crispasrLocal', 'openaiByok', 'targetLang'];
      for (const key of requiredKeys) {
        expect(translations.en.translation).toHaveProperty(key);
        expect(de.translation).toHaveProperty(key);
      }
    });

    it('tts/stt/analytics/moderation sections exist in en and de', () => {
      for (const section of ['tts', 'stt', 'analytics', 'moderation', 'lists', 'trending', 'starterPacks', 'about'] as const) {
        expect(translations.en).toHaveProperty(section);
        expect(de).toHaveProperty(section);
      }
    });

    it('fr/es/ja/ar have core nav + compose + feed + settings + common sections', () => {
      for (const lang of [fr, es, ja, ar]) {
        expect(lang).toHaveProperty('nav');
        expect(lang).toHaveProperty('compose');
        expect(lang).toHaveProperty('feed');
        expect(lang).toHaveProperty('settings');
        expect(lang).toHaveProperty('common');
      }
    });

    it('all 8 languages have nav.dashboard', () => {
      for (const [name, lang] of Object.entries(allLangs)) {
        expect(lang.nav.dashboard, `${name} missing nav.dashboard`).toBeTruthy();
      }
    });

    it('ar (Arabic) has RTL-appropriate translations', () => {
      expect(ar.nav.dashboard).toBe('لوحة التحكم');
      expect(ar.nav.settings).toBe('الإعدادات');
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
      const deLeaves = getLeafKeys(de).sort();
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
      const deLeaves = getLeafKeys(de);
      for (const path of deLeaves) {
        const value = path.split('.').reduce((obj: any, key) => obj[key], de);
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
      expect(de.nav.dashboard).toBe('Übersicht');
      expect(de.nav.settings).toBe('Einstellungen');
      expect(de.compose.post).toBe('Posten');
    });

    it('interpolation placeholders match between languages', () => {
      const enPost = translations.en.compose.postToAccounts;
      const dePost = de.compose.postToAccounts;
      expect(enPost).toContain('{count}');
      expect(dePost).toContain('{count}');
    });

    it('app name is the same in both languages', () => {
      expect(translations.en.app.name).toBe(de.app.name);
    });
  });
});
