import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against UI text that never reaches the translation files.
 *
 * CrispDeck was about 60% localized: roughly 287 strings sat hardcoded in
 * components while 405 went through i18n, and in several places a translated
 * key existed and simply went unused — the whole deck page had translations in
 * eight languages and referenced none of them. Catching that by reading the
 * app in German is how it went unnoticed for so long, so it is a test now.
 *
 * What counts as "UI text" here is markup text and the attributes that render
 * as text. It does not chase every string in the codebase, because most of
 * them are keys, paths and log output, and a check that cries wolf gets
 * suppressed rather than fixed.
 */

/** Not translatable, with the reason. Matched against the exact string. */
const NOT_TRANSLATABLE = new Map<string, string>([
  ['CrispDeck', 'product name'],
  ['node scripts/generate-licenses.js', 'shell command'],
  ['--features crispasr-metal', 'cargo build flag'],
  // A language picker shows each language in its own language. Rendering
  // "Deutsch" as "German" to a German speaker is a regression, not a fix.
  ['English', 'language endonym'],
  ['Deutsch', 'language endonym'],
  ['Italiano', 'language endonym'],
  ['Nederlands', 'language endonym'],
  ['Inter', 'font name'],
  ['Monospace', 'font name'],
  // Named services, listed so a reader can go and look them up.
  ['LibreTranslate', 'service name'],
  ['Lingva', 'service name'],
  ['MyMemory', 'service name'],
  ['CrispASR', 'service name'],
]);

/** Model catalogue entries: proper nouns with their download sizes. */
const MODEL_ENTRY = /^(Pocket TTS|Chatterbox|Kartoffel|Lex\.au|Whisper|Moonshine|FastConformer|Parakeet|OmniASR|FireRed|VibeVoice|Mega ASR|WMT21|Gemma4)\b/;

const SKIP_FILES = ['src/lib/components/LogViewer.svelte'];

const STR = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.svelte')) out.push(p);
  }
  return out;
}

function stripNonMarkup(src: string): string {
  return src
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function isProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return false;
  if (/^[\d\W_]*$/.test(t) || /^https?:/.test(t)) return false;
  if (/[{}$]/.test(t)) return false;
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) || /^[A-Z][a-zA-Z]{3,}$/.test(t);
}

describe('i18n coverage', () => {
  it('no user-visible English is hardcoded in a component', () => {
    const patterns = [
      new RegExp(String.raw`>([^<>{}\n]{3,200}?)<`, 'g'),
      new RegExp(String.raw`\b(?:placeholder|title|aria-label|alt|label)=("(?:[^"\\]|\\.)*")`, 'g'),
      new RegExp(String.raw`\b(?:prompt|alert|confirm)\(\s*(${STR})`, 'g'),
      new RegExp(String.raw`\btoast\.\w+\(\s*(${STR})`, 'g'),
    ];

    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (SKIP_FILES.includes(file) || file.includes('i18n')) continue;
      const src = stripNonMarkup(readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(src))) {
          const raw = m[1];
          const text = /^['"]/.test(raw) ? raw.slice(1, -1) : raw;
          const t = text.trim();
          if (!isProse(text)) continue;
          if (NOT_TRANSLATABLE.has(t) || MODEL_ENTRY.test(t)) continue;
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`  ${file}:${line}\n      "${t}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every locale is a subset of English, so nothing renders a bare key', () => {
    // A key present in a translation but not in English cannot be reached
    // through i18n.t, and means the two drifted.
    // Key names only. Capturing the quote as well made a key spelled with "
    // in one file differ from the same key spelled with ' in another, which is
    // a formatting difference, not drift.
    const leaves = (src: string) => {
      const out = new Set<string>();
      for (const m of src.matchAll(/^\s*(\w+):\s*['"]/gm)) out.add(m[1]);
      return out;
    };
    const en = leaves(readFileSync('src/lib/i18n.svelte.ts', 'utf8'));
    for (const f of readdirSync('src/lib/i18n')) {
      const extra = [...leaves(readFileSync(join('src/lib/i18n', f), 'utf8'))].filter((k) => !en.has(k));
      expect(extra, `${f} has keys English does not`).toEqual([]);
    }
  });

  it('no translation is an empty string, in any locale', () => {
    // An empty value renders as nothing and reads as a missing word. It came
    // from splitting "Requires <code>scope</code> permission" into a prefix
    // and a suffix: every language whose grammar needs nothing after the code
    // element got "". The existing empty-value test only covered English and
    // German, so four locales carried one silently.
    const bad: string[] = [];
    for (const f of readdirSync('src/lib/i18n')) {
      const src = readFileSync(join('src/lib/i18n', f), 'utf8');
      for (const m of src.matchAll(/(\w+):\s*(''|"")/g)) bad.push(`${f}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});
