/** Real Feed/Deck rendering with encrypted local credentials and intercepted
 * Mastodon responses. Measures UI/media work, not a provider's network latency.
 * Run against a production preview on an otherwise idle CI runner.
 */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const BASE = process.env.BENCH_BASE ?? 'http://localhost:4173';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const COLUMNS = Number(process.env.BENCH_COLUMNS ?? 8);
const ITEMS = Number(process.env.BENCH_ITEMS ?? 50);
const image = await readFile('static/icon-512.png');
const browser = await chromium.launch();
const results = [];

try {
  for (const path of ['/feed', '/deck']) {
    const runs = [];
    for (let pass = 0; pass < REPEATS; pass++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      let mediaRequests = 0;
      page.on('pageerror', e => errors.push(String(e)));
      const posts = Array.from({ length: ITEMS }, (_, i) => ({
        id: String(1000 - i), uri: `https://media.bench.invalid/posts/${i}`,
        url: `https://media.bench.invalid/@reader/${i}`,
        content: `<p>Media benchmark post ${i}. A populated timeline with text and an image.</p>`,
        created_at: new Date(Date.now() - i * 60000).toISOString(),
        account: { id: '1', acct: 'reader', username: 'reader', display_name: 'Benchmark reader',
          url: 'https://media.bench.invalid/@reader', avatar: '', emojis: [] },
        media_attachments: [{ id: String(i), type: 'image', description: 'Benchmark image',
          url: `https://media.bench.invalid/image/${i}.png`,
          preview_url: `https://media.bench.invalid/image/${i}.png`,
          meta: { original: { width: 512, height: 512 } } }],
        replies_count: 0, reblogs_count: 0, favourites_count: 0,
        visibility: 'public', sensitive: false, spoiler_text: '', emojis: [], tags: [], mentions: [],
      }));
      await page.route('**', async route => {
        const url = new URL(route.request().url());
        if (url.origin === BASE) return route.continue();
        if (url.hostname !== 'media.bench.invalid') return route.abort();
        if (url.pathname.startsWith('/image/')) {
          mediaRequests++;
          return route.fulfill({ contentType: 'image/png', body: image });
        }
        return route.fulfill({ json: url.pathname.includes('/timelines/') ? posts : [] });
      });
      await page.goto(`${BASE}/compose`, { waitUntil: 'networkidle' });
      await page.evaluate(async columns => {
        const seed = 'crispdeck-media-benchmark';
        const salt = crypto.getRandomValues(new Uint8Array(32));
        localStorage.setItem('crispdeck-key', seed);
        localStorage.setItem('crispdeck-salt-v2', btoa(String.fromCharCode(...salt)));
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
          new TextEncoder().encode(JSON.stringify({ access_token: 'benchmark-only' })));
        const bytes = new Uint8Array(iv.length + encrypted.byteLength);
        bytes.set(iv); bytes.set(new Uint8Array(encrypted), iv.length);
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('crispdeck'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('accounts', 'readwrite');
          tx.objectStore('accounts').put({ id: 1, platform: 'mastodon', handle: 'reader@media.bench.invalid',
            display_name: 'Benchmark reader', instance_url: 'https://media.bench.invalid', mastodon_id: '1',
            credentials_enc: btoa(String.fromCharCode(...bytes)), is_primary: true,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem('crispdeck-deck-columns', JSON.stringify(Array.from({ length: columns }, (_, i) => ({
          id: `media-${i}`, title: `Media ${i}`, type: 'timeline', width: 380,
        }))));
      }, COLUMNS);
      const start = Date.now();
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-post-uri]').first().waitFor();
      const firstPostMs = Date.now() - start;
      await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Benchmark image"]')]
        .some(img => img.complete && img.naturalWidth > 0));
      const firstMediaMs = Date.now() - start;
      const rendered = await page.locator('[data-post-uri]').count();
      if (errors.length || !rendered || !mediaRequests) throw new Error(JSON.stringify({ path, errors, rendered, mediaRequests }));
      runs.push({ firstPostMs, firstMediaMs, postsRendered: rendered, mediaRequests });
      await ctx.close();
    }
    const median = field => [...runs].map(r => r[field]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    results.push({ path, firstPostMedianMs: median('firstPostMs'), firstMediaMedianMs: median('firstMediaMs'), runs });
  }
  console.log(JSON.stringify({ fixture: 'intercepted Mastodon, local PNG; excludes provider latency', columns: COLUMNS, items: ITEMS, results }, null, 2));
} finally {
  await browser.close();
}
