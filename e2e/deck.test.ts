import { test, expect } from '@playwright/test';

test.describe('Deck Page', () => {
  test('loads deck page with column headers', async ({ page }) => {
    await page.goto('/deck');
    await expect(page).toHaveTitle(/Deck/);
    await expect(page.locator('text=Deck').first()).toBeVisible();
  });

  test('shows Add Column button', async ({ page }) => {
    await page.goto('/deck');
    await expect(page.locator('button:has-text("Add Column")')).toBeVisible();
  });

  test('Add Column menu lists column types', async ({ page }) => {
    await page.goto('/deck');
    await page.locator('button:has-text("Add Column")').click();
    await expect(page.locator('text=Home Timeline')).toBeVisible();
    await expect(page.locator('text=Notifications')).toBeVisible();
    await expect(page.locator('text=Messages / DMs')).toBeVisible();
    await expect(page.locator('text=Trending')).toBeVisible();
    await expect(page.locator('text=Activity')).toBeVisible();
    await expect(page.locator('text=Liked Posts')).toBeVisible();
  });

  test('keyboard shortcut "a" opens add column menu', async ({ page }) => {
    await page.goto('/deck');
    await page.keyboard.press('a');
    await expect(page.locator('text=Home Timeline')).toBeVisible({ timeout: 3000 });
  });
});
