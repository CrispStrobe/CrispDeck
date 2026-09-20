import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two ways untrusted content reaches the page, both pinned here.
 *
 * 1. `{@html ...}` renders markup verbatim. Every source of it in this app is
 *    remote — a Mastodon status, an instance announcement, an instance
 *    description — so it has to be sanitized first. The announcement on the
 *    notifications page was not, and instance admins write those.
 *
 * 2. A URL from a server placed in an href. Escaping it stops it breaking out
 *    of the attribute and does nothing about the scheme: `javascript:alert(1)`
 *    is perfectly well-formed markup that runs on click. Nine template
 *    bindings took a remote URL straight into an href.
 */

const SANITIZERS = ['sanitizeHtml', 'injectCustomEmoji', 'DOMPurify'];
const URL_HELPERS = ['hrefOrHash', 'safeExternalUrl'];
/** href expressions naming one of these are remote-derived. */
const REMOTE = /\b(uri|url|link|website)\b/i;

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) svelteFiles(path, out);
    else if (name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

/**
 * @returns one message per `{@html}` whose value is not demonstrably sanitized
 *
 * Follows a bare identifier to where it is defined in the same file, and then
 * into a local builder function it calls: Post.svelte renders
 * `{@html bskyHtml}` where bskyHtml is `$derived(getBskyHtml())` and
 * getBskyHtml escapes every segment it assembles. Only looking at the
 * expression inside the braces would report both of those as raw.
 */
export function findRawHtml(source: string, file = ''): string[] {
  const offenders: string[] = [];

  /** Does this text show evidence of sanitizing or escaping? */
  const isSafe = (text: string) =>
    SANITIZERS.some((s) => text.includes(s)) || /escapeHtml\(/.test(text);

  /** The right-hand side of `const <name> = ...`, up to the line's end. */
  const definitionOf = (name: string) => {
    const re = new RegExp(`(?:const|let)\\s+${name}\\s*=([\\s\\S]{0,400})`);
    return re.exec(source)?.[1] ?? '';
  };

  /** The body of a local `function <name>()`, so a builder can be inspected. */
  const bodyOf = (name: string) => {
    const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
    if (start === -1) return '';
    return source.slice(start, start + 2500);
  };

  for (const match of source.matchAll(/\{@html\s+([^}]+)\}/g)) {
    const expr = match[1].trim();
    const line = source.slice(0, match.index).split('\n').length;

    if (isSafe(expr)) continue;

    // A bare identifier: follow it to its definition, and one step further
    // into any local function that definition calls.
    if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
      const definition = definitionOf(expr);
      if (isSafe(definition)) continue;
      const called = [...definition.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
      if (called.some((fn) => isSafe(bodyOf(fn)))) continue;
    }

    offenders.push(`${file}:${line}: {@html ${expr.slice(0, 40)}} is not sanitized`);
  }
  return offenders;
}

/** @returns one message per href bound to an unchecked remote URL */
export function findUncheckedHrefs(source: string, file = ''): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(/href=\{([^}]{1,80})\}/g)) {
    const expr = match[1];
    if (!REMOTE.test(expr)) continue;             // an internal route
    if (expr.includes('base')) continue;          // built from $app/paths
    if (URL_HELPERS.some((h) => expr.includes(h))) continue;
    const line = source.slice(0, match.index).split('\n').length;
    offenders.push(`${file}:${line}: href={${expr.trim()}} has no scheme check`);
  }
  return offenders;
}

describe('findRawHtml', () => {
  it('flags an unsanitized block', () => {
    expect(findRawHtml('<div>{@html ann.content}</div>')).toHaveLength(1);
  });

  it('accepts one that goes through the sanitizer', () => {
    expect(findRawHtml('<div>{@html sanitizeHtml(ann.content)}</div>')).toEqual([]);
  });

  it('accepts the emoji path, which sanitizes before injecting', () => {
    expect(findRawHtml('{@html injectCustomEmoji(sanitizeHtml(x), e)}')).toEqual([]);
  });

  it('reports the line', () => {
    expect(findRawHtml('a\n{@html x}', 'f.svelte')[0]).toContain('f.svelte:2');
  });

  it('follows an identifier to a sanitized definition', () => {
    const src = `const mastodonHtml = $derived.by(() => sanitizeHtml(getHtml()));\n{@html mastodonHtml}`;
    expect(findRawHtml(src)).toEqual([]);
  });

  it('follows an identifier into a builder that escapes', () => {
    // Post.svelte's bskyHtml: $derived(getBskyHtml()), and that function
    // escapes every segment it assembles.
    const src = [
      'function getBskyHtml() { let r = ""; r += escapeHtml(segment); return r; }',
      'const bskyHtml = $derived(getBskyHtml());',
      '{@html bskyHtml}',
    ].join('\n');
    expect(findRawHtml(src)).toEqual([]);
  });

  it('still flags an identifier whose definition does nothing safe', () => {
    const src = `const raw = $derived(post.content);\n{@html raw}`;
    expect(findRawHtml(src)).toHaveLength(1);
  });
});

describe('findUncheckedHrefs', () => {
  it('flags a remote URL in an href', () => {
    expect(findUncheckedHrefs('<a href={card.url}>x</a>')).toHaveLength(1);
  });

  it('accepts one wrapped in the helper', () => {
    expect(findUncheckedHrefs('<a href={hrefOrHash(card.url)}>x</a>')).toEqual([]);
  });

  it('ignores an internal route built from base', () => {
    expect(findUncheckedHrefs('<a href={`${base}/profile?handle=${h}`}>x</a>')).toEqual([]);
  });

  it('ignores an href that is not remote-derived', () => {
    expect(findUncheckedHrefs('<a href={anchorId}>x</a>')).toEqual([]);
  });
});

describe('the components', () => {
  const files = svelteFiles('src');

  it('finds the components', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('sanitizes every {@html}', () => {
    const offenders = files.flatMap((f) => findRawHtml(readFileSync(f, 'utf8'), f.replace(/\\/g, '/')));
    expect(
      offenders,
      `every source of HTML here is remote — wrap it in sanitizeHtml():\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('checks the scheme of every remote URL used as an href', () => {
    const offenders = files.flatMap((f) => findUncheckedHrefs(readFileSync(f, 'utf8'), f.replace(/\\/g, '/')));
    expect(
      offenders,
      `use hrefOrHash() from $lib/safe-url — escaping does not stop javascript::\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
