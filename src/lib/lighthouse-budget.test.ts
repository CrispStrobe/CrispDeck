import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// Plain .mjs build tooling; svelte-check reads its JSDoc types.
import { checkLighthouse, summarize, markdown } from '../../bench/check-lighthouse.mjs';

/**
 * Tests for the guard, not for the app's score.
 *
 * The thresholds it enforces came from measurement: four runs of the same
 * build on the loaded dev VPS scored performance 99, 99, 95, 97, while
 * accessibility, best-practices and SEO returned 100 every time. The first
 * CI-runner run scored 100 on all four. That split is the whole design — the
 * stable categories are held where they are, and performance gets a floor far
 * below the noise rather than a threshold inside it, until enough runner
 * samples exist to say what the runner's own range actually is.
 *
 * The failure worth guarding against is not a low score. It is a report that
 * says nothing — a page that never loaded, a run that produced no categories
 * — passing as green.
 */

const BUDGET = JSON.parse(readFileSync('bench/lighthouse-budget.json', 'utf8'));

function report(over: Record<string, unknown> = {}) {
  return {
    finalDisplayedUrl: 'http://localhost:4173/',
    categories: {
      performance: { score: 0.97 },
      accessibility: { score: 1 },
      'best-practices': { score: 1 },
      seo: { score: 1 },
    },
    audits: {
      'errors-in-console': { score: 1, title: 'No browser errors logged' },
      viewport: { score: 1, title: 'Has a viewport meta tag' },
      'html-has-lang': { score: 1, title: '<html> has a lang attribute' },
      'document-title': { score: 1, title: 'Document has a title' },
      'color-contrast': { score: 1, title: 'Contrast is sufficient' },
      'first-contentful-paint': { displayValue: '0.5 s' },
      'largest-contentful-paint': { displayValue: '0.7 s' },
      'total-blocking-time': { displayValue: '100 ms' },
      'cumulative-layout-shift': { displayValue: '0' },
      'speed-index': { displayValue: '0.5 s' },
    },
    ...over,
  };
}

describe('checkLighthouse', () => {
  it('passes a report like the one the app actually produces', () => {
    expect(checkLighthouse(report(), BUDGET)).toEqual([]);
  });

  it('refuses a report with no categories rather than passing it', () => {
    // The worst available outcome is a green guard that checked nothing.
    expect(checkLighthouse({ categories: {} }, BUDGET)).toEqual([
      'no categories in the report — Lighthouse did not produce a result',
    ]);
    expect(checkLighthouse({}, BUDGET)).toHaveLength(1);
  });

  it('reports a page Lighthouse could not load', () => {
    const r = report({ runtimeError: { code: 'NO_FCP', message: 'never painted' } });
    expect(checkLighthouse(r, BUDGET).join('\n')).toContain('NO_FCP');
  });

  it('fails a category that drops below its floor', () => {
    const r = report({
      categories: { ...report().categories, accessibility: { score: 0.8 } },
    });
    expect(checkLighthouse(r, BUDGET).join('\n')).toContain('accessibility scored 80, below the 95 floor');
  });

  it('fails a category the report omits', () => {
    const { seo, ...rest } = report().categories as Record<string, unknown>;
    expect(checkLighthouse(report({ categories: rest }), BUDGET).join('\n')).toContain('"seo" missing');
  });

  it('fails a category that was not scored at all', () => {
    const r = report({ categories: { ...report().categories, seo: { score: null } } });
    expect(checkLighthouse(r, BUDGET).join('\n')).toContain('"seo" was not scored');
  });

  it('fails a must-pass audit that regressed', () => {
    const r = report({
      audits: { ...report().audits, 'errors-in-console': { score: 0, title: 'Browser errors were logged' } },
    });
    expect(checkLighthouse(r, BUDGET).join('\n')).toContain('"errors-in-console" failed');
  });

  it('does not fail an audit the page gives nothing to judge', () => {
    // notApplicable is Lighthouse saying "no elements to check here", which is
    // not a regression — a page with no text has no contrast to get wrong.
    const r = report({
      audits: { ...report().audits, 'color-contrast': { score: null, scoreDisplayMode: 'notApplicable' } },
    });
    expect(checkLighthouse(r, BUDGET)).toEqual([]);
  });

  it('tolerates the performance noise it was measured against', () => {
    // Every score observed so far — the four dev-VPS runs and the first CI
    // run — none of which should ever fail the build.
    for (const score of [0.99, 0.99, 0.95, 0.97, 1]) {
      const r = report({ categories: { ...report().categories, performance: { score } } });
      expect(checkLighthouse(r, BUDGET), `performance ${score}`).toEqual([]);
    }
  });

  it('still catches a performance collapse', () => {
    const r = report({ categories: { ...report().categories, performance: { score: 0.4 } } });
    expect(checkLighthouse(r, BUDGET).join('\n')).toContain('performance scored 40');
  });
});

describe('the budget file', () => {
  it('gates every category the app reports', () => {
    expect(Object.keys(BUDGET.categories).sort()).toEqual(
      ['accessibility', 'best-practices', 'performance', 'seo'],
    );
  });

  it('keeps the performance floor below the observed noise', () => {
    // If someone raises this to "100 or bust", CI starts failing at random and
    // the job gets ignored, which costs more than the check is worth.
    expect(BUDGET.categories.performance).toBeLessThan(0.95);
  });
});

describe('summarize', () => {
  it('pulls the numbers a human reads in the job summary', () => {
    const s = summarize(report());
    expect(s.categories).toEqual({ performance: 97, accessibility: 100, 'best-practices': 100, seo: 100 });
    expect(s.metrics['Total Blocking Time']).toBe('100 ms');
  });

  it('says n/a rather than crashing on a metric the run did not collect', () => {
    expect(summarize({ categories: {}, audits: {} }).metrics['Speed Index']).toBe('n/a');
  });
});

describe('markdown', () => {
  it('renders the scores as a table the job summary can show', () => {
    const md = markdown(report());
    expect(md).toContain('| accessibility | **100** |');
    expect(md).toContain('| Total Blocking Time | 100 ms |');
  });

  it('says n/a rather than printing null for an unscored category', () => {
    const r = report({ categories: { performance: { score: null } } });
    expect(markdown(r)).toContain('| performance | n/a |');
  });
});
