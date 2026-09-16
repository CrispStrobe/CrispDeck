import { describe, it, expect } from 'vitest';
import { translations } from './i18n.svelte';

/**
 * Every locale must carry every key.
 *
 * The six non-German locales were each missing 400-650 of 808 keys and fell
 * back to English for them, so a Spanish user saw a mostly-English app. The
 * gap is measured by importing the modules and diffing the objects, never by
 * parsing the files: locale files put a whole group on one line, and a text
 * parser that counts braces counts the ones inside values too — a group
 * holding '{count} connected' looked like it ended early, so every key after
 * it read as missing and duplicate properties got written.
 */
const LOCALES = ['ar', 'de', 'es', 'fr', 'ja', 'pt', 'zh'] as const;

function flat(obj: unknown, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries((obj ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else if (v && typeof v === 'object') flat(v, `${prefix}${k}.`, out);
  }
  return out;
}

describe('translation completeness', () => {
  const en = flat((translations as Record<string, unknown>).en);

  for (const loc of LOCALES) {
    it(`${loc} has every key English has`, async () => {
      const mod = await import(`./i18n/${loc}.ts`);
      const have = flat(mod.default);
      const missing = Object.keys(en).filter((k) => !(k in have));
      expect(missing, `${loc} is missing ${missing.length} keys`).toEqual([]);
    });

    it(`${loc} interpolates the same placeholders as English`, async () => {
      // A translation that drops {count} renders a sentence with a hole in it,
      // and one that invents a placeholder renders the braces literally.
      const mod = await import(`./i18n/${loc}.ts`);
      const have = flat(mod.default);
      const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
      const wrong: string[] = [];
      for (const [k, v] of Object.entries(en)) {
        if (!(k in have)) continue;
        if (names(v) !== names(have[k])) {
          wrong.push(`${k}: en has "${names(v)}", ${loc} has "${names(have[k])}"`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});
