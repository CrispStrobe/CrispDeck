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

// One handler, not two. Playwright matches the most recently registered route
// first, so a catch-all added after the feed handler takes precedence over it
// and aborts the very requests the benchmark depends on — which is exactly
// what happened: no posts, and a 30-second timeout with no explanation.
const routeHandler = (route) => {
  const url = route.request().url();
  const feed = url.match(/^https:\/\/bench\.invalid\/feed-(\d+)\.xml/);
  if (feed) {
    return route.fulfill({
      status: 200, contentType: 'application/rss+xml', body: rssFeed(+feed[1]),
    });
  }
  // Nothing else should reach the network from a benchmark.
  return url.startsWith(BASE) ? route.continue() : route.abort();
};

/** Seed the account and columns a deck needs before it will render anything. */
async function seed(p, columns) {
  await p.evaluate(() => new Promise((res, rej) => {
    const rq = indexedDB.open('crispdeck', 1);
    rq.onsuccess = () => {
      const tx = rq.result.transaction('accounts', 'readwrite');
      tx.objectStore('accounts').put({ id: 1, platform: 'bluesky', handle: 'bench.example',
        display_name: 'Bench', did: 'did:plc:bench', credentials: '{}', is_primary: 1 });
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    };
    rq.onerror = () => rej(rq.error);
  }));
  await p.evaluate(([n]) => {
    const cols = Array.from({ length: n }, (_, i) => ({
      id: `bench-${i}`, title: `Bench ${i}`, type: 'rss',
      query: `https://bench.invalid/feed-${i}.xml`, width: 380,
    }));
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(cols));
  }, [columns]);
}

/**
 * Time to the first post, on a fresh profile, repeated.
 *
 * A single sample of this is not worth reporting. The same build measured
 * 1163ms and 756ms on two runs of the same shared runner -- a 35% spread,
 * comfortably wider than the change it was supposed to be evidencing. The
 * median of several passes is a number a before/after can rest on.
 */
async function timeToFirstPost() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.route('**', routeHandler);
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await seed(p, COLUMNS);
  const t = Date.now();
  await p.goto(`${BASE}/deck`, { waitUntil: 'load' });
  await p.waitForSelector('[data-post-uri]', { timeout: 30000 });
  const ms = Date.now() - t;
  await ctx.close();
  return ms;
}

await page.route('**', routeHandler);

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// The deck shows an empty state without an account, so seed one; RSS columns
// do not use it, but the page will not render columns without it.
await seed(page, COLUMNS);

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
try {
  await page.waitForSelector('[data-post-uri]', { timeout: 30000 });
} catch {
  // A benchmark that measures nothing must say why, not just time out.
  const main = await page.locator('#main-content').innerText().catch(() => '(no main)');
  console.error('no posts rendered. page said:', JSON.stringify(main.slice(0, 300)));
  console.error('columns in storage:',
    await page.evaluate(() => localStorage.getItem('crispdeck-deck-columns')?.slice(0, 200)));
  console.error('page errors:', pageErrors.slice(0, 3));
  await browser.close();
  process.exit(1);
}
const firstPostMs = Date.now() - t0;

// Wait for the post count to stop growing rather than sleeping a fixed
// amount. The fixed 3000ms sleep this replaces was the bulk of the number it
// produced -- a "settle" of 4263ms was 3000ms of sleep plus 1263ms of deck,
// so the metric moved by a third of what the deck actually did.
let settleMs = firstPostMs;
{
  let last = -1, stableFor = 0;
  while (stableFor < 500 && Date.now() - t0 < 30000) {
    await page.waitForTimeout(100);
    const n = await page.evaluate(() => document.querySelectorAll('[data-post-uri]').length);
    if (n === last) stableFor += 100;
    else { last = n; stableFor = 0; settleMs = Date.now() - t0; }
  }
}

const stats = await page.evaluate(() => {
  const cols = [...document.querySelectorAll('[data-post-uri]')];
  return { posts: cols.length, nodes: document.querySelectorAll('*').length };
});

