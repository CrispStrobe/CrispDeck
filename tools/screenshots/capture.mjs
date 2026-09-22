#!/usr/bin/env node
/**
 * Render App Store screenshots from the real production build.
 *
 * The app is the shipping web build, driven by Playwright at exact App Store
 * pixel dimensions. Nothing is drawn by hand: the network is intercepted and
 * answered with the fixtures in `fixtures.mjs`, so what lands in the PNG is the
 * app's own rendering of its own data model.
 *
 *   node tools/screenshots/capture.mjs [outdir]
 *
 * Expects a server for `build/` on $BASE_URL (default http://localhost:4173).
 */

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ACCOUNTS, SEED, BSKY_FEED, BSKY_ARCHIVE, MASTO_TIMELINE, MASTO_ARCHIVE,
  BSKY_PROFILE, BSKY_NOTIFICATIONS, avatarSvg,
} from './fixtures.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const DEBUG = !!process.env.SHOT_DEBUG;
const OUT = path.resolve(process.argv[2] ?? 'appstore-shots');

/**
 * Apple's current sizes. The CSS viewport is a real device's point size and the
 * scale factor does the rest, so the app lays itself out as a phone or a tablet
 * rather than as a very large desktop window.
 */
const DEVICES = [
  {
    suffix: 'iphone',
    displayType: 'APP_IPHONE_67',
    viewport: { width: 440, height: 956 },
    scale: 3,
    pixels: [1320, 2868],
  },
  {
    suffix: 'ipad',
    displayType: 'APP_IPAD_PRO_3GEN_129',
    viewport: { width: 1032, height: 1376 },
    scale: 2,
    pixels: [2064, 2752],
  },
];

/** Longer than Bluesky's 300 characters, so the composer shows the split. */
const DRAFT = `Three networks, one composer. This is long enough that Bluesky cannot take \
it in one post, so it is split into a numbered thread there, posted whole on \
Mastodon, and crossposted to Threads — and the mention below is resolved to the \
right handle on each network before any of that happens. No counting characters, \
no switching apps, no posting the same thing three times by hand.`;

/**
 * Several pages are deliberately empty until you do something — an empty
 * composer, a feed with no rules yet, an analytics page that has not been asked
 * to load anything. A screenshot of those is a screenshot of nothing, so each
 * scene gets the interaction a person would perform before the view is worth
 * looking at.
 */
const SCENES = [
  { name: '01-deck', path: '/deck', settle: 2500 },
  { name: '02-feed', path: '/feed', settle: 2500 },
  {
    name: '03-compose',
    path: '/compose',
    settle: 1200,
    async prepare(page) {
      const box = page.locator('textarea').first();
      await box.click();
      await box.fill(DRAFT);
      await page.waitForTimeout(600);
    },
  },
  {
    name: '04-feed-builder',
    path: '/feed-builder',
    settle: 1200,
    async prepare(page) {
      await page.getByPlaceholder(/my custom feed/i).fill('Type, with pictures');
      await page.getByPlaceholder(/what this feed shows/i)
        .fill('Lettering and typography, images only, no coin talk.');
      // Each rule is two clicks — open the type menu, pick a type — and then
      // the row's own value field appears as the last text input on the page.
      await page.getByRole('button', { name: /add first rule/i }).click();
      await page.getByRole('button', { name: 'Keywords', exact: true }).click();
      await page.locator('input[type="text"]').last().fill('typography lettering');
      await page.getByRole('button', { name: /^add rule$/i }).click();
      await page.getByRole('button', { name: 'Exclude Words', exact: true }).click();
      await page.locator('input[type="text"]').last().fill('nft crypto');
      await page.getByRole('button', { name: /^preview$/i }).click();
      await page.waitForTimeout(1800);
    },
  },
  {
    name: '05-analytics',
    path: '/analytics',
    settle: 1200,
    async prepare(page) {
      await page.getByRole('button', { name: /load all posts/i }).click();
      await page.waitForTimeout(3000);
    },
  },
];

/**
 * Column widths were tuned for the iPad, where three and a sliver of a fourth
 * fit and the shot reads as "this is a deck". Nobody tuned the iPhone, and at
 * 440pt those same widths put one column plus a 160pt sliver of the next on
 * screen — author names truncated to "To..." and "@tom...", the second column
 * sliced down the middle. It is honest about what the app does at that width,
 * and it is the first screenshot a customer sees.
 *
 * On a phone a person uses one column at a time, so show one, full width.
 */
