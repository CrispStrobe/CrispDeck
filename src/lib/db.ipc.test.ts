/**
 * Guards the Tauri IPC boundary in db.ts.
 *
 * This module was written against Tauri v1, where a command's Rust argument
 * names were used verbatim from JS. Tauri v2 renames them to camelCase, so
 * every snake_case argument silently stopped matching — `db_add_account`,
 * `db_save_draft`, `auth_start_mastodon_oauth` and eleven others. Nothing
 * caught it: the browser build never calls invoke(), and the desktop build
 * only complains at the moment you use the feature.
 *
 * These tests read the Rust sources, so they fail if a command is renamed or
 * an argument is added on either side.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toCamelKey, toCamelArgs } from './db';

const TAURI_SRC = 'src-tauri/src';

/** Command names registered in the invoke_handler. */
function registeredCommands(): Set<string> {
  const lib = readFileSync(join(TAURI_SRC, 'lib.rs'), 'utf8');
  const block = lib.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!block) throw new Error('could not find generate_handler! in lib.rs');
  return new Set(
    block[1]
      .split(',')
      .map((s) => s.trim().split('::').pop() ?? '')
      .filter(Boolean),
  );
}

/** Command name -> declared argument names, excluding Tauri-injected ones. */
function commandArgs(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.rs') ? [join(dir, e.name)] : [],
    );
  for (const file of walk(TAURI_SRC)) {
    const src = readFileSync(file, 'utf8');
    const re = /#\[tauri::command[^\]]*\]\s*\npub (?:async )?fn (\w+)\s*\(([\s\S]*?)\)\s*->/g;
    for (const m of src.matchAll(re)) {
      const args = m[2]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/State\s*<|AppHandle|Window|^\/\//.test(l))
        .map((l) => l.split(':')[0].trim())
        .filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
      out.set(m[1], args);
    }
  }
  return out;
}

/** Command names invoked from db.ts. */
function invokedCommands(): string[] {
  const src = readFileSync('src/lib/db.ts', 'utf8');
  return [...src.matchAll(/invoke(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g)].map((m) => m[1]);
}

describe('toCamelKey', () => {
  it('converts snake_case argument names', () => {
    expect(toCamelKey('instance_url')).toBe('instanceUrl');
    expect(toCamelKey('owner_account_id')).toBe('ownerAccountId');
    expect(toCamelKey('bsky_follows')).toBe('bskyFollows');
  });

  it('leaves single words and already-camel names alone', () => {
    expect(toCamelKey('id')).toBe('id');
    expect(toCamelKey('text')).toBe('text');
    expect(toCamelKey('targetAccounts')).toBe('targetAccounts');
  });
});

describe('toCamelArgs', () => {
  it('renames top-level keys only, never values or nested keys', () => {
    const nested = { display_name: 'Alice', instance_url: 'https://x' };
    expect(toCamelArgs({ owner_account_id: 1, bsky_follows: [nested] })).toEqual({
      ownerAccountId: 1,
      // serde deserializes the inner struct by its Rust field names, which are
      // snake_case — renaming these too would break it.
      bskyFollows: [nested],
    });
  });

  it('passes undefined through', () => {
    expect(toCamelArgs(undefined)).toBeUndefined();
  });

  it('preserves null and false rather than dropping them', () => {
    expect(toCamelArgs({ is_primary: false, display_name: null })).toEqual({
      isPrimary: false,
      displayName: null,
    });
  });
});

describe('db.ts <-> Tauri commands', () => {
  const registered = registeredCommands();
  const args = commandArgs();
  const invoked = [...new Set(invokedCommands())];

  it('finds the Rust commands at all (guards the parser itself)', () => {
    expect(registered.size).toBeGreaterThan(10);
    expect(args.get('auth_start_mastodon_oauth')).toEqual(['instance_url']);
  });

  it('every command db.ts invokes is registered in the invoke_handler', () => {
    const unknown = invoked.filter((c) => !registered.has(c));
    expect(unknown).toEqual([]);
  });

  it('every command db.ts invokes exists in the Rust sources', () => {
    const missing = invoked.filter((c) => !args.has(c));
    expect(missing).toEqual([]);
  });

  it('no Rust command still declares a camelCase argument', () => {
    // The wrapper camelCases what db.ts sends, so a Rust arg that is already
    // camelCase would be renamed to something that does not exist.
    const offenders = [...args].filter(([, names]) => names.some((n) => /[A-Z]/.test(n)));
    expect(offenders).toEqual([]);
  });
});
