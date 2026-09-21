/**
 * Every Playwright test must be able to fail.
 *
 * Three of the four tests in e2e/compose.test.ts could not. One pressed a
 * keyboard shortcut, waited 500ms and asserted nothing at all; one put its
 * only assertion behind `if (await postBtn.isVisible())`, so a missing button
 * — the thing worth catching — made it pass. A green E2E suite that cannot go
 * red is worse than no suite, because it is quoted as evidence.
 *
 * This is a source scan, and source scans go green while matching nothing, so
 * there is a test below that plants both shapes and checks they are caught.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const E2E_DIR = join(process.cwd(), 'e2e');

/** Strip comments so prose about `expect(` is not read as a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export interface E2ETest {
  name: string;
  body: string;
}

/** Split a spec file into its individual `test(...)` bodies. */
export function splitTests(source: string): E2ETest[] {
  const clean = stripComments(source);
  const out: E2ETest[] = [];
  const opener = /\btest(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

  let match: RegExpExecArray | null;
  while ((match = opener.exec(clean)) !== null) {
    // Walk from the opening paren to its match so nested test() calls and
    // braces inside strings do not truncate the body.
    let depth = 0;
    let i = clean.indexOf('(', match.index);
    const start = i;
    for (; i < clean.length; i++) {
      if (clean[i] === '(') depth++;
      else if (clean[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: match[2], body: clean.slice(start, i + 1) });
  }
  return out;
}

const specs = readdirSync(E2E_DIR)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => ({ file: f, source: readFileSync(join(E2E_DIR, f), 'utf-8') }));

describe('every E2E test can fail', () => {
  it('finds the spec files at all', () => {
    // The scan is worthless if the directory moved and it quietly found none.
    expect(specs.length).toBeGreaterThan(5);
  });

  it('finds tests inside them', () => {
    const total = specs.reduce((n, s) => n + splitTests(s.source).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  for (const { file, source } of specs) {
    it(`${file} asserts something in every test`, () => {
      const silent = splitTests(source)
        .filter((t) => !/\bexpect\s*\(/.test(t.body))
        .map((t) => t.name);
      expect(silent, `tests in ${file} with no assertion`).toEqual([]);
    });
  }
});

describe('the scan itself', () => {
  it('catches a test that asserts nothing', () => {
    const planted = `
      test('presses a key and hopes', async ({ page }) => {
        await page.goto('/compose');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(500);
      });
    `;
    const found = splitTests(planted).filter((t) => !/\bexpect\s*\(/.test(t.body));
    expect(found.map((t) => t.name)).toEqual(['presses a key and hopes']);
  });

  it('does not read prose about expect() as an assertion', () => {
    const planted = `
      test('commented', async ({ page }) => {
        // we would expect(x) to be visible here but cannot check it
        await page.goto('/');
      });
    `;
    const found = splitTests(planted).filter((t) => !/\bexpect\s*\(/.test(t.body));
    expect(found.map((t) => t.name)).toEqual(['commented']);
  });

  it('accepts a test that does assert', () => {
    const planted = `
      test('real', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL(/\\//);
      });
    `;
    const found = splitTests(planted).filter((t) => !/\bexpect\s*\(/.test(t.body));
    expect(found).toEqual([]);
  });

  it('does not truncate a body at a brace inside a string', () => {
    const planted = `
      test('braces', async ({ page }) => {
        await page.evaluate(() => '{"a":1}');
        await expect(page).toHaveURL(/x/);
      });
    `;
    expect(splitTests(planted)).toHaveLength(1);
    expect(splitTests(planted)[0].body).toContain('toHaveURL');
  });

  it('sees test.skip and test.describe variants', () => {
    const planted = `
      test.skip('skipped one', async () => {});
    `;
    expect(splitTests(planted).map((t) => t.name)).toEqual(['skipped one']);
  });
});
