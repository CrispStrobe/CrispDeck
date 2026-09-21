/**
 * TESTING.md must list what the app actually has.
 *
 * deck.test.ts once asserted "supports all 14 column types" while the app had
 * grown to 20 — a hand-written list that went stale quietly, because nothing
 * ran it. A checklist for a day of manual testing fails the same way and
 * worse: you work through it, tick every box, and never see the six column
 * types it forgot to mention.
 *
 * So the file is generated from the source and this pins it there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLUMN_TYPES } from './deck-columns';
// @ts-expect-error — a plain .mjs generator, no types alongside it.
import { routes, shortcuts } from '../../scripts/testing-checklist.mjs';

const CHECKLIST = readFileSync(join(process.cwd(), 'TESTING.md'), 'utf-8');

describe('TESTING.md', () => {
  it('exists and is not a stub', () => {
    expect(CHECKLIST.length).toBeGreaterThan(1000);
  });

  it('lists every column type the app defines', () => {
    const missing = COLUMN_TYPES.filter((t) => !CHECKLIST.includes(`\`${t}\``));
    expect(missing, 'column types missing from TESTING.md').toEqual([]);
  });

  it('counts the column types correctly in its heading', () => {
    // The heading is what a reader trusts without counting the bullets.
    expect(CHECKLIST).toContain(`## Deck column types (${COLUMN_TYPES.length})`);
  });

  it('lists no column type the app has since removed', () => {
    const section = CHECKLIST.split('## Deck column types')[1]?.split('\n##')[0] ?? '';
    const listed = [...section.matchAll(/- \[ \] `([^`]+)`/g)].map((m) => m[1]);
    const unknown = listed.filter((t) => !(COLUMN_TYPES as readonly string[]).includes(t));
    expect(unknown, 'TESTING.md lists column types that no longer exist').toEqual([]);
  });

  it('lists every route the app serves', () => {
    // A route added without regenerating is a page a day of testing never
    // opens — which is exactly how a page ships broken.
    const missing = (routes() as string[]).filter((r) => !CHECKLIST.includes(`\`${r}\``));
    expect(missing, 'routes missing from TESTING.md').toEqual([]);
  });

  it('lists every keyboard shortcut the help dialog offers', () => {
    const all = (shortcuts() as Array<{ items: Array<{ key: string }> }>).flatMap((s) =>
      s.items.map((i) => i.key)
    );
    const missing = all.filter((k) => !CHECKLIST.includes(`\`${k}\``));
    expect(missing, 'shortcuts missing from TESTING.md').toEqual([]);
  });

  it('says how to regenerate itself', () => {
    // Without this someone edits it by hand, and the next regeneration
    // silently throws their edit away.
    expect(CHECKLIST).toContain('scripts/testing-checklist.mjs');
  });

  it('points at the log viewer, so a day of use leaves evidence', () => {
    expect(CHECKLIST).toMatch(/log viewer/i);
  });
});
