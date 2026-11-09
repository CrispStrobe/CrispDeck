import { test, expect as playwrightExpect, type Page } from '@playwright/test';

test.setTimeout(60000);
const expect = playwrightExpect.configure({ timeout: 15000 });
const SETTINGS = '/settings?tab=content#local-search-cache';
const TITLE = 'Nebula notebook';
const FIRST_PARAGRAPH = 'Aurorafield appears in the first paragraph.';
const TAIL = 'Unindexedtailword appears only in the second paragraph.';

function cacheSettings(page: Page) { return page.locator('#local-search-cache'); }
function localSearch(page: Page) { return page.getByRole('region', { name: 'On this device', exact: true }); }

async function enableCache(page: Page) {
  await page.goto(SETTINGS);
  const section = cacheSettings(page);
  await expect(section.getByRole('checkbox', { name: 'Enable local cache and search', exact: true })).not.toBeChecked();
  await section.getByRole('checkbox', { name: 'Enable local cache and search', exact: true }).check();
  await section.getByRole('button', { name: 'Save cache settings', exact: true }).click();
  await expect(section.getByText('Cache settings saved.', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Index existing cache', exact: true })).toBeEnabled();
}

/**
 * Seed an ordinary source cache, never the search database. The real import
 * button must extract, limit, tokenize and persist this item. A dummy account
 * supplies provenance only; there are no credentials or remote API fixtures.
 */
async function seedScopedViewCache(page: Page) {
  // Let the application create its complete schema. Opening a missing DB and
  // leaving it at version 1 with only our fixture store would break the app.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>(resolve => {
      const request = indexedDB.open('crispdeck');
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return false;
    const ready = db.objectStoreNames.contains('accounts');
    db.close();
    return ready;
  })).toBe(true);

  await page.evaluate(async ({ title, first, tail }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crispdeck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const createdAt = new Date().toISOString();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        tx.objectStore('accounts').put({
          id: 42, platform: 'mastodon', handle: 'reader@local-search.invalid',
          display_name: 'Cache Reader', instance_url: 'https://local-search.invalid',
          is_primary: true, created_at: createdAt, updated_at: createdAt,
        });
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Fixture transaction failed'));
      });
    } finally {
      db.close();
    }

    const uri = 'https://local-search.invalid/users/writer/statuses/one';
    localStorage.setItem('crispdeck-vc-local-search-e2e', JSON.stringify({
      cachedAt: Date.now(),
      data: [{
        uri, platform: 'mastodon', text: `${first}\n\n${tail}`, createdAt,
        author: { handle: 'writer@local-search.invalid', displayName: 'Sample Writer' },
        isRepost: false, sourceAccountId: 42, sourceAccount: 'reader@local-search.invalid',
        raw: {
          uri, url: 'https://local-search.invalid/@writer/one', createdAt, visibility: 'public',
          content: `<p>${first}</p><p>${tail}</p>`, card: { title },
        },
      }],
    }));
  }, { title: TITLE, first: FIRST_PARAGRAPH, tail: TAIL });
}

async function importExisting(page: Page) {
  const section = cacheSettings(page);
  await section.getByRole('button', { name: 'Index existing cache', exact: true }).click();
  await expect(section.getByText('Indexed 1 items.', { exact: true })).toBeVisible();
  await expect(section.getByText(/^1 cached items · estimated /)).toBeVisible();
}

async function query(page: Page, text: string) {
  const input = localSearch(page).getByRole('searchbox', { name: 'Search cached posts and Wallabag items', exact: true });
  await input.fill(text);
  await input.press('Enter');
}

