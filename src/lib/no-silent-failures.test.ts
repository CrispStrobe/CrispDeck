import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A failure that reaches only the console is invisible.
 *
 * The user sees an empty list, an unchanged button, or a "done" message, with
 * no way to tell a quiet account from a broken one — and no way to report it,
 * because a phone has no devtools. Every failure path must instead go through
 * swallow(), which files it in the ring buffer the log viewer in Settings
 * reads, and raise a toast when the user started the action that failed.
 *
 * swallow() still mirrors the error to the console outside tests, so a
 * developer loses nothing by the switch.
 *
 * This guard pins that: the source carries no console.error/warn outside
 * debug-log.ts, which implements the reporting itself.
 */

/** The module that *is* the reporting mechanism. */
const ALLOWED = new Set(['src/lib/debug-log.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('no console-only failure paths', () => {
  const files = sourceFiles('src');

  it('finds the source tree', () => {
    // A path typo would make every assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no console.error or console.warn outside the reporting modules', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file.replace(/\\/g, '/'))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/console\.(error|warn)\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `Use swallow('<context>', e) instead, and add a toast if the user started the action:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // An entry that no longer needs the exemption should be removed rather
    // than left behind granting a licence nobody is using.
    for (const file of ALLOWED) {
      const src = readFileSync(file, 'utf8');
      expect(/console\.(error|warn)\s*\(/.test(src), `${file} no longer needs its exemption`).toBe(true);
    }
  });
});
