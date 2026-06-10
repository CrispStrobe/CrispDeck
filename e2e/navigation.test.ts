import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('loads the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CrispDeck/);
    // Should show onboarding or dashboard
    await expect(page.locator('text=CrispDeck').first()).toBeVisible();
  });

  test('navigates to feed page', async ({ page }) => {
    await page.goto('/feed');
    // Main content area has the feed heading
    await expect(page.locator('#main-content h1')).toContainText(/Feed/i, { timeout: 15000 });
  });

  test('navigates to compose page', async ({ page }) => {
    await page.goto('/compose');
    await expect(page).toHaveTitle(/Compose/);
    // Compose should have a textarea
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('navigates to search page', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveTitle(/Search/);
    // Search should have an input
    await expect(page.locator('input[type="text"], input[type="search"]').first()).toBeVisible();
  });

  test('navigates to notifications page', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page).toHaveTitle(/Notifications/, { timeout: 15000 });
  });

  test('navigates to settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveTitle(/Settings/, { timeout: 10000 });
  });

  test('navigates to about page', async ({ page }) => {
    await page.goto('/about');
    await expect(page).toHaveTitle(/About/);
  });

  test('sidebar navigation works on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    // Click feed in sidebar
    await page.locator('nav[aria-label="Main navigation"] a[href="/feed"]').click();
    await expect(page).toHaveURL('/feed');
    await expect(page).toHaveTitle(/Feed/);
  });

  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.locator('text=404')).toBeVisible();
    await expect(page.locator('text=Page not found')).toBeVisible();
  });
});
