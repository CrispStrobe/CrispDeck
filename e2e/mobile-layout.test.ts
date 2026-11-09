import { test, expect, type Locator, type Page } from '@playwright/test';
import { ACCOUNTS, BSKY_FEED, BSKY_PROFILE, SEED, avatarSvg } from '../tools/screenshots/fixtures.mjs';

// Mobile emulation must include touch. Viewport size alone never enabled the
// coarse-pointer rules that broke the Android feed and action targets.
test.use({ hasTouch: true, isMobile: true, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, locale: 'en-US' });
test.setTimeout(60000);

const FEED_URI = `at://${ACCOUNTS[0].did}/app.bsky.feed.generator/mobile-layout`;
const IMAGE_ALT = 'Mobile layout fixture image';
const IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#427c81"/></svg>',
);
const feed = [
  {
    ...BSKY_FEED[0],
    post: {
      ...BSKY_FEED[0].post,
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [{ thumb: IMAGE, fullsize: IMAGE, alt: IMAGE_ALT, aspectRatio: { width: 640, height: 360 } }],
      },
    },
  },
  ...BSKY_FEED.slice(1, 3),
];

async function seedFeed(page: Page, baseURL: string) {
  // The OAuth library canonicalizes localhost to 127.0.0.1. Seed the same
  // origin it will use so restoring Bluesky does not switch IndexedDB stores.
  const origin = new URL(baseURL);
  if (origin.hostname === 'localhost') origin.hostname = '127.0.0.1';

  await page.context().route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin.origin) return route.continue();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/svg+xml', body: avatarSvg(url.href), headers });
    }
    if (url.hostname === 'plc.directory') {
      return route.fulfill({ json: {
        id: ACCOUNTS[0].did,
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://bsky.social' }],
      }, headers });
    }
    const method = url.pathname.split('/xrpc/')[1];
    let json: unknown = {};
    switch (method) {
      case 'com.atproto.server.createSession':
      case 'com.atproto.server.refreshSession':
      case 'com.atproto.server.getSession':
        json = { did: ACCOUNTS[0].did, handle: ACCOUNTS[0].handle, accessJwt: 'demo.access.jwt', refreshJwt: 'demo.refresh.jwt', active: true };
        break;
      case 'app.bsky.actor.getPreferences':
        json = { preferences: [{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [
          { id: 'mobile-layout', type: 'feed', value: FEED_URI, pinned: true },
        ] }] };
        break;
      case 'app.bsky.feed.getFeedGenerators':
        json = { feeds: [{
          uri: FEED_URI, cid: BSKY_FEED[0].post.cid, did: ACCOUNTS[0].did,
          creator: BSKY_PROFILE, displayName: 'Mobile test feed', indexedAt: '2026-01-01T12:00:00.000Z',
        }] };
        break;
      case 'app.bsky.feed.getTimeline':
      case 'app.bsky.feed.getAuthorFeed':
      case 'app.bsky.feed.getFeed':
        json = { feed };
        break;
      case 'app.bsky.actor.getProfile':
        json = BSKY_PROFILE;
        break;
      default:
        // Mastodon filters/conversations/timeline can be empty; its connected
        // account still exercises the extra platform controls in the toolbar.
        if (url.hostname === 'social.example') json = [];
    }
    // No live social-network traffic or real accounts are needed by this test.
    await route.fulfill({ json, headers });
  });

  await page.goto(new URL('/', origin).href);
  await expect(page.getByRole('button', { name: /Threads Instagram/ })).toBeVisible();
  await page.evaluate(async ({ accounts, seed }) => {
    localStorage.setItem('crispdeck-key', seed.cryptoKey);
    localStorage.setItem('crispdeck-salt-v2', seed.cryptoSalt);
    localStorage.setItem('crispdeck-lang', 'en');
    localStorage.setItem('crispdeck-live-counters', 'false');
    localStorage.setItem('crispdeck-media-preview', 'true');
    const salt = Uint8Array.from(atob(seed.cryptoSalt), character => character.charCodeAt(0));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed.cryptoKey), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    );
    const rows: Record<string, unknown>[] = [];
    for (const { credentials, ...account } of accounts) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(credentials)));
      const packed = new Uint8Array(iv.length + encrypted.byteLength);
      packed.set(iv); packed.set(new Uint8Array(encrypted), iv.length);
      rows.push({ ...account, credentials_enc: btoa(String.fromCharCode(...packed)), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crispdeck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Finish encryption before opening the transaction, which otherwise can
    // auto-commit while crypto work is pending.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      for (const row of rows) tx.objectStore('accounts').put(row);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { accounts: ACCOUNTS, seed: SEED });
  await page.goto(new URL('/feed', origin).href);
  await expect(page.getByRole('combobox', { name: 'Switch feed' })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
}

async function expectUsableControl(control: Locator, width: number) {
  await expect(control).toBeInViewport({ ratio: 1 });
  const bounds = (await control.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  const textLines = await control.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops = new Set<number>();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) tops.add(Math.round(rect.top));
    }
    return tops.size;
  });
  expect(textLines, 'toolbar labels must not break into stacked words').toBeLessThanOrEqual(1);
}

