import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test('search finds a Mastodon account by name and address and opens its profile', async ({ page }) => {
  const person = { id: '55', username: 'BlumeEvolution', acct: 'BlumeEvolution@sueden.social', display_name: 'Michael Blume', avatar: '', header: '', note: '', followers_count: 20, following_count: 10, statuses_count: 2, url: 'https://sueden.social/@BlumeEvolution' };
  const people = Array.from({ length: 35 }, (_, i) => i === 0 ? person : { ...person, id: String(55 + i), acct: `BlumeEvolution${i}@sueden.social`, display_name: `Michael Blume ${i}` });
  let searches = 0;
  await page.route('https://mastodon.social/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v2/search') { searches++; return route.fulfill({ json: url.searchParams.get('type') === 'accounts' ? { accounts: url.searchParams.get('q') === 'michael blume' ? people : [person] } : { statuses: [] } }); }
    if (url.pathname === '/api/v1/accounts/lookup') return route.fulfill({ json: person });
    if (url.pathname === '/api/v1/accounts/55/statuses') return route.fulfill({ json: [] });
    if (url.pathname === '/api/v1/accounts/relationships') return route.fulfill({ json: [{ following: true }] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/compose');
  await page.evaluate(async () => {
    localStorage.setItem('crispdeck-first-run-complete', 'true');
    const salt = crypto.getRandomValues(new Uint8Array(32)); const seed = 'mastodon-search-test';
    localStorage.setItem('crispdeck-key', seed); localStorage.setItem('crispdeck-salt-v2', btoa(String.fromCharCode(...salt)));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ access_token: 'test-token' })));
    const data = new Uint8Array(iv.length + encrypted.byteLength); data.set(iv); data.set(new Uint8Array(encrypted), iv.length);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('crispdeck'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('accounts', 'readwrite'); tx.objectStore('accounts').put({ id: 1, platform: 'mastodon', handle: 'reader@mastodon.social', instance_url: 'https://mastodon.social', mastodon_id: '1', credentials_enc: btoa(String.fromCharCode(...data)), is_primary: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  });
  await page.goto('/search');
  const input = page.locator('input[type="text"], input[type="search"]').first();
  for (const query of ['michael blume', '@BlumeEvolution@sueden.social']) {
    await input.fill(query);
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled({ timeout: 30000 });
    await input.press('Enter');
    const actor = page.getByRole('link', { name: /Michael Blume/ }).first();
    await expect(actor).toBeVisible();
    await expect(actor).toHaveAttribute('href', /platform=mastodon/);
  }
  await page.getByRole('link', { name: /Michael Blume/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Michael Blume' })).toBeVisible();
  await expect(page.getByText(/Invalid AT identifier/)).toHaveCount(0);
  const count = searches;
  await page.getByRole('button', { name: 'Back to search' }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.locator('input[type="text"], input[type="search"]').first()).toHaveValue('@BlumeEvolution@sueden.social');
  await expect(page.getByRole('link', { name: /Michael Blume/ }).first()).toBeVisible();
  expect(searches).toBe(count);
  await input.fill('michael blume'); await input.press('Enter');
  const selected = page.getByRole('link', { name: 'Michael Blume 25 @BlumeEvolution25@sueden.social' });
  await expect(selected).toBeVisible();
  await selected.scrollIntoViewIfNeeded();
  const before = await page.locator('#main-content').evaluate(el => el.scrollTop);
  expect(before).toBeGreaterThan(500);
  await selected.evaluate(el => el.addEventListener('click', () => sessionStorage.setItem('test-click-scroll', String(document.getElementById('main-content')?.scrollTop)), { once: true, capture: true }));
  await selected.click();
  const atClick = await page.evaluate(() => Number(sessionStorage.getItem('test-click-scroll')));
  expect(atClick).toBeGreaterThan(500);
  await expect(page.getByRole('heading', { name: 'Michael Blume' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to search' }).click();
  await expect(page.getByRole('link', { name: 'Michael Blume 25 @BlumeEvolution25@sueden.social' })).toBeInViewport();
  await expect.poll(() => page.locator('#main-content').evaluate(el => el.scrollTop)).toBeGreaterThan(atClick - 40);
  await expect.poll(() => page.locator('#main-content').evaluate(el => el.scrollTop)).toBeLessThan(atClick + 40);
  await page.goto('/profile?handle=BlumeEvolution%40digitalcourage.social&platform=bluesky');
  await expect(page.getByRole('heading', { name: 'Michael Blume' })).toBeVisible();
  await expect(page.getByText(/Invalid AT identifier/)).toHaveCount(0);
});
