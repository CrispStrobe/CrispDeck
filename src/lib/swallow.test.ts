/**
 * swallow() — recording errors the app deliberately continues past.
 *
 * Partial failure is normal here: one instance is down, one token expired, one
 * of eight deck columns 404s. Catching those is right; discarding them left
 * nothing to look at when a column came up empty. They now land in the same
 * ring buffer the log viewer in Settings reads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { swallow, getLogs, clearLogs, getLogsByLevel } from './debug-log';

beforeEach(() => clearLogs());

describe('swallow', () => {
  it('records the error message against its context', () => {
    swallow('deck.loadColumn', new Error('instance unreachable'));
    const [entry] = getLogs();
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'instance unreachable',
      source: 'deck.loadColumn',
    });
  });

  it('files under warn, not error — the app carried on', () => {
    swallow('feed.checkForNewPosts', new Error('429'));
    expect(getLogsByLevel('warn')).toHaveLength(1);
    expect(getLogsByLevel('error')).toHaveLength(0);
  });

  it('timestamps the entry', () => {
    swallow('ctx', new Error('x'));
    expect(Date.parse(getLogs()[0].timestamp)).not.toBeNaN();
  });

  it('accepts anything thrown, not just Errors', () => {
    swallow('ctx', 'a bare string');
    swallow('ctx', 404);
    swallow('ctx', undefined);
    // getLogs() is newest-first, which is the order the log viewer shows.
    expect(getLogs().map(l => l.message)).toEqual(['undefined', '404', 'a bare string']);
  });

  it('falls back to the error name when the message is empty', () => {
    const e = new Error('');
    e.name = 'AbortError';
    swallow('ctx', e);
    expect(getLogs()[0].message).toBe('AbortError');
  });

  it('keeps one entry per failure, so a retry loop is visible', () => {
    for (let i = 0; i < 3; i++) swallow('deck.loadColumn', new Error(`attempt ${i}`));
    expect(getLogs()).toHaveLength(3);
  });

  it('never throws, whatever it is handed', () => {
    const hostile = { get message() { throw new Error('boom'); } };
    expect(() => swallow('ctx', hostile)).not.toThrow();
  });

  it('never throws when the buffer itself fails', () => {
    // A logging failure must not become the caller's failure.
    const spy = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      throw new Error('clock unavailable');
    });
    expect(() => swallow('ctx', new Error('x'))).not.toThrow();
    spy.mockRestore();
  });
});

describe('the contexts used across the app', () => {
  it('every swallow call names a context', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|svelte)$/.test(p) && !p.includes('.test.')) out.push(p);
      }
      return out;
    };
    const bad: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      // Skip the declaration itself, which lives with the implementation.
      if (file.endsWith('debug-log.ts')) continue;
      // Comments are stripped first. Prose mentioning swallow() kept being
      // read as a call: first across a line break, then — once that was
      // fixed — from a single-line docblock that happened to contain a comma.
      // Matching source with a regex means comments have to go, not just be
      // narrowly avoided.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const m of code.matchAll(/swallow\(\s*([^,\n]*),/g)) {
        const arg = m[1].trim();
        // A literal, non-empty context: a bare variable would be useless in
        // the log. A template literal counts as long as it opens with static
        // text — `deck.rss:${col.query}` reads in the log viewer as exactly
        // the column that failed, which is better than a fixed string, while
        // `${whatever}` alone is just as opaque as a variable.
        const plain = /^'[^']+'$/.test(arg);
        const template = /^`[^`$]+/.test(arg) && arg.endsWith('`');
        if (!plain && !template) bad.push(`${file}: swallow(${arg}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no empty catch blocks remain outside tests', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|svelte)$/.test(p) && !p.includes('.test.')) out.push(p);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      // An intentionally empty catch should say so with a comment.
      for (const m of src.matchAll(/catch\s*(?:\([A-Za-z_$][\w$]*\))?\s*\{\s*\}/g)) {
        offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
