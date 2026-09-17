// Exact byte attribution per chunk, from Rollup's own module records.
//
// This replaces guessing at chunk contents with marker strings. That guess was
// wrong in a way worth recording: /masto/ matched our own `mastodon`
// identifiers, so eight chunks of ordinary application code were reported as
// the masto package and looked like 141 KB of duplication that did not exist.
//
// generateBundle knows every module in every chunk and how many bytes each
// contributed after tree-shaking, which is the number worth having.
//
// Opt-in via BENCH_CHUNK_MAP=1 so ordinary builds do not pay for it.
import { writeFileSync } from 'node:fs';

/**
 * @param {string} prefix
 * @returns {import('vite').Plugin}
 */
export function chunkMap(prefix = 'chunk-map') {
  return {
    name: 'bench-chunk-map',
    apply: 'build',
    generateBundle(/** @type {any} */ options, /** @type {any} */ bundle) {
      // SvelteKit runs Rollup twice, client then server. Writing both to one
      // path let the server build overwrite the client's, which is how
      // html2canvas appeared as 400 KB of weight that no client chunk carried.
      const side = /(^|\/)server(\/|$)/.test(options.dir ?? '') ? 'server' : 'client';
      const chunks = [];
      const packageTotals = new Map();

      for (const [file, c] of Object.entries(bundle)) {
        if (c.type !== 'chunk') continue;
        const byPkg = new Map();
        for (const [id, mod] of Object.entries(c.modules ?? {})) {
          const n = mod.renderedLength ?? 0;
          if (!n) continue;
          // Last node_modules segment wins, so a nested dependency is
          // attributed to itself rather than to whatever pulled it in.
          const m = [...id.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].pop();
          const pkg = m ? m[1] : '(app)';
          byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + n);
          packageTotals.set(pkg, (packageTotals.get(pkg) ?? 0) + n);
        }
        const top = [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([pkg, bytes]) => ({ pkg, bytes }));
        chunks.push({ file, bytes: c.code.length, top, allPkgs: [...byPkg.keys()] });
      }

      // A package appearing in more than one chunk is either a deliberate
      // shared split or duplicated weight; the count is what distinguishes them.
      //
      // Counted over every package in the chunk, not the per-chunk top 6 --
      // that truncation reported `chunks: 0` for packages that were plainly
      // present, jose and lru-cache among them.
      const chunksPerPkg = new Map();
      for (const c of chunks)
        for (const pkg of c.allPkgs)
          chunksPerPkg.set(pkg, (chunksPerPkg.get(pkg) ?? 0) + 1);

      const packages = [...packageTotals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([pkg, bytes]) => ({ pkg, bytes, chunks: chunksPerPkg.get(pkg) ?? 0 }));

      chunks.sort((a, b) => b.bytes - a.bytes);
      const slim = chunks.slice(0, 15).map(({ allPkgs, ...c }) => c);
      writeFileSync(`${prefix}.${side}.json`, JSON.stringify({ side, packages, chunks: slim }, null, 2));
    }
  };
}
