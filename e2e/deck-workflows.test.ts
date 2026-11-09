import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.setTimeout(60000);

async function seedDeck(page: Page) {
  await page.goto('/compose');
  await expect(page.locator('textarea').first()).toBeVisible();
  await page.evaluate(async () => {
    localStorage.setItem('crispdeck-first-run-complete', 'true');
    localStorage.setItem('crispdeck-live-counters', 'false');
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const seed = 'deck-workflow-test';
    localStorage.setItem('crispdeck-key', seed);
    localStorage.setItem('crispdeck-salt-v2', btoa(String.fromCharCode(...salt)));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const records = [];
    for (const id of [1, 2]) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ access_token: `deck-token-${id}` })));
      const data = new Uint8Array(iv.length + encrypted.byteLength); data.set(iv); data.set(new Uint8Array(encrypted), iv.length);
      records.push({ id, platform: 'mastodon', handle: `writer${id}@social.test`, display_name: `Writer ${id}`, avatar_url: null, did: null, mastodon_id: String(id), instance_url: 'https://social.test', credentials_enc: btoa(String.fromCharCode(...data)), is_primary: id === 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('crispdeck'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite'); for (const record of records) tx.objectStore('accounts').put(record);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify([{ id: 'following', title: 'Following two', type: 'timeline', accountIds: [2], streaming: false }]));
  });
  await page.goto('/deck');
}

function status(id: string, text: string) {
  return { id, uri: `https://social.test/users/author/statuses/${id}`, url: `https://social.test/@author/${id}`, content: `<p>${text}</p>`, created_at: `2026-11-06T10:${String(Number(id) % 60).padStart(2, '0')}:00Z`, account: { id: '7', acct: 'author', username: 'author', display_name: 'Author', avatar: '', url: 'https://social.test/@author' }, media_attachments: [], favourites_count: 0, reblogs_count: 0, replies_count: 0, favourited: false, reblogged: false, spoiler_text: '', visibility: 'public' };
}

async function network(page: Page) {
  const calls: { path: string; token: string; max: string | null }[] = [];
  let refreshed = false;
  await page.route('https://social.test/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const token = request.headers().authorization ?? '';
    calls.push({ path: url.pathname, token, max: url.searchParams.get('max_id') });
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204 }); return; }
    if (url.pathname === '/api/v1/timelines/home') {
      const mine = token.endsWith('-2');
      if (url.searchParams.get('max_id')) await route.fulfill({ json: [status('88', 'An older page')], headers: { Link: '' } });
      else await route.fulfill({ json: [...(refreshed ? [status('105', 'A fresh arrival')] : []), status('100', mine ? 'Account two newest' : 'Account one newest'), status('99', 'A noisy post')], headers: { Link: '<https://social.test/api/v1/timelines/home?max_id=99>; rel="next"' } });
    } else if (/\/statuses\/\d+\/(un)?favourite$/.test(url.pathname)) await route.fulfill({ json: status('100', 'Account two newest') });
    else if (url.pathname === '/api/v1/accounts/verify_credentials') await route.fulfill({ json: { id: token.endsWith('-2') ? '2' : '1', acct: 'writer', url: 'https://social.test/@writer' } });
    else await route.fulfill({ json: [] });
  });
  return { calls, refresh: () => refreshed = true };
}

