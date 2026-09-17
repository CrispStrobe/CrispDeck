/**
 * How much does a full deck cost to render?
 *
 * Runs in CI rather than on a workstation: the numbers that matter here are
 * frame times and long tasks, and both are meaningless on a machine that is
 * also compiling something else. A local run of this measured 290ms for work
 * that takes 55ms when the box is idle.
 *
 * Columns are RSS, because RSS needs no credentials — every other column type
 * would require a real Bluesky or Mastodon session. The feed is served by an
 * intercepted request, so nothing leaves the runner.
 */
import { chromium } from '@playwright/test';

const COLUMNS = Number(process.env.BENCH_COLUMNS ?? 8);
const ITEMS = Number(process.env.BENCH_ITEMS ?? 30);
const BASE = process.env.BENCH_BASE ?? 'http://localhost:4173';

const WORDS = ['compiler', 'migration', 'renderer', 'scheduler', 'parser', 'cache',
  'linter', 'protocol', 'planner', 'allocator', 'tokenizer', 'debugger', 'daemon'];

function rssFeed(columnIndex) {
  const items = Array.from({ length: ITEMS }, (_, i) => `
    <item>
      <title>The ${WORDS[(i * 3 + columnIndex) % WORDS.length]} ${WORDS[(i * 5) % WORDS.length]} finally behaves, case ${columnIndex}-${i}</title>
      <link>https://example.com/c${columnIndex}/post-${i}</link>
      <description>A reasonably long description, the kind a real feed carries, with enough words in it to exercise the text rendering path rather than a stub. Item ${i} of column ${columnIndex}.</description>
      <pubDate>${new Date(Date.now() - i * 600000).toUTCString()}</pubDate>
    </item>`).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Bench feed ${columnIndex}</title><link>https://example.com/c${columnIndex}</link>${items}
  </channel></rss>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.route('https://bench.invalid/**', (route) => {
  const m = route.request().url().match(/feed-(\d+)\.xml/);
  route.fulfill({ status: 200, contentType: 'application/rss+xml', body: rssFeed(m ? +m[1] : 0) });
});
// Nothing else should reach the network from a benchmark.
await page.route('**', (route) =>
  route.request().url().startsWith(BASE) ? route.continue() : route.abort());

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// The deck shows an empty state without an account, so seed one; RSS columns
// do not use it, but the page will not render columns without it.
await page.evaluate(() => new Promise((res, rej) => {
  const rq = indexedDB.open('crispdeck', 1);
  rq.onsuccess = () => {
    const tx = rq.result.transaction('accounts', 'readwrite');
    tx.objectStore('accounts').put({ id: 1, platform: 'bluesky', handle: 'bench.example',
      display_name: 'Bench', did: 'did:plc:bench', credentials: '{}', is_primary: 1 });
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  };
  rq.onerror = () => rej(rq.error);
}));

await page.evaluate(([n]) => {
  const columns = Array.from({ length: n }, (_, i) => ({
    id: `bench-${i}`, title: `Bench ${i}`, type: 'rss',
    query: `https://bench.invalid/feed-${i}.xml`, width: 380,
  }));
  localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
}, [COLUMNS]);

await page.addInitScript(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* no longtask support */ }
});

const t0 = Date.now();
await page.goto(`${BASE}/deck`, { waitUntil: 'load' });
await page.waitForSelector('[data-post-uri]', { timeout: 30000 });
await page.waitForTimeout(3000);
const settleMs = Date.now() - t0;

const stats = await page.evaluate(() => {
  const cols = [...document.querySelectorAll('[data-post-uri]')];
  return { posts: cols.length, nodes: document.querySelectorAll('*').length };
});

// Scroll the first column through its whole length, timing each step.
const scroll = await page.evaluate(async () => {
  const el = [...document.querySelectorAll('.overflow-y-auto')]
    .find((e) => e.querySelector('[data-post-uri]'));
  if (!el) return null;
  const frames = [];
  const steps = 30;
  const step = Math.max(1, (el.scrollHeight - el.clientHeight) / steps);
  for (let i = 0; i < steps; i++) {
    const t = performance.now();
    el.scrollTop = step * i;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    frames.push(performance.now() - t);
  }
  frames.sort((a, b) => a - b);
  return {
    median: +frames[Math.floor(frames.length / 2)].toFixed(1),
    p95: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
    janky: frames.filter((f) => f > 16.7).length,
    steps,
  };
});

const long = (await page.evaluate(() => window.__long)) ?? [];
await browser.close();

const result = {
  columns: COLUMNS,
  itemsPerColumn: ITEMS,
  postsRendered: stats.posts,
  domNodes: stats.nodes,
  settleMs,
  longTasks: long.length,
  worstLongTaskMs: long.length ? Math.max(...long) : 0,
  scroll,
  pageErrors: pageErrors.length,
};
console.log(JSON.stringify(result, null, 2));

if (pageErrors.length) {
  console.error('page errors:', pageErrors.slice(0, 3));
  process.exit(1);
}
if (!stats.posts) {
  console.error('no posts rendered — the benchmark measured nothing');
  process.exit(1);
}
