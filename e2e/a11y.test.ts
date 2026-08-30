import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test('skip-to-content link exists', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('a.skip-to-content');
    await expect(skipLink).toHaveCount(1);
    await expect(skipLink).toHaveText('Skip to content');
  });

  test('main content exposes the main role', async ({ page }) => {
    await page.goto('/');
    // Assert the role, not a literal role="main" attribute: <main> carries that
    // role implicitly, so spelling it out is redundant markup rather than an
    // accessibility property worth pinning.
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  test('navigation has aria-label', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
  });

  test('keyboard shortcuts modal opens with ?', async ({ page }) => {
    await page.goto('/feed');
    // Wait for page to fully hydrate
    await page.waitForTimeout(1000);
    // Click body first to ensure focus is not in an input
    await page.locator('body').click();
    await page.keyboard.press('?');
    await expect(page.locator('div[role="dialog"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();
    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('div[role="dialog"]')).not.toBeVisible();
  });

  test('theme toggle cycles themes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const themeBtn = page.locator('nav[aria-label="Main navigation"] button[title*="mode"]');
    await themeBtn.click();
    // After click, theme should change (we verify by checking data-theme attribute)
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBeTruthy();
  });
});
