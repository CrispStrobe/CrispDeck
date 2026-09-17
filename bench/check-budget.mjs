// Enforce bench/bundle-budget.json against a build's bundle-size.json.
//
// Weight alone is a weak guard: it cannot tell one heavy dependency creeping
// back onto the critical path from a hundred small honest additions. So this
// checks both -- a named list of packages that must stay dynamically imported,
// and ceilings for ordinary drift.
//
// The logic is exported so it can be tested. A guard nobody has watched fail
// is not a guard, and this one protects a result that is easy to undo by
// accident: a single value import in a shared module silently puts 221 KB
// back on every route.

import { readFileSync } from 'node:fs';

/** @param {number} n */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/**
 * @param {any} report  a bundle-size.json
 * @param {any} budget  a bundle-budget.json
 * @returns {string[]} one message per violation; empty means within budget
 */
export function checkBudget(report, budget) {
  const failures = [];

  if (!report.routes?.length) {
    failures.push('no routes in the report — built without svelte-kit sync output?');
  }

  // The named list only means anything if the package map was written. Without
  // it every closure looks empty and the check would pass by knowing nothing,
  // which is the worst outcome available: a green guard that checked nothing.
  const mapped =
    report.routes?.some((/** @type {any} */ r) => r.eagerPackages?.length) || report.entryPackages?.length;
  if (report.routes?.length && !mapped) {
    failures.push(
      'no package attribution — build with BENCH_CHUNK_MAP=1, or this check is vacuous'
    );
  }

  for (const pkg of budget.mustStayLazy ?? []) {
    if (report.entryPackages?.includes(pkg)) {
      failures.push(`${pkg} is in the entry — every visitor downloads it before anything renders`);
      continue;
    }
    const offenders = (report.routes ?? []).filter((/** @type {any} */ r) => r.eagerPackages?.includes(pkg));
    if (offenders.length) {
      const names = offenders.slice(0, 6).map((/** @type {any} */ r) => r.route).join(', ');
      failures.push(
        `${pkg} is a static import of ${offenders.length} route(s): ${names}` +
          (offenders.length > 6 ? ', …' : '') +
          ' — it must be reached through a dynamic import'
      );
    }
  }

  const heaviest = [...(report.routes ?? [])].sort((/** @type {any} */ a, /** @type {any} */ b) => b.extraGzip - a.extraGzip)[0];
  if (heaviest && heaviest.extraGzip > budget.maxRouteGzip) {
    failures.push(
      `${heaviest.route} costs ${kb(heaviest.extraGzip)} over the entry, ` +
        `budget is ${kb(budget.maxRouteGzip)}`
    );
  }

  if (report.entryGzip > budget.maxEntryGzip) {
    failures.push(`entry is ${kb(report.entryGzip)}, budget is ${kb(budget.maxEntryGzip)}`);
  }

  return failures;
}

/**
 * @param {any} report
 * @param {any} budget
 */
export function summarise(report, budget) {
  const heaviest = [...(report.routes ?? [])].sort((/** @type {any} */ a, /** @type {any} */ b) => b.extraGzip - a.extraGzip)[0];
  return (
    `bundle within budget: entry ${kb(report.entryGzip)}, ` +
    `heaviest route ${heaviest ? `${heaviest.route} at ${kb(heaviest.extraGzip)}` : 'n/a'}, ` +
    `${(budget.mustStayLazy ?? []).length} packages confirmed lazy`
  );
}

// CLI: node bench/check-budget.mjs [report] [budget]
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const report = JSON.parse(readFileSync(process.argv[2] ?? 'bundle-size.json', 'utf8'));
  const budget = JSON.parse(readFileSync(process.argv[3] ?? 'bench/bundle-budget.json', 'utf8'));
  const failures = checkBudget(report, budget);
  if (failures.length) {
    console.error('bundle budget exceeded:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(summarise(report, budget));
}
