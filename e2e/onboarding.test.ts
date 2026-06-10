import { test, expect } from '@playwright/test';

test.describe('Onboarding (no accounts)', () => {
  test('shows welcome onboarding when no accounts', async ({ page }) => {
    await page.goto('/');
    // Should show the onboarding component with feature carousel
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    await expect(page.locator('text=Add Account').first()).toBeVisible();
  });

  test('feature carousel dots are clickable', async ({ page }) => {
    await page.goto('/');
    // Wait for onboarding
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    // Click second dot
    const dots = page.locator('button[aria-label^="Step"]');
    await expect(dots).toHaveCount(4);
    await dots.nth(1).click();
    // Content should change
    await expect(page.locator('text=TweetDeck-style deck')).toBeVisible();
  });

  test('"Add Account" navigates to settings', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    await page.locator('button:has-text("Add Account")').click();
    await expect(page).toHaveURL('/settings');
  });
});
