import { test, expect } from '@playwright/test';

/**
 * Settings that are meant to persist, actually persisting.
 *
 * 64 localStorage writes were converted to the checked helpers in
 * safe-storage.ts, and nothing verified that a single one of those saves
 * survives a reload through the real UI. Unit tests cover the helper; the
 * smoke test covers the page loading. Neither would notice if a save path
 * stopped saving — the page still renders, the value is just gone next time.
 *
 * That is the failure this covers: type a thing, come back, is it there.
 */

const MUTED_WORD_PLACEHOLDER = 'word or phrase to mute...';

/**
 * Muted words live on the "content" tab, and the page reads ?tab= from the
 * URL. Going to /settings alone renders the account tab, where this control
 * does not exist — which is how the first version of this spec failed.
 */
const SETTINGS_CONTENT = '/settings?tab=content';

/** A value nothing else uses, so a failed run cannot affect a later one. */
function scratchWord(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe('muted words survive a reload', () => {
  test('a word added in settings is still there after reloading', async ({ page }) => {
    const word = scratchWord();

    await page.goto(SETTINGS_CONTENT);
    const input = page.getByPlaceholder(MUTED_WORD_PLACEHOLDER);
    await expect(input).toBeVisible({ timeout: 15000 });

    await input.fill(word);
    await input.press('Enter');

    // Present before the reload, or the reload proves nothing.
    await expect(page.getByText(word, { exact: false })).toBeVisible({ timeout: 10000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(word, { exact: false }),
      'the word should have been written to storage and read back',
    ).toBeVisible({ timeout: 15000 });
  });

  test('removing a word sticks too', async ({ page }) => {
    // The other half: a delete that only updates the screen looks identical
    // to one that saved, until the next visit.
    const word = scratchWord();

    await page.goto(SETTINGS_CONTENT);
    const input = page.getByPlaceholder(MUTED_WORD_PLACEHOLDER);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill(word);
    await input.press('Enter');
    await expect(page.getByText(word, { exact: false })).toBeVisible({ timeout: 10000 });

    // By accessible name, scoped to the row. Writing this is what exposed
    // that the button had no name at all — and that the guard meant to catch
    // that was blind to 24 buttons, because its attribute pattern stopped at
    // the > in an inline arrow handler.
    const row = page.locator('div.justify-between').filter({ hasText: word }).first();
    await row.getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText(word, { exact: false })).toHaveCount(0, { timeout: 10000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(word, { exact: false }),
      'the removal should have been written, not just rendered',
    ).toHaveCount(0);
  });

  test('two words both survive, so saving one does not drop the other', async ({ page }) => {
    // writeJson replaces the whole list. Writing the second must not lose the
    // first — the shape of bug that wholesale writes produce.
    const first = scratchWord();
    const second = scratchWord();

    await page.goto(SETTINGS_CONTENT);
    const input = page.getByPlaceholder(MUTED_WORD_PLACEHOLDER);
    await expect(input).toBeVisible({ timeout: 15000 });

    for (const word of [first, second]) {
      await input.fill(word);
      await input.press('Enter');
      await expect(page.getByText(word, { exact: false })).toBeVisible({ timeout: 10000 });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(first, { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(second, { exact: false })).toBeVisible();
  });
});

test.describe('the storage helpers are actually reached', () => {
  test('a settings change writes something to localStorage', async ({ page }) => {
    // Guards the assertions above against passing on in-memory state alone:
    // if nothing reached storage, the reload tests would be measuring Svelte
    // rather than persistence.
    const word = scratchWord();

    await page.goto(SETTINGS_CONTENT);
    const input = page.getByPlaceholder(MUTED_WORD_PLACEHOLDER);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill(word);
    await input.press('Enter');
    await expect(page.getByText(word, { exact: false })).toBeVisible({ timeout: 10000 });

    const stored = await page.evaluate((needle) => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (localStorage.getItem(key) ?? '').includes(needle)) return key;
      }
      return null;
    }, word);

    expect(stored, 'the word should appear in some localStorage key').not.toBeNull();
  });
});
