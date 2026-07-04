import { test, expect } from '@playwright/test';

test.describe('Search Operators UI', () => {
  test('search page has quick filter buttons', async ({ page }) => {
    await page.goto('/search');
    await expect(page.locator('text=Has media')).toBeVisible();
    await expect(page.locator('text=Past week')).toBeVisible();
    await expect(page.locator('text=Search syntax')).toBeVisible();
  });

  test('clicking "Has media" inserts operator into search box', async ({ page }) => {
    await page.goto('/search');
    await page.locator('button:has-text("Has media")').click();
    const input = page.locator('input[type="text"]').first();
    await expect(input).toHaveValue(/has:media/);
  });

  test('clicking "Past week" inserts since: operator', async ({ page }) => {
    await page.goto('/search');
    await page.locator('button:has-text("Past week")').click();
    const input = page.locator('input[type="text"]').first();
    await expect(input).toHaveValue(/since:\d{4}-\d{2}-\d{2}/);
  });

  test('search syntax help toggles on click', async ({ page }) => {
    await page.goto('/search');
    await page.locator('button:has-text("Search syntax")').click();
    // Should show platform-specific help
    await expect(page.locator('text=from:handle.bsky.social')).toBeVisible();
    await expect(page.locator('text=since:2026-01-01')).toBeVisible();
  });
});
