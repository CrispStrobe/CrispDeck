/**
 * Compose, without accounts connected.
 *
 * Three of the four tests here used to pass no matter what the page did: one
 * pressed Ctrl+Enter and asserted nothing at all, one guarded its only
 * assertion behind `if (await postBtn.isVisible())`, and one called itself
 * "typing shows character counts" while checking only that the textarea held
 * the text. They assert what they can actually see now, and are named for it.
 */
import { test, expect } from '@playwright/test';

/** Page errors that say nothing about the page under test. */
function isEnvironmentNoise(message: string): boolean {
  return /ResizeObserver loop|Failed to fetch|NetworkError|Load failed/i.test(message);
}

test.describe('Compose', () => {
  test('textarea is autofocused', async ({ page }) => {
    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();
  });

  test('the textarea keeps what is typed into it', async ({ page }) => {
    // Named for what it checks. The character counts it used to claim to
    // cover only render once an account is connected, so this cannot see them.
    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await textarea.fill('Hello, world!');
    await expect(textarea).toHaveValue('Hello, world!');
  });

  test('Ctrl+Enter with nothing connected does not throw', async ({ page }) => {
    // This pressed the shortcut, waited 500ms and asserted nothing — it could
    // not fail. Posting needs an account, so what is checkable here is that
    // the shortcut path does not blow up and does not navigate away with the
    // draft.
    const thrown: string[] = [];
    page.on('pageerror', (e) => {
      if (!isEnvironmentNoise(e.message)) thrown.push(e.message);
    });

    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await textarea.fill('Test post');
    await textarea.press('Control+Enter');

    await expect(page).toHaveURL(/compose/);
    await expect(textarea).toHaveValue('Test post');
    expect(thrown, 'Ctrl+Enter threw out of the handler').toEqual([]);
  });

  test('the post button is there and clicking it with no text does not throw', async ({ page }) => {
    // The `if (await postBtn.isVisible())` here meant a missing button made
    // the test pass rather than fail — the one outcome it should have caught.
    const thrown: string[] = [];
    page.on('pageerror', (e) => {
      if (!isEnvironmentNoise(e.message)) thrown.push(e.message);
    });

    await page.goto('/compose');
    const postBtn = page
      .locator('button:has-text("Post"), button:has-text("Send")')
      .first();
    await expect(postBtn, 'compose should offer a way to post').toBeVisible();

    await postBtn.click({ force: true });

    await expect(page).toHaveURL(/compose/);
    expect(thrown, 'posting an empty draft threw out of the handler').toEqual([]);
  });
});
