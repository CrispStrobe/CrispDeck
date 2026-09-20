import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * A duplicate key in an object literal is silently legal: the last one wins
 * and the earlier one is dead text. Nothing else catches it —
 * i18n-completeness.test.ts imports the modules and diffs the *objects*, by
 * which point the duplicate has already collapsed into one key.
 *
 * This is not hypothetical. Adding profile.blocked and profile.muted here
 * created exactly that: `profile` already had both (holding the old
 * "User blocked." sentences), so eight new keys shipped with two of them
 * shadowed. Whichever value lost would simply never render, and a translator
 * editing the dead one would see no effect.
 *
 * The check is a brace walk rather than a regex over the whole file: locale
 * files put an entire group on one line, and values contain braces and
 * apostrophes ("Impossible d'ouvrir", "{count} posts").
 */

/** Keys declared more than once in the same object, as dotted paths. */
export function findDuplicateKeys(source: string): string[] {
  const duplicates: string[] = [];
  const seen: Array<Set<string>> = [new Set()];
  const path: string[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    // Skip strings, including escapes, so apostrophes and braces inside
    // translated text are never read as structure.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }

    // Skip comments, which may contain anything at all.
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2);
      i = i === -1 ? source.length : i + 2;
      continue;
    }

    if (c === '{') {
      seen.push(new Set());
      i++;
      continue;
    }
    if (c === '}') {
      if (seen.length > 1) seen.pop();
      if (path.length) path.pop();
      i++;
      continue;
    }

    const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(source.slice(i));
    const boundary = i === 0 || '{,\n \t'.includes(source[i - 1]);
    if (match && boundary) {
      const key = match[1];
      const rest = source.slice(i + match[0].length).trimStart();
      const opensObject = rest.startsWith('{');
      const scope = seen[seen.length - 1];

      if (scope.has(key)) duplicates.push([...path, key].join('.'));
      scope.add(key);

      i += match[0].length;
      if (opensObject) {
        path.push(key);
        // Let the '{' branch push the new scope on the next pass.
        i += rest.length ? source.slice(i).indexOf('{') : 0;
      }
      continue;
    }

    i++;
  }
  return duplicates;
}

const FILES = [
  'src/lib/i18n.svelte.ts',
  ...readdirSync('src/lib/i18n').filter((f) => f.endsWith('.ts')).map((f) => `src/lib/i18n/${f}`),
];

describe('findDuplicateKeys', () => {
  it('finds a duplicate in the same object', () => {
    expect(findDuplicateKeys(`const x = { a: '1', b: '2', a: '3' };`)).toEqual(['a']);
  });

  it('does not flag the same name in different objects', () => {
    // profile.mute and moderation.mute are both legitimate.
    expect(findDuplicateKeys(`const x = { one: { m: '1' }, two: { m: '2' } };`)).toEqual([]);
  });

  it('reports the path so the offender is findable', () => {
    expect(findDuplicateKeys(`const x = { sec: { a: '1', a: '2' } };`)).toEqual(['sec.a']);
  });

  it('is not fooled by braces inside a translated value', () => {
    expect(findDuplicateKeys(`const x = { a: '{count} posts', b: 'x' };`)).toEqual([]);
  });

  it('is not fooled by an apostrophe inside a value', () => {
    expect(findDuplicateKeys(`const x = { a: "Impossible d'ouvrir", b: 'y' };`)).toEqual([]);
  });

  it('is not fooled by a key name appearing inside a comment', () => {
    expect(findDuplicateKeys(`const x = { a: '1', /* a: '2' */ b: '3' };`)).toEqual([]);
  });

  it('handles a whole group written on one line, as the locale files do', () => {
    expect(findDuplicateKeys(`const x = { sec: { a: '1', b: '2', c: '3', a: '4' } };`)).toEqual(['sec.a']);
  });
});

describe('the translation files', () => {
  it('lists every locale', () => {
    // A path typo would make the assertion below pass by checking nothing.
    expect(FILES.length).toBe(8);
  });

  for (const file of FILES) {
    it(`${file} declares no key twice`, () => {
      const dupes = findDuplicateKeys(readFileSync(file, 'utf8'));
      expect(
        dupes,
        `these keys are declared twice; the earlier value is dead text:\n  ${dupes.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
