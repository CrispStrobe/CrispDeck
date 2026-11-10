import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test('search finds a Mastodon account by name and address and opens its profile', async ({ page }) => {
  const person = { id: '55', username: 'BlumeEvolution', acct: 'BlumeEvolution@sueden.social', display_name: 'Michael Blume', avatar: '', header: '', note: '', followers_count: 20, following_count: 10, statuses_count: 2, url: 'https://sueden.social/@BlumeEvolution' };
  await page.route('https://mastodon.social/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v2/search') return route.fulfill({ json: url.searchParams.get('type') === 'accounts' ? { accounts: [person] } : { statuses: [] } });
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
    await input.fill(query); await input.press('Enter');
    const actor = page.getByRole('link', { name: /Michael Blume/ });
    await expect(actor).toBeVisible();
    await expect(actor).toHaveAttribute('href', /platform=mastodon/);
  }
  await page.getByRole('link', { name: /Michael Blume/ }).click();
  await expect(page.getByRole('heading', { name: 'Michael Blume' })).toBeVisible();
  await expect(page.getByText(/Invalid AT identifier/)).toHaveCount(0);
  await page.goto('/profile?handle=BlumeEvolution%40digitalcourage.social&platform=bluesky');
  await expect(page.getByRole('heading', { name: 'Michael Blume' })).toBeVisible();
  await expect(page.getByText(/Invalid AT identifier/)).toHaveCount(0);
});
