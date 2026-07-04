import { test, expect } from '@playwright/test';

test.describe('Compose — Quick Schedule', () => {
  test('compose page has Schedule button', async ({ page }) => {
    await page.goto('/compose');
    await expect(page.locator('button:has-text("Schedule")')).toBeVisible({ timeout: 10000 });
  });

  test('clicking Schedule shows date/time picker', async ({ page }) => {
    await page.goto('/compose');
    await page.locator('button:has-text("Schedule")').click();
    await expect(page.locator('input[type="date"]')).toBeVisible();
    await expect(page.locator('input[type="time"]')).toBeVisible();
    await expect(page.locator('button:has-text("Schedule Post")')).toBeVisible();
  });

  test('Schedule Post button is disabled without date/time', async ({ page }) => {
    await page.goto('/compose');
    // Type some text first
    await page.locator('textarea').fill('Test post for scheduling');
    await page.locator('button:has-text("Schedule")').click();
    const scheduleBtn = page.locator('button:has-text("Schedule Post")');
    await expect(scheduleBtn).toBeDisabled();
  });
});
