import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * JSON.parse on a stored value, with nothing to catch it.
 *
 * A value in localStorage is not trustworthy input. Formats change between
 * versions, migrations get interrupted, people edit things by hand. Parsing
 * one without a guard turns any of that into a thrown SyntaxError.
 *
 * Where it throws decides how bad it is. +layout.svelte parsed a stored value
 * while the shell was initialising, outside any try/catch, so a single corrupt
 * entry meant every page failed to render — on every visit, with no way out
 * but clearing site data.
 *
 * readJson from $lib/safe-storage falls back instead, and records the
 * corruption through swallow() so a preference that silently reset can still
 * be explained afterwards.
 */

/** Implements the reading and writing itself. */
const ALLOWED = new Set(['src/lib/safe-storage.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * @returns one message per JSON.parse of a stored value with no guard
 *
 * Only flags a parse whose argument comes from storage — parsing an API
 * response inside a request's own try/catch is a different thing, and this
 * has no business reporting it.
 */
export function findUnguardedStorageParse(source: string, file = ''): string[] {
  const lines = source.split('\n');
  const offenders: string[] = [];

  lines.forEach((line, i) => {
    if (!line.includes('JSON.parse(')) return;
    const fromStorage =
      /JSON\.parse\(\s*localStorage\.getItem/.test(line) ||
      /JSON\.parse\(\s*sessionStorage\.getItem/.test(line);
    if (!fromStorage) return;

    // A try anywhere above in the same function would catch it. Looking back
    // 25 lines is coarse but errs towards reporting, which is the safe way
    // round for this one.
    const before = lines.slice(Math.max(0, i - 25), i).join('\n');
    if (/\btry\s*\{/.test(before)) return;

    offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 70)}`);
  });

  return offenders;
}

describe('findUnguardedStorageParse', () => {
  it('flags a bare parse of a stored value', () => {
    expect(findUnguardedStorageParse(`const x = JSON.parse(localStorage.getItem('k') ?? '[]');`))
      .toHaveLength(1);
  });

  it('accepts one inside a try', () => {
    const src = ['try {', "  const x = JSON.parse(localStorage.getItem('k'));", '} catch {}'].join('\n');
    expect(findUnguardedStorageParse(src)).toEqual([]);
  });

  it('accepts readJson', () => {
    expect(findUnguardedStorageParse(`const x = readJson('k', []);`)).toEqual([]);
  });

  it('ignores parsing something that did not come from storage', () => {
    // An API response parsed inside its own request handling is not this.
    expect(findUnguardedStorageParse(`const x = JSON.parse(await resp.text());`)).toEqual([]);
  });

  it('reports the line', () => {
    const src = `a\nconst x = JSON.parse(localStorage.getItem('k'));`;
    expect(findUnguardedStorageParse(src, 'f.ts')[0]).toContain('f.ts:2');
  });
});

describe('the source tree', () => {
  const files = sourceFiles('src');

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('parses no stored value without a guard', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const key = file.replace(/\\/g, '/');
      if (ALLOWED.has(key)) continue;
      offenders.push(...findUnguardedStorageParse(readFileSync(file, 'utf8'), key));
    }
    expect(
      offenders,
      `use readJson() from $lib/safe-storage — a corrupt value should reset a preference, not break the page:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * @returns one message per raw localStorage write
 *
 * setItem throws when the quota is full, and throws on *every* call in
 * Safari's private mode — so a caller that ignores it reports a save that did
 * not happen, which is the same shape of lie as an unchecked fetch.
 * writeJson/writeString return false instead.
 */
export function findRawStorageWrites(source: string, file = ''): string[] {
  const offenders: string[] = [];
  source.split('\n').forEach((line, i) => {
    if (/localStorage\.(setItem|removeItem)\s*\(/.test(line)) {
      offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 70)}`);
    }
  });
  return offenders;
}

describe('findRawStorageWrites', () => {
  it('flags a raw setItem', () => {
    expect(findRawStorageWrites("localStorage.setItem('k', 'v');")).toHaveLength(1);
  });

  it('flags a raw removeItem', () => {
    expect(findRawStorageWrites("localStorage.removeItem('k');")).toHaveLength(1);
  });

  it('accepts the helpers', () => {
    expect(findRawStorageWrites("writeJson('k', v); writeString('k', s); removeKey('k');")).toEqual([]);
  });

  it('does not flag a read', () => {
    expect(findRawStorageWrites("const v = localStorage.getItem('k');")).toEqual([]);
  });
});

describe('the source tree, writes', () => {
  const files = sourceFiles('src');

  it('writes to storage only through the helpers', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const key = file.replace(/\\/g, '/');
      if (ALLOWED.has(key)) continue;
      offenders.push(...findRawStorageWrites(readFileSync(file, 'utf8'), key));
    }
    expect(
      offenders,
      `use writeJson/writeString/removeKey from $lib/safe-storage — setItem throws on a full quota and on every call in Safari private mode:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
