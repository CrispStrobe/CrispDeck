import { test, expect } from '@playwright/test';

test.describe('Onboarding (no accounts)', () => {
  test('shows welcome onboarding when no accounts', async ({ page }) => {
    await page.goto('/');
    // Stage 1: welcome header + network selector
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    await expect(page.locator('text=Connect your first account to get started')).toBeVisible();
    await expect(page.getByRole('button', { name: /Bluesky Decentralized microblogging/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Mastodon The federated social web/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Threads Instagram's text platform/ })).toBeVisible();
  });

  test('selecting Bluesky shows connect options', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    await page.getByRole('button', { name: /Bluesky Decentralized microblogging/ }).click();
    // Stage 2: OAuth button + app-password fallback
    await expect(page.getByRole('button', { name: 'Sign in with Bluesky' })).toBeVisible();
    await expect(page.locator('text=Or use an app password')).toBeVisible();
    // Back returns to the network selector
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: /Mastodon The federated social web/ })).toBeVisible();
  });

  test('selecting Mastodon shows instance form', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Welcome to CrispDeck')).toBeVisible();
    await page.getByRole('button', { name: /Mastodon The federated social web/ }).click();
    await expect(page.locator('text=Instance URL')).toBeVisible();
  });
});