for (const width of [320, 360, 390, 430]) {
  test(`feed controls remain readable and tappable at ${width}px with touch`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await seedFeed(page, baseURL!);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    const main = page.locator('#main-content');
    const header = (await page.locator('.mobile-top-bar').boundingBox())!;
    const controls = page.locator('.mobile-feed-controls');
    const bounds = (await controls.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(header.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(header.y + header.height + 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    const mode = page.getByRole('combobox', { name: 'Switch feed' });
    const platform = page.getByRole('combobox', { name: 'Platform' });
    await expect(mode).toBeVisible();
    await expect(platform).toBeVisible();
    await expect(mode.locator('optgroup[label="Views"]')).toHaveCount(1);
    await expect(mode.locator('optgroup[label="Pinned feeds"]')).toHaveCount(1);
    await expect(mode.locator('optgroup[label="Discover"]')).toHaveCount(1);
    await mode.selectOption('discover');
    const menu = main.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBounds = (await menu.boundingBox())!;
    const tabs = (await page.locator('.mobile-tab-bar').boundingBox())!;
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
    expect(menuBounds.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(tabs.y);
    await menu.getByRole('menuitem', { name: /^Mobile test feed/ }).tap();
    await expect(menu).toHaveCount(0);
    await mode.selectOption('timeline');
    await mode.selectOption('discover');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Mobile test feed/ }).tap();
    await mode.selectOption('timeline');
    await expect(main.getByAltText(IMAGE_ALT)).toBeVisible();
    await page.getByLabel('Filters & Sort').first().click();
    const options = page.locator('.mobile-options-menu');
    const media = options.getByRole('button', { name: 'Hide media', exact: true });
    await media.tap();
    await expect(media).toHaveAttribute('aria-pressed', 'true');
    await expect(main.getByAltText(IMAGE_ALT)).toHaveCount(0);
    await media.tap();
    await expect(main.getByAltText(IMAGE_ALT)).toBeVisible();
    const filters = options.getByRole('button', { name: 'Filters & Sort', exact: true });
    await filters.tap();
    await expect(filters).toHaveAttribute('aria-expanded', 'true');
    await expect(main.getByPlaceholder('Search in posts...')).toBeVisible();
    await filters.tap();
    await expect(main.getByPlaceholder('Search in posts...')).toHaveCount(0);
    await page.locator('.mobile-feed-options summary').click();
    await expect(main.locator('.feed-item').first().locator('.post-card')).toHaveCSS('border-radius', '0px');
    await expect(main.locator('.feed-item').first().locator('[class*="account-attribution"]')).toHaveCount(0);
    const separation = await main.locator('.feed-item').evaluateAll(items => items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().bottom);
    expect(separation, 'compact posts have no empty gap between them').toBeLessThanOrEqual(1);

    const post = main.locator('article').first();
    const actionLayout = await post.evaluate(element => {
      const card = element.getBoundingClientRect();
      const actions = element.querySelector('.post-actions')!;
      const bounds = actions.getBoundingClientRect();
      return {
        bottomGap: card.bottom - bounds.bottom,
        controls: Array.from(actions.children, control => {
          const rect = control.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
        }),
        left: card.left, right: card.right,
      };
    });
    expect(actionLayout.controls).toHaveLength(5);
    expect(actionLayout.bottomGap, 'collapsed secondary actions must not leave blank rows').toBeLessThanOrEqual(20);
    for (const control of actionLayout.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(control.y - actionLayout.controls[0].y)).toBeLessThan(1);
      expect(control.x).toBeGreaterThanOrEqual(actionLayout.left);
      expect(control.right).toBeLessThanOrEqual(actionLayout.right);
    }
    const previewToggle = post.locator('.preview-toggle');
    if (await previewToggle.count()) {
      const toggleBounds = (await previewToggle.boundingBox())!;
      expect(Math.abs(toggleBounds.y - actionLayout.controls[0].y)).toBeLessThan(1);
      await expect(previewToggle.locator('.preview-toggle-short')).toHaveText('More');
      await expect(previewToggle.locator('.preview-toggle-short')).toBeVisible();
      await expect(previewToggle).toHaveAccessibleName('Show full post');
    }
    const more = post.getByRole('button', { name: 'More post actions', exact: true });
    await more.tap();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const actions = post.getByRole('group', { name: 'More post actions', exact: true });
    for (const name of ['Quote post', 'Copy link to post', 'Translate post', 'Report post']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await actions.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(actions).toBeHidden();
    await main.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`android-feed-${width}.png`) });
    if (width === 390) {
      await page.setViewportSize({ width: 1024, height: 844 });
      await expect(main.locator('.feed-item').first().locator('.post-card')).toHaveCSS('border-radius', '0px');
      const desktopGap = await main.locator('.feed-item').evaluateAll(items => items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().bottom);
      expect(desktopGap).toBeLessThanOrEqual(1);
    }
  });
}
