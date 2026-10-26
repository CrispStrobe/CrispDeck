import { test, expect, type Page } from '@playwright/test';

/** Real storage + real UI, with only remote network boundaries stubbed. */
async function connectTestAccounts(page: Page, count = 2) {
  await page.goto('/compose');
  await expect(page.locator('textarea').first()).toBeVisible();
  await page.evaluate(async count => {
    const seed = 'crispdeck-browser-test-seed';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem('crispdeck-key', seed);
    localStorage.setItem('crispdeck-salt-v2', btoa(String.fromCharCode(...salt)));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const records = [];
    for (let id = 1; id <= count; id++) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ access_token: `test-account-${id}` })));
      const bytes = new Uint8Array(iv.length + encrypted.byteLength);
      bytes.set(iv); bytes.set(new Uint8Array(encrypted), iv.length);
      records.push({
        id, platform: 'mastodon', handle: `writer${id}@${id}.social.test`, display_name: `Writer ${id}`,
        avatar_url: null, instance_url: `https://${id}.social.test`, mastodon_id: String(id),
        credentials_enc: btoa(String.fromCharCode(...bytes)), is_primary: id === 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crispdeck');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      for (const record of records) tx.objectStore('accounts').put(record);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, count);
  await page.reload();
  await expect(page.getByRole('button', { name: /writer1@/ }).first()).toBeVisible();
}

type Sent = { account: string; text: string; parent?: string; key?: string; id: string };
async function fakeNetworks(page: Page, reject: (sent: Sent, number: number) => boolean = () => false) {
  const attempts: Sent[] = [];
  await page.route('https://*.social.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204 }); return; }
    if (request.method() === 'POST' && url.pathname === '/api/v1/statuses') {
      const body = request.postDataJSON();
      const sent = { account: url.hostname.split('.')[0], text: body.status, parent: body.in_reply_to_id, key: request.headers()['idempotency-key'], id: String(100 + attempts.length) };
      attempts.push(sent);
      if (reject(sent, attempts.length)) await route.fulfill({ status: 401, json: { error: 'Session expired. Reconnect this account.' } });
      else await route.fulfill({ json: { id: sent.id, uri: `https://${url.hostname}/users/writer/statuses/${sent.id}`, url: `https://${url.hostname}/@writer/${sent.id}` } });
    } else if (url.pathname === '/api/v2/media') {
      await route.fulfill({ json: { id: 'media1' } });
    } else await route.fulfill({ json: [] });
  });
  return attempts;
}