test.describe('optional local cache and search', () => {
  test('needs opt-in, preserves independent limits after reload, and searches without accounts', async ({ page }) => {
    await page.goto('/search?scope=local');
    await expect(localSearch(page).getByText('Local search is turned off.', { exact: true })).toBeVisible();
    await localSearch(page).getByRole('link', { name: 'Configure local cache', exact: true }).click();
    const section = cacheSettings(page);
    const enabled = section.getByRole('checkbox', { name: 'Enable local cache and search', exact: true });
    await expect(enabled).not.toBeChecked();
    await expect(section.locator('#search-cache-posts-mode')).toBeDisabled();

    await enabled.check();
    await section.locator('#search-cache-posts-mode').selectOption('paragraph');
    await section.locator('#search-cache-posts-chars').fill('640');
    await section.locator('#search-cache-wallabag-mode').selectOption('characters');
    await section.locator('#search-cache-wallabag-chars').fill('4200');
    await section.locator('#search-cache-age').fill('45');
    await section.locator('#search-cache-count').fill('800');
    await section.getByRole('button', { name: 'Save cache settings', exact: true }).click();
    await expect(section.getByText('Cache settings saved.', { exact: true })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(enabled).toBeChecked();
    await expect(section.locator('#search-cache-posts-mode')).toHaveValue('paragraph');
    await expect(section.locator('#search-cache-posts-chars')).toHaveValue('640');
    await expect(section.locator('#search-cache-wallabag-mode')).toHaveValue('characters');
    await expect(section.locator('#search-cache-wallabag-chars')).toHaveValue('4200');
    await expect(section.locator('#search-cache-age')).toHaveValue('45');
    await expect(section.locator('#search-cache-count')).toHaveValue('800');

    await section.getByRole('link', { name: 'On this device', exact: true }).click();
    await query(page, 'no connected accounts needed');
    await expect(localSearch(page).getByText('No cached items match this search.', { exact: true })).toBeVisible();
    await expect(localSearch(page).getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  });

  test('imports only the first paragraph and searches the persisted index offline', async ({ page, context }) => {
    await enableCache(page);
    await seedScopedViewCache(page);
    await importExisting(page);
    await cacheSettings(page).getByRole('link', { name: 'On this device', exact: true }).click();
    await query(page, 'nebula');
    await expect(localSearch(page).getByRole('heading', { name: TITLE, exact: true })).toBeVisible();

    // A fresh document must recover the index from IndexedDB, not a Svelte
    // result list or an in-memory token map retained from the import screen.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(localSearch(page).getByRole('searchbox')).toBeVisible();
    await localSearch(page).getByLabel('Source', { exact: true }).selectOption('mastodon');
    await context.setOffline(true);
    try {
      await query(page, 'aurorafield');
      const item = localSearch(page).locator('article');
      await expect(item).toHaveCount(1);
      await expect(item.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
      await expect(item.locator('p')).toHaveText(FIRST_PARAGRAPH);

      await query(page, 'unindexedtailword');
      await expect(localSearch(page).getByText('No cached items match this search.', { exact: true })).toBeVisible();
      await expect(localSearch(page).locator('article')).toHaveCount(0);

      // A new matching query must still work after a miss, while offline.
      await query(page, 'aurorafield');
      await expect(localSearch(page).locator('article p')).toHaveText(FIRST_PARAGRAPH);
    } finally {
      await context.setOffline(false);
    }
  });

  test('clear and disable remove saved results, including after re-enabling', async ({ page }) => {
    await enableCache(page);
    await seedScopedViewCache(page);
    await importExisting(page);
    const section = cacheSettings(page);
    await section.getByRole('button', { name: 'Clear search cache', exact: true }).click();
    await expect(section.getByText('Search cache cleared.', { exact: true })).toBeVisible();
    await expect(section.getByText(/^0 cached items · estimated /)).toBeVisible();
    await section.getByRole('link', { name: 'On this device', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?scope=local/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await query(page, 'aurorafield');
    await expect(localSearch(page).getByText('No cached items match this search.', { exact: true })).toBeVisible();

    await localSearch(page).getByRole('link', { name: 'Configure local cache', exact: true }).click();
    await importExisting(page);
    const enabled = section.getByRole('checkbox', { name: 'Enable local cache and search', exact: true });
    await enabled.uncheck();
    await section.getByRole('button', { name: 'Save cache settings', exact: true }).click();
    await expect(section.getByText('Cache settings saved.', { exact: true })).toBeVisible();
    await section.getByRole('link', { name: 'On this device', exact: true }).click();
    await expect(localSearch(page).getByText('Local search is turned off.', { exact: true })).toBeVisible();

    await localSearch(page).getByRole('link', { name: 'Configure local cache', exact: true }).click();
    await enabled.check();
    await section.getByRole('button', { name: 'Save cache settings', exact: true }).click();
    await expect(section.getByText('Cache settings saved.', { exact: true })).toBeVisible();
    await section.getByRole('link', { name: 'On this device', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?scope=local/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await query(page, 'aurorafield');
    await expect(localSearch(page).getByText('No cached items match this search.', { exact: true })).toBeVisible();
    await expect(localSearch(page).locator('article')).toHaveCount(0);
  });
});
