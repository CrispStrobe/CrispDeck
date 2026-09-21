import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fetch whose response nobody looks at.
 *
 * `fetch` rejects only on a network-level failure. A 401, a 403, a 422, a 500
 * all resolve normally — so a try/catch around a write says nothing about
 * whether the write happened. This is how "User blocked." appeared for an
 * action the instance refused, and how a direct message was echoed into the
 * thread after the server rejected it.
 *
 * Two shapes are unambiguous, and this pins both:
 *
 *   A. the response is discarded — `await fetch(...)` as a statement. If you
 *      did not keep it, you cannot have checked it.
 *   B. the response is assigned and the variable is never tested anywhere in
 *      the file.
 *
 * Deliberately not a "no bare fetch anywhere" rule: most of the ~100 fetch
 * calls here do check, and an allowlist of ninety entries would be a guard
 * that guards nothing. Use fetchOk/fetchJson from $lib/http for new code.
 *
 * Rule B is conservative by design. It searches the whole file, so a common
 * variable name checked in a different function counts as checked — it misses
 * some, rather than reporting things that are fine.
 */

/** Implements the reporting itself. */
const ALLOWED = new Set(['src/lib/http.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** @returns one message per offending site */
export function findUncheckedFetches(source: string, file = ''): string[] {
  const lines = source.split('\n');
  const offenders: string[] = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.includes('fetchOk') || line.includes('fetchJson')) return;

    // A — a statement whose value goes nowhere.
    //
    // Keyed on the statement boundary before the call rather than on the call
    // starting a line: `const f = async () => { await fetch(url); };` has the
    // fetch mid-line, and an earlier version that required a line start
    // missed it. Found by planting one, after the icon-label guard turned out
    // to be blind to 24 buttons for a comparable reason.
    const call = /(^|[{};]|=>)\s*(?:await\s+|void\s+)?fetch\(/.exec(line);
    if (call) {
      // Not an assignment or an argument: `= fetch(`, `(fetch(`, `, fetch(`
      // and `return fetch(` all hand the response to someone.
      //
      // When nothing precedes the call on its own line, the context is on the
      // line above — Promise.all([ opens on one line and the calls follow on
      // the next, and treating those as discarded was the first fix's mistake.
      let before = line.slice(0, call.index + call[0].length - 'fetch('.length);
      if (!before.trim()) {
        for (let j = i - 1; j >= 0; j--) {
          if (lines[j].trim()) { before = lines[j].trimEnd(); break; }
        }
      }
      const consumed = /[=([,]\s*(?:await\s+|void\s+)?$|\breturn\s+(?:await\s+)?$|=>\s*$/.test(before);
      if (!consumed) {
        offenders.push(`${file}:${i + 1}: response discarded — ${line.trim().slice(0, 60)}`);
        return;
      }
    }

    // B — assigned but never tested.
    const assigned = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?fetch\(/.exec(line);
    if (assigned) {
      const name = assigned[1];
      const tested = new RegExp(`\\b${name}\\.(ok|status)\\b`).test(source);
      if (!tested) {
        offenders.push(`${file}:${i + 1}: ${name}.ok is never checked`);
      }
    }
  });

  return offenders;
}

describe('findUncheckedFetches', () => {
  it('flags a discarded response inside a single-line arrow body', () => {
    // The shape the line-start rule missed.
    expect(
      findUncheckedFetches('const f = async () => { await fetch(url, { method: "POST" }); };'),
    ).toHaveLength(1);
  });

  it('flags a discarded response', () => {
    expect(findUncheckedFetches('async function f() {\n  await fetch(url, { method: "POST" });\n}'))
      .toHaveLength(1);
  });

  it('flags a response that is assigned and never tested', () => {
    expect(findUncheckedFetches('const resp = await fetch(url);\nconst body = await resp.json();'))
      .toHaveLength(1);
  });

  it('accepts a response whose status is checked', () => {
    expect(findUncheckedFetches('const resp = await fetch(url);\nif (!resp.ok) throw new Error("x");'))
      .toEqual([]);
  });

  it('accepts .status instead of .ok', () => {
    expect(findUncheckedFetches('const r = await fetch(url);\nif (r.status !== 200) return;'))
      .toEqual([]);
  });

  it('does not flag a fetch inside Promise.all, where the caller collects it', () => {
    const src = [
      'const [a, b] = await Promise.all([',
      '  fetch(one),',
      '  fetch(two),',
      ']);',
      'if (a.ok && b.ok) use();',
    ].join('\n');
    expect(findUncheckedFetches(src)).toEqual([]);
  });

  it('does not flag a returned fetch — the caller owns the response', () => {
    expect(findUncheckedFetches('function f() {\n  return fetch(url);\n}')).toEqual([]);
  });

  it('ignores calls that already go through the checked helpers', () => {
    expect(findUncheckedFetches('await fetchOk(url, { method: "POST" });')).toEqual([]);
    expect(findUncheckedFetches('const x = await fetchJson(url);')).toEqual([]);
  });
});

describe('the source tree', () => {
  const files = sourceFiles('src');

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no fetch whose response nobody looks at', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const key = file.replace(/\\/g, '/');
      if (ALLOWED.has(key)) continue;
      offenders.push(...findUncheckedFetches(readFileSync(file, 'utf8'), key));
    }
    expect(
      offenders,
      `fetch does not throw on 4xx/5xx. Use fetchOk/fetchJson from $lib/http, or check .ok:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    for (const file of ALLOWED) {
      expect(/(?<!\w)fetch\(/.test(readFileSync(file, 'utf8')), `${file} no longer needs its exemption`).toBe(true);
    }
  });
});