// Scroll the first column and record the gaps between frames the browser
// actually painted.
//
// The first version waited two requestAnimationFrames per step and timed the
// wait, which cannot report less than about 33ms at 60Hz — and duly reported
// "median 33.3, p95 33.5, 29 of 30 janky" for every configuration, which is
// the measurement's floor rather than the deck's cost. Sampling frame
// timestamps during a continuous scroll measures dropped frames instead.
const scroll = await page.evaluate(async () => {
  // Walk UP from a row to its own scroll container, rather than taking the
  // first `.overflow-y-auto` in document order. That selector matched the
  // layout's <main>, which wraps the whole deck and only ever scrolls
  // horizontally -- it reported scrollHeight === clientHeight === 720, the
  // measurement skipped itself, and a skip reads exactly like a healthy deck.
  const row = document.querySelector('[data-feed-key]');
  if (!row) return { skipped: 'no keyed rows rendered' };

  let el = null;
  for (let n = row.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight - n.clientHeight > 0) {
      el = n;
      break;
    }
  }
  if (!el) {
    const p = row.parentElement;
    return { skipped: 'no scrollable ancestor overflows',
             parentScrollHeight: p && p.scrollHeight,
             parentClientHeight: p && p.clientHeight };
  }

  const gaps = [];
  const distance = el.scrollHeight - el.clientHeight;

  await new Promise((done) => {
    let last = performance.now();
    const started = last;
    const DURATION = 2000;
    function frame(now) {
      gaps.push(now - last);
      last = now;
      const progress = Math.min(1, (now - started) / DURATION);
      el.scrollTop = distance * progress;
      if (progress < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  });

  gaps.shift(); // first gap includes scheduling, not rendering
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
  return {
    frames: sorted.length,
    medianGapMs: at(0.5),
    p95GapMs: at(0.95),
    worstGapMs: +sorted[sorted.length - 1].toFixed(1),
    // A gap over 32ms means at least one frame was missed.
    droppedFrames: sorted.filter((g) => g > 32).length,
  };
});

const long = (await page.evaluate(() => window.__long)) ?? [];

/**
 * When does the app shell first paint, on a cold cache and a real network?
 *
 * The measurements above run against localhost, where bundle weight is very
 * nearly free -- moving 221 KB off every route's critical path changed
 * firstPostMs from 1195ms to 1163ms there, which is noise. That says nothing
 * about the change and everything about the link. On a throttled connection
 * the same bytes are about a second, and first paint is gated on them,
 * because index.html is nearly empty under adapter-static: nothing renders
 * until the entry and the route chunk have arrived and run.
 *
 * Deliberately measured with no columns seeded. This is the shell, not the
 * data -- what the user sees before anything has been fetched.
 */
async function shellPaint(throttled) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  // Without this the second pass reads a warm cache and reports the cost of
  // parsing bytes that are already local, which is not the question.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttled) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,  // ~1.6 Mbps
      uploadThroughput: (750 * 1024) / 8
    });
  }
  await p.route('**://bench.invalid/**', (r) => r.abort());
  await p.goto(`${BASE}/deck`, { waitUntil: 'load' });
  const fcp = await p.evaluate(() => new Promise((res) => {
    const done = (e) => res(e ? Math.round(e.startTime) : null);
    const seen = performance.getEntriesByName('first-contentful-paint')[0];
    if (seen) return done(seen);
    new PerformanceObserver((list, obs) => { obs.disconnect(); done(list.getEntries()[0]); })
      .observe({ type: 'paint', buffered: true });
    setTimeout(() => res(null), 20000);
  }));
  await ctx.close();
  return fcp;
}

const shell = { coldFcpMs: await shellPaint(false), throttledFcpMs: await shellPaint(true) };

const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const firstPostRuns = [];
for (let i = 0; i < REPEATS; i++) firstPostRuns.push(await timeToFirstPost());
const sortedRuns = [...firstPostRuns].sort((a, b) => a - b);
const firstPostMedianMs = sortedRuns[Math.floor(sortedRuns.length / 2)];

await browser.close();

const result = {
  columns: COLUMNS,
  itemsPerColumn: ITEMS,
  postsRendered: stats.posts,
  domNodes: stats.nodes,
  firstPostMs,
  firstPostMedianMs,
  firstPostRuns,
  settleMs,
  longTasks: long.length,
  worstLongTaskMs: long.length ? Math.max(...long) : 0,
  scroll,
  shell,
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