test('partial crossposts survive reload and retry only the failed account', async ({ page }) => {
  let rejected = false;
  const attempts = await fakeNetworks(page, sent => sent.account === '2' && !rejected && (rejected = true));
  await connectTestAccounts(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('textarea').first().fill('A durable crosspost');
  const geometry = await page.getByTestId('publish-post').boundingBox();
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByTestId('publish-post').click();
  await expect(page.getByText('Partially published', { exact: true })).toBeVisible();
  expect(attempts.map(a => a.account)).toEqual(['1', '2']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry failed destinations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry failed destinations', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  expect(attempts.map(a => a.account)).toEqual(['1', '2', '2']);
  expect(attempts[1].key).toBe(attempts[2].key);
});

test('a failed thread resumes after the saved parent instead of reposting its first part', async ({ page }) => {
  const attempts = await fakeNetworks(page, (_sent, count) => count === 2);
  await connectTestAccounts(page, 1);
  await page.locator('textarea').first().fill('This is a sentence for a longer thread. '.repeat(30));
  await page.getByTestId('publish-post').click();
  await expect(page.getByRole('button', { name: 'Retry failed destinations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry failed destinations', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  expect(attempts[2].parent).toBe(attempts[0].id);
  expect(attempts.filter(a => a.text === attempts[0].text)).toHaveLength(1);
});

test('autosave restores image bytes, alt text, destination text and visibility after reload', async ({ page }) => {
  await fakeNetworks(page);
  await connectTestAccounts(page, 1);
  await page.locator('textarea').first().fill('Draft with a photo');
  await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0KsAAAAASUVORK5CYII=', 'base64') });
  await page.getByPlaceholder(/Describe this image/).fill('A tiny test image');
  await page.getByText('Advanced options', { exact: true }).click();
  await page.locator('select').filter({ has: page.locator('option[value=private]') }).selectOption('private');
  await page.getByText('Destination text', { exact: true }).click();
  await page.getByLabel('Destination text · @writer1@1.social.test').fill('Custom destination text');
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('crispdeck-publishing'); r.onsuccess = () => resolve(r.result); });
    const data = await new Promise<any>(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').get('autosave'); r.onsuccess = () => resolve(r.result); });
    db.close();
    return data?.options.altTexts?.[0];
  })).toBe('A tiny test image');
  await page.reload();
  await expect(page.locator('textarea').first()).toHaveValue('Draft with a photo');
  await expect(page.getByPlaceholder(/Describe this image/)).toHaveValue('A tiny test image');
  await expect(page.locator('img[alt="A tiny test image"]').first()).toBeVisible();
  await page.getByText('Advanced options', { exact: true }).click();
  await expect(page.locator('select').filter({ has: page.locator('option[value=private]') })).toHaveValue('private');
  await page.getByText('Destination text', { exact: true }).click();
  await expect(page.getByLabel('Destination text · @writer1@1.social.test')).toHaveValue('Custom destination text');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(page.getByText('Draft saved with media and destination settings.', { exact: true })).toBeVisible();
  await page.locator('main a[href="/drafts"]').click();
  await page.locator('main a[href*="/compose?draft="]').first().click();
  await expect(page.getByPlaceholder(/Describe this image/)).toHaveValue('A tiny test image');
  await expect(page.locator('img[alt="A tiny test image"]').first()).toBeVisible();
});

test('a scheduled draft publishes from another route and never repeats after a partial failure', async ({ page }) => {
  let rejected = false;
  const attempts = await fakeNetworks(page, sent => sent.account === '2' && !rejected && (rejected = true));
  await connectTestAccounts(page);
  await page.locator('textarea').first().fill('Scheduled across routes');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.getByText(/Keep CrispDeck open/)).toBeVisible();
  const future = new Date(Date.now() + 3_600_000);
  await page.locator('input[type=date]').fill(future.toISOString().slice(0, 10));
  await page.locator('input[type=time]').fill(future.toISOString().slice(11, 16));
  await page.getByRole('button', { name: 'Schedule Post', exact: true }).click();
  await expect(page.locator('textarea').first()).toHaveValue('');
  // Advance the durable job's due time, then wake the app on a different route.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('crispdeck'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => {
      const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts');
      const r = store.getAll(); r.onsuccess = () => { for (const draft of r.result) store.put({ ...draft, scheduled_at: new Date(Date.now() - 60_000).toISOString() }); };
      tx.oncomplete = () => resolve();
    }); db.close();
  });
  await page.locator('nav[aria-label="Main navigation"] a[href="/search"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => attempts.length).toBe(2);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.goto('/drafts');
  await expect(page.getByText('Partially published', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  await page.getByRole('button', { name: 'Retry failed destinations', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(3);
  expect(attempts[2].account).toBe('2');
});

test('starter preview needs no account and the chosen workspace is usable in Deck', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Community monitoring', exact: true }).click();
  await expect(page.getByText('Sample data', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this workspace', exact: true }).click();
  const columns = await page.evaluate(() => JSON.parse(localStorage.getItem('crispdeck-deck-columns')!));
  expect(columns.map((column: { type: string }) => column.type)).toEqual(['mentions', 'hashtag', 'search']);
  await page.locator('nav[aria-label="Main navigation"] a[href="/deck"]').click();
  await expect(page).toHaveTitle(/Deck/);
  await expect(page.getByRole('button', { name: 'Add Column', exact: true })).toBeVisible();
});

test('overdue drafts wait offline and resume on reconnect', async ({ page, context }) => {
  const attempts = await fakeNetworks(page);
  await connectTestAccounts(page, 1);
  await page.locator('textarea').first().fill('Resume after offline');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(page.getByText('Draft saved with media and destination settings.', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('crispdeck'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => {
      const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts');
      const r = store.getAll(); r.onsuccess = () => { for (const draft of r.result) store.put({ ...draft, scheduled_at: new Date(Date.now() - 60_000).toISOString() }); };
      tx.oncomplete = () => resolve();
    }); db.close();
    window.dispatchEvent(new Event('crispdeck-drafts-change'));
  });
  await expect(page.getByText(/You're offline/)).toBeVisible();
  expect(attempts).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(() => attempts.length).toBe(1);
  await page.goto('/drafts');
  await expect(page.getByText('Published · Resume after offline', { exact: true })).toBeVisible();
});
