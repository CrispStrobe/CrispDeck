/**
 * Exercise the real local-search module against a browser's real IndexedDB.
 *
 * Run: node bench/local-search-cache.mjs
 * Optional: BENCH_ITEMS=10000 BENCH_REPEATS=5 BENCH_BROWSER=/usr/bin/chromium
 * BENCH_EMULATED=1 validates candidate reads with fake-indexeddb when no browser
 * can launch. Its timings measure the emulator and must not stand in for a device.
 *
 * A private, temporary Vite server serves the module without booting the app or
 * connecting accounts. Every run uses a fresh browser context. The corpus and
 * network interceptor keep real credentials and provider traffic out of it.
 *
 * Timings are observations, not CI thresholds. The invariants assert useful
 * work: all records are retained, queries return the expected matches, and a
 * selective query fetches only its index candidates without scanning bodies.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ITEMS = Number(process.env.BENCH_ITEMS ?? 10_000);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
assert(Number.isSafeInteger(ITEMS) && ITEMS >= 100 && ITEMS <= 50_000,
  'BENCH_ITEMS must be an integer between 100 and 50000');
assert(Number.isSafeInteger(REPEATS) && REPEATS >= 1 && REPEATS <= 20,
  'BENCH_REPEATS must be an integer between 1 and 20');

const EMULATED = process.env.BENCH_EMULATED === '1';
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  server: EMULATED ? { middlewareMode: true, hmr: false, watch: null }
    : { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [{
    name: 'search-cache-benchmark-page',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/') return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><head><title>Local search benchmark</title></head><body></body></html>');
      });
    },
  }],
});

// This function is passed unchanged to Chromium and the explicit emulator path.
async function measureSearch({ items, repeats }) {
  const cache = globalThis.__benchmarkSearchCache ?? await import('/src/lib/search-cache.ts');
  const topics = [
    ['solar energy', 'photovoltaic panels convert sunlight into electricity'],
    ['public transport', 'railway timetables connect communities across the region'],
    ['software design', 'database transactions keep application records consistent'],
    ['urban gardens', 'compost improves the soil for tomatoes and climbing beans'],
    ['ocean science', 'coral reefs shelter fish and protect coastal habitats'],
    ['space exploration', 'telescopes reveal distant galaxies and planetary systems'],
    ['language learning', 'reading stories builds vocabulary and listening confidence'],
    ['local cooking', 'seasonal ingredients make a simple meal for friends'],
    ['music practice', 'rhythm and melody develop through regular rehearsal'],
    ['mountain hiking', 'trails wind through forests toward the rocky summit'],
    ['community museums', 'curators preserve objects and share their history'],
    ['東京の旅', '東京の美術館と公園を歩いて新しい景色を見つけました'],
  ];
  const sources = ['bluesky', 'mastodon', 'threads', 'rss', 'wallabag'];
  const now = Date.now();
  const inputs = Array.from({ length: items }, (_, i) => {
    const [title, detail] = topics[i % topics.length];
    const source = sources[i % sources.length];
    const extra = i % 83 === 0 ? ' A perovskite experiment makes the latest comparison interesting.' : '';
    const first = `Community notes: ${detail}.${extra} Recordkey${i} documents this observation.`;
    const second = `The author collected examples from several places and compared practical outcomes. ` +
      `This report includes the background, method, results, and questions for the next discussion. ` +
      `Readers can use the source link to inspect the full material and follow future updates.`;
    const html = source === 'wallabag' || source === 'mastodon';
    return {
      source,
      scope: source === 'rss' ? 'rss:benchmark' : source === 'wallabag' ? 'wallabag:benchmark' : `account:${i % 3 + 1}`,
      id: String(i),
      url: `https://benchmark.invalid/items/${i}`,
      title: `${title} — field notes ${i}`,
      text: html ? `<p>${first}</p><p>${second}</p>` : `${first}\n\n${second}`,
      html,
      author: `Reader ${i % 200} (@reader${i % 200}.example)`,
      createdAt: new Date(now - i * 60_000).toISOString(),
    };
  });
  await cache.updateSearchCacheSettings({
    enabled: true,
    posts: { enabled: true, mode: 'characters', maxChars: 1000 },
    wallabag: { enabled: true, mode: 'characters', maxChars: 2000 },
    maxAgeDays: 0,
    maxItems: items,
  });
  const start = performance.now();
  const indexed = await cache.cacheSearchItems(inputs);
  const ingestMs = performance.now() - start;
  const stats = await cache.getSearchCacheStats();
  if (indexed !== items || stats.count !== items || !stats.available || stats.error) {
    throw new Error(`Corpus was not stored: ${JSON.stringify({ indexed, stats, expected: items })}`);
  }

  let documentGets = 0;
  let fullStoreReads = 0;
  const originals = {};
  for (const method of ['get', 'getAll', 'openCursor']) {
    originals[method] = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      if (this.name === 'items') {
        if (method === 'get') documentGets++;
        else fullStoreReads++;
      }
      return originals[method].apply(this, args);
    };
  }

  const queries = [
    { query: `recordkey${items - 1}`, label: 'unique word', expectedCandidates: 1 },
    { query: 'photovoltaic', label: 'topic word', expectedCandidates: inputs.filter((_, i) => i % topics.length === 0).length },
    { query: 'photovoltaic perov', label: 'AND with final prefix', expectedCandidates: inputs.filter((_, i) => i % topics.length === 0 && i % 83 === 0).length },
    { query: '東京', label: 'unspaced Japanese', expectedCandidates: inputs.filter((_, i) => i % topics.length === topics.length - 1).length },
    { query: 'zznonexistentsearchtoken', label: 'no match', expectedCandidates: 0 },
    { query: 'community', label: 'common word', expectedCandidates: items },
  ];
  const results = [];
  try {
    for (const query of queries) {
      await cache.searchCache(query.query, { limit: 100 });
      const samples = [];
      for (let pass = 0; pass < repeats; pass++) {
        documentGets = 0;
        fullStoreReads = 0;
        const begin = performance.now();
        const found = await cache.searchCache(query.query, { limit: 100 });
        const elapsedMs = performance.now() - begin;
        if (found.length !== Math.min(query.expectedCandidates, 100) ||
            documentGets !== query.expectedCandidates || fullStoreReads !== 0) {
          throw new Error(`Query did not exercise the expected index: ${JSON.stringify({
            query, returned: found.length, documentGets, fullStoreReads,
          })}`);
        }
        samples.push({ elapsedMs, returned: found.length, documentGets, fullStoreReads });
      }
      const times = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
      const rounded = value => Math.round(value * 100) / 100;
      results.push({
        query: query.query,
        label: query.label,
        medianMs: rounded(times[Math.floor(times.length / 2)]),
        minMs: rounded(times[0]),
        maxMs: rounded(times[times.length - 1]),
        returned: samples[0].returned,
        candidateDocumentGets: samples[0].documentGets,
        fullStoreReads: samples[0].fullStoreReads,
      });
    }
  } finally {
    for (const [method, original] of Object.entries(originals)) IDBObjectStore.prototype[method] = original;
  }
  return {
    browser: navigator.userAgent,
    storage: globalThis.__benchmarkSearchCache ? 'fake-indexeddb (emulated; not device timing)' : 'Chromium IndexedDB',
    records: stats.count,
    estimatedBytes: stats.bytes,
    ingestMs: Math.round(ingestMs),
    repeats,
    fixture: 'Synthetic mixed sources; text-only projection; Vite development transform; no provider traffic',
    results,
  };
}

let browser;
let dom;
try {
  let report;
  if (EMULATED) {
    const { JSDOM } = await import('jsdom');
    const fake = await import('fake-indexeddb');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://benchmark.invalid/' });
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, Event: dom.window.Event,
      indexedDB: new fake.IDBFactory(), IDBKeyRange: fake.IDBKeyRange, IDBObjectStore: fake.IDBObjectStore,
    })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    globalThis.__benchmarkSearchCache = await server.ssrLoadModule('/src/lib/search-cache.ts');
    report = await measureSearch({ items: ITEMS, repeats: REPEATS });
  } else {
    await server.listen();
    const address = server.httpServer.address();
    assert(address && typeof address === 'object', 'Benchmark server did not start');
    const origin = `http://127.0.0.1:${address.port}`;
    const fallback = existsSync(chromium.executablePath()) ? undefined
      : existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
    browser = await chromium.launch({ executablePath: process.env.BENCH_BROWSER || fallback });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/*', route => route.request().url().startsWith(`${origin}/`)
      ? route.continue() : route.abort());
    await page.goto(origin);
    report = await page.evaluate(measureSearch, { items: ITEMS, repeats: REPEATS });
    assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  dom?.window.close();
  await server.close();
}
