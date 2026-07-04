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
    // Use the menu container to scope selectors and avoid sidebar nav collisions
    const menu = page.locator('.absolute.right-0');
    await expect(menu.locator('text=Home Timeline')).toBeVisible();
    await expect(menu.locator('text=Messages / DMs')).toBeVisible();
    await expect(menu.locator('text=Trending')).toBeVisible();
    await expect(menu.locator('text=Liked Posts')).toBeVisible();
  });

  test('keyboard shortcut "a" opens add column menu', async ({ page }) => {
    await page.goto('/deck');
    // Click body to ensure focus is not in an input
    await page.locator('body').click();
    await page.keyboard.press('a');
    const menu = page.locator('.absolute.right-0');
    await expect(menu.locator('text=Home Timeline')).toBeVisible({ timeout: 3000 });
  });
});