test('account-scoped pagination preserves older pages and filters survive reload', async ({ page }) => {
  const remote = await network(page);
  await seedDeck(page);
  const column = page.getByRole('region', { name: 'Following two', exact: true });
  await expect(column.getByText('Account two newest', { exact: true })).toBeVisible();
  expect(remote.calls.filter(call => call.path.endsWith('/home')).every(call => call.token === 'Bearer deck-token-2')).toBe(true);
  await column.getByRole('button', { name: 'Load older items' }).click();
  await expect(column.getByText('An older page', { exact: true })).toBeVisible();
  remote.refresh();
  await column.getByRole('button', { name: 'Refresh column', exact: true }).first().click();
  await expect(column.getByText('A fresh arrival', { exact: true })).toBeVisible();
  await expect(column.getByText('An older page', { exact: true })).toBeVisible();
  await column.getByRole('button', { name: 'Column settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Column settings' });
  await dialog.getByLabel('Exclude words or phrases, separated by commas').fill('noisy');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(column.getByText('A noisy post', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(column.getByText('Account two newest', { exact: true })).toBeVisible();
  await expect(column.getByText('A noisy post', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)[0].filters.excludeText)).toBe('noisy');
});

test('like and unlike use the row source account on a shared instance', async ({ page }) => {
  const remote = await network(page); await seedDeck(page);
  const row = page.locator('[data-post-uri="https://social.test/users/author/statuses/100"]');
  await row.getByRole('button', { name: /^Like \(/ }).click();
  await expect.poll(() => remote.calls.filter(call => call.path.endsWith('/favourite')).length).toBe(1);
  await row.getByRole('button', { name: /^Unlike \(/ }).click();
  await expect.poll(() => remote.calls.filter(call => call.path.endsWith('/unfavourite')).length).toBe(1);
  expect(remote.calls.filter(call => /\/(un)?favourite$/.test(call.path)).map(call => call.token)).toEqual(['Bearer deck-token-2', 'Bearer deck-token-2']);
});

test('Deck post rows use separators and actions stay visible near the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await network(page); await seedDeck(page);
  const column = page.getByRole('region', { name: 'Following two', exact: true });
  const cards = column.locator('.post-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveCSS('border-radius', '0px');
  const more = cards.last().getByRole('button', { name: 'More post actions', exact: true });
  await more.scrollIntoViewIfNeeded();
  await more.click();
  const dialog = page.getByRole('dialog', { name: 'More post actions' });
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});

test('Deck notifications link the actor and the actual liked post', async ({ page }) => {
  await network(page); await seedDeck(page);
  await page.route('https://social.test/api/v1/notifications**', async route => {
    await route.fulfill({ json: [{ id: '17', type: 'favourite', created_at: '2026-11-06T10:00:00Z', account: { id: '7', acct: 'author', username: 'author', display_name: '•', avatar: '', url: 'https://social.test/@author' }, status: status('100', 'This was liked') }] });
  });
  await page.evaluate(() => localStorage.setItem('crispdeck-deck-columns', JSON.stringify([{ id: 'notifications-test', title: 'Notifications test', type: 'notifications', accountIds: [2], streaming: false }])));
  await page.reload();
  const column = page.getByRole('region', { name: 'Notifications test', exact: true });
  const actor = column.getByRole('link', { name: /author@social.test/ });
  await expect(actor).toHaveAttribute('href', /profile\?handle=/);
  const post = column.getByRole('link', { name: 'This was liked', exact: true });
  await expect(post).toHaveAttribute('href', /thread\?id=100&platform=mastodon&account=2/);
});

test('workspaces export/import safely, retain account identity and stay usable on mobile', async ({ page }, testInfo) => {
  await network(page); await seedDeck(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const workspaces = page.getByRole('button', { name: 'Workspaces', exact: true });
  await expect(workspaces).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Following two', exact: true })).toBeVisible();
  await workspaces.click();
  const dialog = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  await dialog.getByLabel('Workspace name', { exact: true }).fill('Monitoring');
  await dialog.getByRole('button', { name: 'Save current columns', exact: true }).click();
  await expect(dialog.getByText('Workspace saved.', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.locator('section').filter({ hasText: 'Monitoring' }).getByRole('button', { name: 'Export workspace', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const contents = await readFile(path!, 'utf8');
  expect(contents).not.toContain('deck-token');
  expect(contents).not.toContain('accountIds');
  const exported = JSON.parse(contents);
  expect(exported.layouts).toHaveLength(1);
  expect(exported.layouts[0].columns).toHaveLength(1);
  expect(exported.layouts[0].columns[0]).toMatchObject({
    title: 'Following two', type: 'timeline',
    selectedAccounts: [{ platform: 'mastodon', handle: 'writer2@social.test' }],
  });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'workspaces.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  await expect(dialog.getByText('Imported 1 workspace(s).', { exact: true })).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('region', { name: 'Following two', exact: true }).getByRole('button', { name: 'Column settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Column settings' });
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('deck-mobile.png'), fullPage: true });
});

test('empty account selection stays empty and paused columns show their state', async ({ page }) => {
  await network(page); await seedDeck(page);
  const column = page.getByRole('region', { name: 'Following two', exact: true });
  await expect(column.getByText('Account two newest', { exact: true })).toBeVisible();
  await column.locator('summary').first().click();
  await column.getByRole('button', { name: 'Pause updates', exact: true }).click();
  await expect(column.getByText('Paused', { exact: true })).toBeVisible();
  await column.getByRole('button', { name: 'Column settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Column settings' });
  await dialog.getByLabel(/@writer2@social.test/).uncheck();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(column.getByText(/No compatible account selected/)).toBeVisible();
  await page.reload();
  await expect(column.getByText(/No compatible account selected/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)[0].accountIds)).toEqual([]);
});

test('Deck details return to the originating Deck', async ({ page }) => {
  await network(page); await seedDeck(page);
  const column = page.getByRole('region', { name: 'Following two', exact: true });
  await expect(column.locator('.post-card').first()).toBeVisible();
  await column.locator('.post-card').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/(thread|profile)\?/);
  const back = page.getByRole('button', { name: 'Back to Deck' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/deck$/);
  const restored = page.getByRole('region', { name: 'Following two', exact: true });
  await expect(restored).toBeVisible();
  await restored.locator('.post-card').first().locator('.post-body').click();
  await expect(page).toHaveURL(/\/thread\?/);
  await expect(page.getByRole('button', { name: 'Back to Deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Deck' }).click();
  await expect(page).toHaveURL(/\/deck$/);
});

test('column header keeps controls on one row and accounts beside search', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await network(page); await seedDeck(page);
  const column = page.getByRole('region', { name: 'Following two', exact: true });
  const title = column.getByText('Following two', { exact: true });
  const menu = column.locator('summary').first();
  await expect(title).toBeVisible();
  const titleBox = (await title.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(titleBox.y + titleBox.height / 2 - (menuBox.y + menuBox.height / 2))).toBeLessThan(4);
  await menu.click();
  await expect(column.getByTitle('Auto-scroll off (click to enable)')).toBeVisible();
});
