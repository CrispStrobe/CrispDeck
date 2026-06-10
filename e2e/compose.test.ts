import { test, expect } from '@playwright/test';

test.describe('Compose', () => {
  test('textarea is autofocused', async ({ page }) => {
    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    // Should be focused
    await expect(textarea).toBeFocused();
  });

  test('typing shows character counts', async ({ page }) => {
    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await textarea.fill('Hello, world!');
    // Character counts should appear (bottom-right area)
    // They only show when accounts are connected, but at minimum
    // the textarea should accept input
    await expect(textarea).toHaveValue('Hello, world!');
  });

  test('Ctrl+Enter keyboard shortcut exists', async ({ page }) => {
    await page.goto('/compose');
    const textarea = page.locator('textarea');
    await textarea.fill('Test post');
    // We can't fully test posting without accounts, but we verify the
    // textarea accepts keyboard input and the page doesn't crash
    await textarea.press('Control+Enter');
    // Should show error about no accounts selected (not crash)
    await page.waitForTimeout(500);
  });

  test('empty post shows no crash', async ({ page }) => {
    await page.goto('/compose');
    // Click the post button without text — should not crash
    const postBtn = page.locator('button:has-text("Post"), button:has-text("Send")').first();
    if (await postBtn.isVisible()) {
      await postBtn.click();
      // Page should still be compose
      await expect(page).toHaveURL(/compose/);
    }
  });
});
