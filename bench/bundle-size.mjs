// Report what a cold visit actually downloads.
//
// "Total JS in build/" is the wrong number: adapter-static emits a chunk per
// route, and a visitor to /feed never fetches the deck's. What matters is the
// entry cost every visitor pays before anything renders -- that is what the
// login delay and every cold open are waiting on -- and then the per-route
// chunks on top of it.
//
// Sizes are gzipped. Uncompressed bytes overstate the wait by roughly 3x and
// no server ships them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.argv[2] ?? 'build';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const gz = (p) => gzipSync(readFileSync(p)).length;

// The entry: what index.html pulls in directly, plus everything those modules
// statically import. Anything reachable only through a dynamic import is a
// route chunk and is not part of the entry cost.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const seeds = [...html.matchAll(/["'((]([^"'()\s]*\/_app\/immutable\/[^"'()\s]+\.js)/g)]
  .map((m) => m[1].replace(/^.*?\/_app\//, '_app/'));

const byRel = new Map(files.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), f]));
// Static imports only -- import("...") is a route split, not entry cost.
function staticImportsOf(rel) {
  const src = readFileSync(byRel.get(rel), 'utf8');
  const out = [];
  for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)) {
    if (m[1].startsWith('.')) out.push(m[1]);
  }
  return out;
}

function resolveFrom(rel, spec) {
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  const norm = [];
  for (const part of (dir + '/' + spec).split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') norm.pop();
    else norm.push(part);
  }
  return norm.join('/');
}

const entry = new Set();
const queue = [...new Set(seeds)];
while (queue.length) {
  const rel = queue.pop();
  if (entry.has(rel) || !byRel.has(rel)) continue;
  entry.add(rel);
  for (const spec of staticImportsOf(rel)) queue.push(resolveFrom(rel, spec));
}

const entryBytes = [...entry].reduce((n, rel) => n + gz(byRel.get(rel)), 0);

const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
const total = (list) => list.reduce((n, f) => n + gz(f), 0);

// Which route does each node chunk belong to, and what does visiting it cost
// on top of the entry? "This chunk is 226 KB" is not actionable on its own --
// the question is whether a visitor to /login pays it.
//
// svelte-kit sync writes .svelte-kit/generated/client/nodes/N.js, each
// re-exporting the route component it stands for, which is the exact
// node-index-to-route mapping the built filenames otherwise hide.
function closureOf(rel, stop) {
  const seen = new Set();
  const queue = [rel];
  while (queue.length) {
    const r = queue.pop();
    if (seen.has(r) || stop.has(r) || !byRel.has(r)) continue;
    seen.add(r);
    for (const spec of staticImportsOf(r)) queue.push(resolveFrom(r, spec));
  }
  return seen;
}

// Which chunks carry which package, from the Rollup report if it was written.
//
// A route's weight alone cannot say whether a regression is one heavy
// dependency creeping back onto the critical path or a hundred small honest
// additions. Naming the packages in each closure makes the difference
// checkable, which is what the CI guard needs.
const chunksByPkg = new Map();
try {
  const map = JSON.parse(readFileSync('chunk-map.client.json', 'utf8'));
  for (const c of map.chunks ?? []) {
    for (const t of c.top ?? []) {
      if (!chunksByPkg.has(t.pkg)) chunksByPkg.set(t.pkg, new Set());
      chunksByPkg.get(t.pkg).add(c.file);
    }
  }
} catch { /* built without BENCH_CHUNK_MAP; routes are reported unnamed */ }

/** Third-party packages found in a closure, heaviest concern first. */
function packagesIn(closure) {
  const found = [];
  for (const [pkg, files] of chunksByPkg) {
    if (pkg === '(app)') continue;
    if ([...files].some((f) => closure.has(f))) found.push(pkg);
  }
  return found.sort();
}

const routes = [];
try {
  const dir = '.svelte-kit/generated/client/nodes';
  for (const f of readdirSync(dir)) {
    const idx = f.replace(/\.js$/, '');
    const src = readFileSync(join(dir, f), 'utf8');
    const m = src.match(/src\/routes\/(.*?)\/\+(page|layout)\.svelte/)
           || src.match(/src\/routes\/\+(page|layout)\.svelte/);
    const route = m ? (m[1] ? '/' + m[1] : '/') : null;
    if (!route) continue;
    const chunk = [...byRel.keys()].find((r) =>
      new RegExp(`^_app/immutable/nodes/${idx}\\.[^/]+\\.js$`).test(r));
    if (!chunk) continue;
    const closure = closureOf(chunk, entry);
    const extra = [...closure].reduce((n, r) => n + gz(byRel.get(r)), 0);
    routes.push({
      route, node: Number(idx), extraGzip: extra, eagerPackages: packagesIn(closure)
    });
  }
} catch { /* no sync output; skip the per-route table */ }
routes.sort((a, b) => b.extraGzip - a.extraGzip);

const biggest = js
  .map((f) => ({ file: relative(ROOT, f).replace(/\\/g, '/'), gzip: gz(f) }))
  .sort((a, b) => b.gzip - a.gzip)
  .slice(0, 12);

console.log(JSON.stringify({
  entryGzip: entryBytes,
  entryModules: entry.size,
  allJsGzip: total(js),
  jsFiles: js.length,
  cssGzip: total(css),
  rawBytes: js.reduce((n, f) => n + statSync(f).size, 0),
  biggestChunks: biggest,
  entryPackages: packagesIn(entry),
  routes
}, null, 2));