const DECK_COLUMNS = [
  { id: 'c1', title: 'Home', type: 'timeline', width: 280, streaming: true },
  { id: 'c2', title: 'Mentions', type: 'mentions', width: 260, color: '#4f7cff' },
  { id: 'c3', title: '#typography', type: 'hashtag', query: 'typography', width: 260, color: '#2fa36b' },
  { id: 'c4', title: 'Watching "alt text"', type: 'keyword-monitor', query: 'alt text', width: 260, streaming: true, color: '#e8663d' },
  { id: 'c5', title: 'Notifications', type: 'notifications', width: 260 },
];

/**
 * The deck as it should appear on a given device: full-bleed single column on
 * a phone, several side by side on a tablet.
 */
function deckColumnsFor(device) {
  if (device.suffix !== 'iphone') return DECK_COLUMNS;
  // Leave a few points so the next column's edge hints at horizontal scroll
  // without any of its text being cut mid-word.
  const width = device.viewport.width - 24;
  return DECK_COLUMNS.map((column, i) => (i === 0 ? { ...column, width } : column));
}

/** localStorage the app should start from, so no first-run wizard is in shot. */
const STORAGE = {
  'crispdeck-key': SEED.cryptoKey,
  'crispdeck-salt-v2': SEED.cryptoSalt,
  'crispdeck-first-run-complete': 'true',
  'crispdeck-theme': 'dark',
  'crispdeck-deck-columns': JSON.stringify(DECK_COLUMNS),
  'crispdeck-live-counters': 'true',
  'crispdeck-media-preview': 'true',
  'crispdeck-lang': 'en',
  'crispdeck-language': 'en',
};

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body),
});

const SESSION = {
  did: ACCOUNTS[0].did,
  handle: ACCOUNTS[0].handle,
  email: 'demo@crispdeck.test',
  accessJwt: 'demo.access.jwt',
  refreshJwt: 'demo.refresh.jwt',
  active: true,
};

/** Answer an AT Protocol XRPC call by method name. */
function xrpc(method) {
  switch (method) {
    case 'com.atproto.server.createSession':
    case 'com.atproto.server.refreshSession':
    case 'com.atproto.server.getSession':
      return SESSION;
    case 'com.atproto.identity.resolveHandle':
      return { did: ACCOUNTS[0].did };
    case 'app.bsky.feed.getTimeline':
    case 'app.bsky.feed.getListFeed':
      return { feed: BSKY_FEED };
    // Your own history, not the timeline — the analytics page reads this one,
    // and it needs posts spread over weeks for the charts to say anything.
    case 'app.bsky.feed.getAuthorFeed':
    case 'app.bsky.feed.getActorLikes':
      return { feed: BSKY_ARCHIVE };
    case 'app.bsky.feed.searchPosts':
      return { posts: BSKY_FEED.map((f) => f.post) };
    case 'app.bsky.actor.getProfile':
      return BSKY_PROFILE;
    case 'app.bsky.actor.getProfiles':
      return { profiles: [BSKY_PROFILE] };
    case 'app.bsky.actor.searchActors':
      return { actors: [BSKY_PROFILE] };
    case 'app.bsky.notification.listNotifications':
      return { notifications: BSKY_NOTIFICATIONS };
    case 'app.bsky.notification.getUnreadCount':
      return { count: 3 };
    case 'app.bsky.graph.getLists':
      return { lists: [] };
    case 'app.bsky.graph.getFollows':
      return { follows: [] };
    case 'app.bsky.graph.getFollowers':
      return { followers: [] };
    case 'app.bsky.feed.getFeedGenerators':
      return { feeds: [] };
    case 'app.bsky.actor.getPreferences':
      return { preferences: [] };
    case 'com.atproto.repo.getRecord':
      return { uri: '', cid: '', value: {} };
    default:
      return {};
  }
}

/** Answer a Mastodon REST call by path. */
function mastodon(pathname) {
  if (/\/accounts\/[^/]+\/statuses/.test(pathname)) return MASTO_ARCHIVE;
  if (pathname.includes('/timelines/')) return MASTO_TIMELINE;
  if (pathname.endsWith('/verify_credentials')) return MASTO_TIMELINE[0].account;
  if (pathname.includes('/instance')) {
    return { uri: 'social.example', title: 'social.example', version: '4.3.0',
             description: 'A small instance.', stats: { user_count: 4210, status_count: 918000, domain_count: 32000 } };
  }
  if (pathname.includes('/notifications')) {
    return MASTO_TIMELINE.slice(0, 5).map((s, i) => ({
      id: `n${i}`, type: ['favourite', 'reblog', 'mention', 'follow', 'poll'][i % 5],
      createdAt: s.createdAt, account: s.account, status: s,
    }));
  }
  if (pathname.includes('/search')) return { accounts: [], statuses: MASTO_TIMELINE.slice(0, 4), hashtags: [] };
  if (pathname.includes('/trends')) return [];
  return [];
}

