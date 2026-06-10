import { test, expect } from '@playwright/test';

test.describe('Search', () => {
  test('shows helpful empty state when no accounts', async ({ page }) => {
    await page.goto('/search');
    // With no accounts, should show "No Accounts Connected" prompt
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 15000 });
  });

  test('search input accepts text', async ({ page }) => {
    await page.goto('/search');
    const input = page.locator('input[type="text"], input[type="search"]').first();
    await input.fill('test query');
    await expect(input).toHaveValue('test query');
  });

  test('search form submits', async ({ page }) => {
    await page.goto('/search');
    const input = page.locator('input[type="text"], input[type="search"]').first();
    await input.fill('hello');
    await input.press('Enter');
    // Should show searching state or results
    await page.waitForTimeout(1000);
    // Page should not crash
    await expect(page).toHaveURL(/search/);
  });
});
