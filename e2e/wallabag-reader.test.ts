import { test, expect, type Page } from '@playwright/test';

const SERVER = 'https://wallabag-reader.example';
const SETTINGS = '/settings?tab=appearance#wallabag-settings';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Exercise the real encrypted storage, navigation and reader against a mock server. */
async function wallabagServer(page: Page) {
  const articles = Array.from({ length: 32 }, (_, index) => ({
    id: index + 1,
    title: index === 0 ? 'A calmer reading habit' : `Saved article ${index + 1}`,
    url: `https://articles.example/stories/${index + 1}`,
    content: '<h2>Read at your own pace</h2><p>A saved article with <strong>useful context</strong>.</p>' +
      '<a href="/related">Related article</a><script>window.wallabagUnsafe = true</script>' +
      '<img src="javascript:alert(1)" onerror="window.wallabagUnsafe = true" alt="Unsafe image" />',
    is_archived: index === 31 ? 1 : 0,
    is_starred: index === 31 ? 1 : 0,
    created_at: '2026-11-01T10:00:00+00:00',
    reading_time: 4,
    domain_name: 'articles.example',
    preview_picture: index === 0 ? 'https://articles.example/preview.jpg' : null,
    tags: [{ id: 1, label: 'Reading', slug: 'reading' }],
  }));
  const state = { rejectLogin: false, rejectReader: false, revoked: false, probeCount: 0, probeGate: undefined as Promise<void> | undefined, patchCount: 0 };
  await page.context().route(`${SERVER}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'content-type': 'application/json',
    };
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/oauth/v2/token') {
      if (state.rejectLogin || state.revoked) return reply({ error: 'invalid_grant' }, 400);
      return reply({ access_token: 'test-reader-access-token', refresh_token: 'test-reader-refresh-token', expires_in: 3600, token_type: 'bearer' });
    }
    if (state.revoked) return reply({ error: 'invalid_token' }, 401);
    if (state.rejectReader) return reply({ error: 'access_denied' }, 403);
    if (request.headers().authorization !== 'Bearer test-reader-access-token') return reply({}, 401);
    if (url.pathname === '/api/search.json') {
      const term = (url.searchParams.get('term') ?? '').toLowerCase();
      const filtered = articles.filter(article => article.title.toLowerCase().includes(term));
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('perPage') ?? 30);
      return reply({ _embedded: { items: filtered.slice((pageNumber - 1) * perPage, pageNumber * perPage) }, page: pageNumber, pages: Math.ceil(filtered.length / perPage), total: filtered.length });
    }
    if (url.pathname === '/api/entries.json') {
      const perPage = Number(url.searchParams.get('perPage') ?? 30);
      if (perPage === 1) {
        state.probeCount++;
        await state.probeGate;
      }
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const filtered = articles.filter(article =>
        (!url.searchParams.has('archive') || article.is_archived === Number(url.searchParams.get('archive'))) &&
        (!url.searchParams.has('starred') || article.is_starred === Number(url.searchParams.get('starred'))));
      const items = filtered.slice((pageNumber - 1) * perPage, pageNumber * perPage).map(({ content, ...metadata }) => metadata);
      return reply({ _embedded: { items }, page: pageNumber, pages: Math.ceil(filtered.length / perPage), limit: perPage, total: filtered.length });
    }
    const match = url.pathname.match(/^\/api\/entries\/(\d+)\.json$/);
    if (match) {
      const article = articles.find(item => item.id === Number(match[1]));
      if (!article) return reply({}, 404);
      if (request.method() === 'PATCH') {
        const update = request.postDataJSON();
        if ('archive' in update) article.is_archived = update.archive;
        if ('starred' in update) article.is_starred = update.starred;
        state.patchCount++;
      }
      return reply(article);
    }
    return reply({}, 404);
  });
  return state;
}

async function connect(page: Page) {
  await page.goto(SETTINGS);
  const settings = page.locator('#wallabag-settings');
  await settings.getByLabel('Wallabag server URL').fill(SERVER);
  await settings.getByLabel('Client ID', { exact: true }).fill('test-reader-client');
  await settings.getByLabel('Client secret', { exact: true }).fill('test-reader-secret');
  await settings.getByLabel('Username', { exact: true }).fill('test-reader');
  await settings.getByLabel('Password', { exact: true }).fill('test-reader-password');
  await settings.getByRole('button', { name: 'Connect Wallabag', exact: true }).click();
}

async function openReader(page: Page) {
  await expect(page.locator('#wallabag-settings').getByRole('link', { name: 'Wallabag Reader' })).toBeVisible();
  await page.locator('#wallabag-settings').getByRole('link', { name: 'Wallabag Reader' }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
}

test('hides the reader for no credentials, a URL alone, and corrupt saved credentials', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().startsWith(SERVER)) requests.push(request.url()); });
  await page.goto('/wallabag');
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
  await expect(page.locator('nav a[href="/wallabag"]')).toHaveCount(0);
  await page.evaluate(server => localStorage.setItem('crispdeck-wallabag-url', server), SERVER);
  await page.reload();
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('crispdeck-wallabag-session', 'broken-ciphertext'));
  await page.reload();
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
  await expect(page.locator('nav a[href="/wallabag"]')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('requires a successful saved-session probe, then reads, pages, stars and archives articles', async ({ page }) => {
  const server = await wallabagServer(page);
  const gate = deferred();
  server.probeGate = gate.promise;
  await connect(page);
  await expect.poll(() => server.probeCount).toBe(1);
  await expect(page.locator('a[href="/wallabag"]')).toHaveCount(0);
  gate.resolve();
  await openReader(page);
  const saved = await page.evaluate(() => localStorage.getItem('crispdeck-wallabag-session'));
  expect(saved).toBeTruthy();
  expect(saved).not.toContain('test-reader-secret');
  expect(saved).not.toContain('test-reader-password');
  expect(saved).not.toContain('test-reader-access-token');

  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('[data-wallabag-entry="31"]')).toBeVisible();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.locator('[data-wallabag-entry="1"]').click();
  await expect(page.getByRole('heading', { name: 'Read at your own pace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Related article' })).toHaveAttribute('href', 'https://articles.example/related');
  await expect(page.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', 'https://articles.example/stories/1');
  await expect(page.locator('article script, article [onerror], article img[src^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { wallabagUnsafe?: boolean }).wallabagUnsafe)).toBeUndefined();
  expect(server.patchCount).toBe(0); // Opening alone must not mark read.

  await page.getByRole('button', { name: 'Star article', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unstar article', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
  await page.locator('[data-wallabag-entry="1"]').click();
  await expect(page.getByRole('button', { name: 'Mark as unread', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as unread', exact: true }).click();
  await page.getByRole('button', { name: 'Starred', exact: true }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
  await page.locator('[data-wallabag-entry="1"]').click();
  await page.getByRole('button', { name: 'Unstar article', exact: true }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toHaveCount(0);
  expect(server.patchCount).toBe(4);
});

test('revalidates persisted credentials after reload and hides revoked ones', async ({ page }) => {
  const server = await wallabagServer(page);
  await connect(page);
  await openReader(page);
  const probes = server.probeCount;
  await page.reload();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
  expect(server.probeCount).toBeGreaterThan(probes);
  server.revoked = true;
  await page.reload();
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
  await expect(page.locator('nav a[href="/wallabag"]')).toHaveCount(0);
  await expect(page.locator('[data-wallabag-entry]')).toHaveCount(0);
});

test('does not expose the reader when credentials save but reader access is denied', async ({ page }) => {
  const server = await wallabagServer(page);
  server.rejectReader = true;
  await connect(page);
  await expect(page.locator('#wallabag-settings').getByRole('button', { name: 'Connect Wallabag', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('crispdeck-wallabag-session'))).toBeTruthy();
  await expect(page.locator('a[href="/wallabag"]')).toHaveCount(0);
  await page.goto('/wallabag');
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
});

test('removes navigation on disconnect and clears an open article after another tab disconnects', async ({ page }) => {
  await wallabagServer(page);
  await connect(page);
  await openReader(page);
  await page.locator('[data-wallabag-entry="1"]').click();
  await expect(page.getByRole('heading', { name: 'Read at your own pace' })).toBeVisible();
  const settingsTab = await page.context().newPage();
  await settingsTab.goto(SETTINGS);
  await expect(settingsTab.locator('#wallabag-settings').getByRole('link', { name: 'Wallabag Reader' })).toBeVisible();
  await settingsTab.getByRole('button', { name: 'Disconnect Wallabag', exact: true }).click();
  await expect(settingsTab.locator('a[href="/wallabag"]')).toHaveCount(0);
  await expect(page.getByText('Wallabag is not connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Read at your own pace' })).toHaveCount(0);
  await expect(page.locator('nav a[href="/wallabag"]')).toHaveCount(0);
});

test('offers the verified reader in mobile navigation with a usable article layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await wallabagServer(page);
  await connect(page);
  await expect(page.locator('#wallabag-settings').getByRole('link', { name: 'Wallabag Reader' })).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Main navigation' }).click();
  const navigation = page.locator('#mobile-navigation');
  await navigation.getByText('Library', { exact: true }).click();
  await navigation.getByRole('link', { name: 'Wallabag Reader' }).click();
  await page.locator('[data-wallabag-entry="1"]').click();
  await expect(page.getByRole('heading', { name: 'Read at your own pace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to articles' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('wallabag-reader-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to articles' }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
});

test('searches all saved articles and shows the saved preview', async ({ page }) => {
  await wallabagServer(page);
  await connect(page);
  await openReader(page);
  await expect(page.locator('[data-wallabag-entry="1"] .entry-thumbnail')).toHaveAttribute('src', 'https://articles.example/preview.jpg');
  await page.getByRole('searchbox', { name: 'Search all articles' }).fill('calmer');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('[data-wallabag-entry="1"]')).toBeVisible();
  await expect(page.locator('[data-wallabag-entry="2"]')).toHaveCount(0);
});

test('shows the saved connection after restarting without asking for credentials again', async ({ page }) => {
  await wallabagServer(page);
  await connect(page);
  const settings = page.locator('#wallabag-settings');
  await expect(settings.getByText('Connected. Your saved session is kept for future launches.')).toBeVisible();
  await page.reload();
  await expect(settings.getByText('Connected. Your saved session is kept for future launches.')).toBeVisible();
  await expect(settings.getByLabel('Password', { exact: true })).toHaveCount(0);
  await openReader(page);
});

test('article actions share the top row at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await wallabagServer(page); await connect(page); await openReader(page);
  await page.locator('[data-wallabag-entry="1"]').click();
  const toolbar = page.getByRole('group', { name: 'Article actions' });
  await expect(toolbar.getByRole('button', { name: 'Mark as read' })).toBeVisible();
  const controls = await toolbar.locator('button, a').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  expect(controls.length).toBe(4);
  expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(3);
});
