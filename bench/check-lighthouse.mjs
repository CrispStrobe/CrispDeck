// Enforce bench/lighthouse-budget.json against a Lighthouse JSON report.
//
// Split from the run itself for the same reason check-budget.mjs is: the
// logic is then importable, and a guard nobody has watched fail is not a
// guard. See the budget file for why the performance score is gated with a
// floor rather than a threshold.

import { readFileSync } from 'node:fs';

/**
 * @param {any} report  a Lighthouse JSON report
 * @param {any} budget  a lighthouse-budget.json
 * @returns {string[]} one message per violation; empty means within budget
 */
export function checkLighthouse(report, budget) {
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

  for (const [name, min] of Object.entries(budget.categories ?? {})) {
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
        `${name} scored ${Math.round(cat.score * 100)}, below the ${Math.round(Number(min) * 100)} floor`,
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
      failures.push(`audit "${id}" failed: ${audit.title ?? id}`);
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
 */
export function markdown(report) {
  const s = summarize(report);
  const out = [
    '### Lighthouse',
    '',
    `\`${s.url}\`, desktop preset.`,
    '',
    '| category | score |',
    '|---|---|',
    ...Object.entries(s.categories).map(([k, v]) => `| ${k} | ${v === null ? 'n/a' : `**${v}**`} |`),
    '',
    '| metric | |',
    '|---|---|',
    ...Object.entries(s.metrics).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '> The performance score moved between 95 and 99 across four runs of one',
    '> unchanged build on a loaded dev box, and scored 100 on the CI runner.',
    '> Treat a few points of movement as noise; the budget only fails a',
    '> collapse. The other three categories have been stable at 100 and are',
    '> gated near that.',
  ];
  return out.join('\n');
}

// CLI:
//   node bench/check-lighthouse.mjs lighthouse.json bench/lighthouse-budget.json
//   node bench/check-lighthouse.mjs lighthouse.json bench/lighthouse-budget.json --markdown
//
// --markdown only renders; it never gates. The budget run above is what fails
// the build, so a formatting problem in a summary cannot turn a passing job red
// (and, just as importantly, cannot turn a failing one green).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const asMarkdown = args.includes('--markdown');
  const [reportPath, budgetPath] = args.filter((a) => !a.startsWith('--'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));

  if (asMarkdown) {
    console.log(markdown(report));
  } else {
    const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
    console.log(JSON.stringify(summarize(report), null, 2));
    const failures = checkLighthouse(report, budget);
    if (failures.length) {
      console.error('\nLighthouse budget exceeded:\n  ' + failures.join('\n  '));
      process.exit(1);
    }
    console.log('\nwithin budget');
  }
}
