import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadLocalSearchTranslations } from './local-search-i18n.svelte';
import en from './local-search-locales/en';

const languages = ['en', 'de', 'fr', 'es', 'ja', 'pt', 'zh', 'ar'] as const;
const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

describe('optional local-search translations', () => {
  it.each(languages)('%s has every feature string and the same interpolation fields', async language => {
    const copy = await loadLocalSearchTranslations(language);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(typeof copy[key], `${language}.${key}`).toBe('string');
      expect(copy[key].trim(), `${language}.${key} must not be empty`).not.toBe('');
      expect(placeholders(copy[key]), `${language}.${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('shares a loaded locale without merging it into the global dictionary', async () => {
    const [first, second] = await Promise.all([loadLocalSearchTranslations('fr'), loadLocalSearchTranslations('fr')]);
    expect(first).toBe(second);
    const globalEnglish = readFileSync('src/lib/i18n.svelte.ts', 'utf8');
    expect(globalEnglish).not.toContain('localSearch:');
    expect(globalEnglish).not.toContain('local-search-locales');
  });
});
