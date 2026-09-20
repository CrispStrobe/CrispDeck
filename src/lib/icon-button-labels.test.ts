import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A button whose only content is an icon needs an accessible name.
 *
 * Sighted users read the glyph; a screen reader announces "button" and
 * nothing else. Lighthouse's button-name audit catches it, but only on a page
 * it actually visits — the calendar's month arrows sat unlabelled because CI
 * only ever scored the logged-out dashboard, where they do not appear.
 *
 * Text inside the button counts as a name, so this only looks at buttons
 * whose sole child is a component element.
 */

// \w* not \w+: lucide's close icon is a single character, <X />, and a
// pattern needing two would skip every close button in the app.
const ICON_ONLY = /<button\b([^>]*)>\s*<([A-Z]\w*)\s[^>]*\/>\s*<\/button>/gs;

/** @returns one message per unlabelled icon-only button */
export function findUnlabelledIconButtons(source: string, file = ''): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(ICON_ONLY)) {
    const attrs = match[1];
    const named = /aria-label[=\s]|aria-labelledby[=\s]|title=/.test(attrs);
    if (named) continue;
    const line = source.slice(0, match.index).split('\n').length;
    offenders.push(`${file}:${line}: <${match[2]}> button has no accessible name`);
  }
  return offenders;
}

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) svelteFiles(path, out);
    else if (name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

describe('findUnlabelledIconButtons', () => {
  it('flags an icon-only button with no label', () => {
    expect(findUnlabelledIconButtons('<button onclick={x}><ChevronLeft size={18} /></button>'))
      .toHaveLength(1);
  });

  it('flags a single-letter icon component too', () => {
    // <X /> is lucide's close icon and appears on most dialogs here.
    expect(findUnlabelledIconButtons('<button onclick={close}><X size={16} /></button>'))
      .toHaveLength(1);
  });

  it('accepts one with aria-label', () => {
    expect(findUnlabelledIconButtons('<button aria-label={t.next}><ChevronRight size={18} /></button>'))
      .toEqual([]);
  });

  it('accepts one with title', () => {
    expect(findUnlabelledIconButtons('<button title="Refresh"><RefreshCw size={12} /></button>'))
      .toEqual([]);
  });

  it('accepts aria-labelledby', () => {
    expect(findUnlabelledIconButtons('<button aria-labelledby="h1"><X size={12} /></button>')).toEqual([]);
  });

  it('ignores a button that also has text — the text is the name', () => {
    expect(findUnlabelledIconButtons('<button><Search size={14} /> Search</button>')).toEqual([]);
  });

  it('reports the line so the button is findable', () => {
    const src = 'line one\n<button><X size={1} /></button>';
    expect(findUnlabelledIconButtons(src, 'a.svelte')[0]).toContain('a.svelte:2');
  });
});

describe('the components', () => {
  const files = svelteFiles('src');

  it('finds the components', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no icon-only button without an accessible name', () => {
    const offenders = files.flatMap((f) =>
      findUnlabelledIconButtons(readFileSync(f, 'utf8'), f.replace(/\\/g, '/')),
    );
    expect(
      offenders,
      `add aria-label (translated) so screen readers announce more than "button":\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
