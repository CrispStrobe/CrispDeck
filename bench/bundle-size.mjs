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
const entry = new Set();
const queue = [...new Set(seeds)];
while (queue.length) {
  const rel = queue.pop();
  if (entry.has(rel) || !byRel.has(rel)) continue;
  entry.add(rel);
  const src = readFileSync(byRel.get(rel), 'utf8');
  // Static imports only -- import("...") is a route split, not entry cost.
  for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const parts = (dir + '/' + spec).split('/');
    const norm = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') norm.pop();
      else norm.push(part);
    }
    queue.push(norm.join('/'));
  }
}

const entryBytes = [...entry].reduce((n, rel) => n + gz(byRel.get(rel)), 0);

const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
const total = (list) => list.reduce((n, f) => n + gz(f), 0);

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
  biggestChunks: biggest
}, null, 2));