/**
 * Playwright matches routes in reverse registration order, so these are
 * registered broadest first: the catch-all goes in before the specific
 * handlers that have to beat it.
 */
async function routes(context) {
  // Anything off-origin that nothing else claims (translation providers,
  // websocket fallbacks, telemetry a library tries on its own) resolves empty
  // rather than hanging until the screenshot times out.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.fulfill(json({}));
  });

  await context.route(/\/api\/v\d\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.continue();
    return route.fulfill(json(mastodon(url.pathname)));
  });

  await context.route('**/xrpc/**', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/xrpc/')[1]?.split('?')[0] ?? '';
    if (DEBUG) console.log(`    xrpc ${method}`);
    return route.fulfill(json(xrpc(method)));
  });

  // Avatars and any other remote image: a generated SVG, so a screenshot never
  // depends on the network and never shows a broken-image box.
  await context.route(/\.(png|jpe?g|webp|gif|avif)(\?|$)/i, async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: avatarSvg(url) });
  });
}

/**
 * Write the fixture accounts straight into the app's own IndexedDB, with the
 * credentials encrypted exactly the way `browser-db.ts` does it — same seed,
 * same salt, same 600k PBKDF2 rounds — so the app decrypts them normally
 * instead of needing a test-only code path in the shipping build.
 */
async function seedAccounts(page, accounts) {
  await page.evaluate(async (rows) => {
    const enc = new TextEncoder();
    const seed = localStorage.getItem('crispdeck-key');
    const salt = Uint8Array.from(atob(localStorage.getItem('crispdeck-salt-v2')), (c) => c.charCodeAt(0));
    const material = await crypto.subtle.importKey('raw', enc.encode(seed), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );

    const encrypt = async (text) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
      const packed = new Uint8Array(iv.length + ct.byteLength);
      packed.set(iv);
      packed.set(new Uint8Array(ct), iv.length);
      return btoa(String.fromCharCode(...packed));
    };

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('crispdeck');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = new Date().toISOString();
    const tx = db.transaction('accounts', 'readwrite');
    const store = tx.objectStore('accounts');
    for (const row of rows) {
      const { credentials, ...rest } = row;
      store.put({ ...rest, threads_user_id: rest.threads_user_id ?? null,
                  created_at: now, updated_at: now,
                  credentials_enc: await encrypt(JSON.stringify(credentials)) });
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, accounts);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const manifest = [];

  for (const device of DEVICES) {
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.suffix === 'iphone',
      hasTouch: true,
      colorScheme: 'dark',
      locale: 'en-US',
      timezoneId: 'Europe/Berlin',
      reducedMotion: 'reduce',
      baseURL: BASE,
    });
    await routes(context);
    await context.addInitScript((storage) => {
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    }, { ...STORAGE,
         'crispdeck-deck-columns': JSON.stringify(deckColumnsFor(device)) });

    const page = await context.newPage();
    page.on('pageerror', (error) => console.warn(`  ! ${device.suffix}: ${error.message}`));
    if (DEBUG) {
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          console.log(`    console ${message.type()}: ${message.text().slice(0, 300)}`);
        }
      });
    }

    // First load creates the IndexedDB at the schema version the app expects;
    // only then can the fixture accounts be written into it.
    await page.goto('/', { waitUntil: 'networkidle' });
    await seedAccounts(page, ACCOUNTS);

    for (const scene of SCENES) {
      await page.goto(scene.path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(scene.settle);
      if (scene.prepare) {
        try {
          await scene.prepare(page);
        } catch (error) {
          // A changed label should not silently ship an empty screenshot.
          throw new Error(`scene ${scene.name} (${device.suffix}): ${error.message}`);
        }
      }
      const name = `en-US-${scene.name}-${device.suffix}.png`;
      await page.screenshot({ path: path.join(OUT, name) });
      manifest.push({
        name, locale: 'en-US', displayType: device.displayType,
        pixels: device.pixels.join('x'), scene: scene.name,
      });
      console.log(`  ${name}`);
    }
    await context.close();
  }

  await browser.close();
  await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nwrote ${manifest.length} screenshots to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
