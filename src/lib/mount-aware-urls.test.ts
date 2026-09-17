import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against app URLs built from the origin alone.
 *
 * A project-page deployment serves the app under /<repo>/, so
 * `${window.location.origin}/oauth/callback` points at a path that does not
 * exist there. Three of these survived the base-path work and were only found
 * later: the Threads callback, the hint telling the user which callback to
 * register, and Mastodon's — which is worse than the others, because the
 * instance stores the redirect URI when the app registers, so a wrong one is
 * baked into the registration rather than rejected at sign-in.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|svelte)$/.test(p) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

describe('URLs into our own app include the mount point', () => {
  it('no origin-only app path is constructed anywhere', () => {
    // `${origin}/something` is only safe when followed by ${base}.
    const bad: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/window\.location\.origin\s*\}?([`'"]?)\s*\/[a-z]/gi)) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`  ${file}:${line}  ${src.slice(m.index!, m.index! + 60).split('\n')[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the OAuth callbacks specifically go through base', () => {
    const settings = readFileSync('src/routes/settings/+page.svelte', 'utf8');
    expect(settings).toMatch(/\$\{window\.location\.origin\}\$\{base\}\/oauth\/threads-callback/);
    const db = readFileSync('src/lib/browser-db.ts', 'utf8');
    expect(db).toMatch(/\$\{window\.location\.origin\}\$\{base\}\/oauth\/callback/);
  });

  it('our own API calls go through apiUrl, not the raw origin', () => {
    // Pages has no /api of its own; apiUrl is what redirects those to Vercel.
    const fb = readFileSync('src/lib/feed-builder.ts', 'utf8');
    expect(fb).toMatch(/apiUrl\('\/api\/feed'\)/);
    expect(fb).not.toMatch(/window\.location\.origin\}\/api/);
  });
});
