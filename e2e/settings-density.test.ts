import { test, expect } from '@playwright/test';

test.describe('Settings — Display Density', () => {
  test('density selector exists in Appearance tab', async ({ page }) => {
    await page.goto('/settings?tab=appearance');
    await expect(page.locator('text=Display density')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#density-mode')).toBeVisible();
  });

  test('density selector has 3 options', async ({ page }) => {
    await page.goto('/settings?tab=appearance');
    const select = page.locator('#density-mode');
    await expect(select).toBeVisible({ timeout: 10000 });
    const options = select.locator('option');
    await expect(options).toHaveCount(3);
  });

  test('changing density sets CSS custom property', async ({ page }) => {
    await page.goto('/settings?tab=appearance');
    const select = page.locator('#density-mode');
    await select.selectOption('compact');
    const avatar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--density-avatar').trim()
    );
    expect(avatar).toBe('28px');
  });

  test('density persists in localStorage', async ({ page }) => {
    await page.goto('/settings?tab=appearance');
    const select = page.locator('#density-mode');
    await select.selectOption('spacious');
    const saved = await page.evaluate(() => localStorage.getItem('crispdeck-density'));
    expect(saved).toBe('spacious');
  });
});
