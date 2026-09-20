// Enforce bench/lighthouse-budget.json against a Lighthouse JSON report.
//
// Split from the run itself for the same reason check-budget.mjs is: the
// logic is then importable, and a guard nobody has watched fail is not a
// guard. See the budget file for why the performance score is gated with a
// floor rather than a threshold.

import { readFileSync } from 'node:fs';

/**
 * Merge the global category floors with a route's own overrides.
 *
 * A route floor is set at what that route scores today, so CI locks in "no
 * worse" while the remaining debt stays visible instead of being averaged
 * into a single number that hides which page is the problem.
 *
 * @param {any} budget
 * @param {string} [routePath]
 * @returns {Record<string, number>}
 */
export function floorsFor(budget, routePath) {
  const route = (budget.routes ?? []).find((/** @type {any} */ r) => r.path === routePath);
  return { ...(budget.categories ?? {}), ...(route?.categories ?? {}) };
}

/**
 * @param {any} report  a Lighthouse JSON report
 * @param {any} budget  a lighthouse-budget.json
 * @param {string} [routePath]  which route this report is for
 * @returns {string[]} one message per violation; empty means within budget
 */
export function checkLighthouse(report, budget, routePath) {
  const failures = [];

  // A report with no categories would let every threshold below pass by
  // knowing nothing — the same vacuous-green failure check-budget.mjs guards
  // against. Lighthouse also emits a top-level runtimeError for a page it
  // could not load at all, and that report still carries scores of zero.
  if (!report?.categories || Object.keys(report.categories).length === 0) {
    return ['no categories in the report — Lighthouse did not produce a result'];
  }
  if (report.runtimeError?.code) {
    failures.push(`Lighthouse runtime error: ${report.runtimeError.code} ${report.runtimeError.message ?? ''}`.trim());
  }

  for (const [name, min] of Object.entries(floorsFor(budget, routePath))) {
    const cat = report.categories[name];
    if (!cat) {
      failures.push(`category "${name}" missing from the report`);
      continue;
    }
    if (cat.score === null) {
      failures.push(`category "${name}" was not scored`);
      continue;
    }
    if (cat.score < min) {
      failures.push(
        `${routePath ? routePath + ': ' : ''}${name} scored ${Math.round(cat.score * 100)}, ` +
        `below the ${Math.round(Number(min) * 100)} floor`,
      );
    }
  }

  for (const id of budget.mustPass ?? []) {
    const audit = report.audits?.[id];
    if (!audit) {
      failures.push(`audit "${id}" missing from the report`);
      continue;
    }
    // notApplicable means the page has nothing for the audit to judge, which
    // is a pass. informative audits carry no score and cannot fail.
    if (audit.scoreDisplayMode === 'notApplicable' || audit.scoreDisplayMode === 'informative') continue;
    if (audit.score !== 1) {
      failures.push(`${routePath ? routePath + ': ' : ''}audit "${id}" failed: ${audit.title ?? id}`);
    }
  }

  return failures;
}

/**
 * Pull the numbers worth printing in a job summary.
 * @param {any} report  a Lighthouse JSON report
 */
export function summarize(report) {
  /** @param {string} id */
  const metric = (id) => report.audits?.[id]?.displayValue ?? 'n/a';
  return {
    url: report.finalDisplayedUrl ?? report.requestedUrl,
    categories: Object.fromEntries(
      Object.entries(report.categories ?? {}).map(([k, c]) => [k, c.score === null ? null : Math.round(c.score * 100)]),
    ),
    metrics: {
      'First Contentful Paint': metric('first-contentful-paint'),
      'Largest Contentful Paint': metric('largest-contentful-paint'),
      'Total Blocking Time': metric('total-blocking-time'),
      'Cumulative Layout Shift': metric('cumulative-layout-shift'),
      'Speed Index': metric('speed-index'),
    },
  };
}

/**
 * Render a summary as the markdown a GitHub job summary renders.
 * @param {any} report  a Lighthouse JSON report
 * @param {string} [routePath]
 */
export function markdown(report, routePath) {
  const s = summarize(report);
  const out = [
    `**${routePath ?? s.url}** — desktop preset.`,
    '',
    '| category | score |',
    '|---|---|',
    ...Object.entries(s.categories).map(([k, v]) => `| ${k} | ${v === null ? 'n/a' : `**${v}**`} |`),
    '',
    '| metric | |',
    '|---|---|',
    ...Object.entries(s.metrics).map(([k, v]) => `| ${k} | ${v} |`),
    '',
  ];
  return out.join('\n');
}

// CLI:
//   node bench/check-lighthouse.mjs <budget.json> <report.json>...
//   node bench/check-lighthouse.mjs <budget.json> <report.json>... --markdown
//
// Each report file is named lighthouse<slug>.json, where the slug encodes the
// route it covers (lighthouse.json for "/", lighthouse-about.json for
// "/about"), so one invocation can check every route in a run.
//
// --markdown only renders; it never gates. The budget run is what fails the
// build, so a formatting problem in a summary cannot turn a passing job red
// (and, just as importantly, cannot turn a failing one green).

/**
 * lighthouse-about.json -> /about ; lighthouse.json -> /
 * @param {string} file
 */
export function routeFromFilename(file) {
  const base = file.replace(/^.*[/\\]/, '').replace(/\.json$/, '');
  const slug = base.replace(/^lighthouse-?/, '');
  return slug ? `/${slug.replace(/-/g, '/')}` : '/';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const asMarkdown = args.includes('--markdown');
  const [budgetPath, ...reportPaths] = args.filter((a) => !a.startsWith('--'));
  const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));

  if (!reportPaths.length) {
    console.error('no Lighthouse reports given — the run produced nothing to check');
    process.exit(1);
  }

  const failures = [];
  const rendered = [];

  for (const path of reportPaths) {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const route = routeFromFilename(path);
    if (asMarkdown) {
      rendered.push(markdown(report, route));
    } else {
      console.log(`\n=== ${route}`);
      console.log(JSON.stringify(summarize(report), null, 2));
      failures.push(...checkLighthouse(report, budget, route));
    }
  }

  if (asMarkdown) {
    console.log('### Lighthouse\n');
    console.log(rendered.join('\n\n'));
    console.log(
      '\n> The performance score moved between 95 and 99 across four runs of one\n' +
      '> unchanged build on a loaded dev box, and scored 100 on the CI runner.\n' +
      '> Treat a few points of movement as noise; the budget only fails a\n' +
      '> collapse. Accessibility floors are per route, set at what each route\n' +
      '> scores today, so this locks in "no worse" rather than hiding debt.\n' +
      '>\n' +
      '> All routes are measured logged out. The deck and feed carrying real\n' +
      '> posts are still unmeasured — that needs an authenticated run.',
    );
  } else if (failures.length) {
    console.error('\nLighthouse budget exceeded:\n  ' + failures.join('\n  '));
    process.exit(1);
  } else {
    console.log('\nwithin budget');
  }
}
