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

  test('the Bluesky sign-in button shows that it is working', async ({ page }) => {
    // Sign-in takes several seconds before the browser redirects anywhere:
    // metadata resolution, a DPoP key, and a pushed authorization request that
    // is normally rejected once to issue a nonce and repeated. With no pending
    // state the button looked dead for all of it, and the natural response is
    // to click again and start a second sign-in.
    await page.goto('/');
    await page.getByRole('button', { name: /Bluesky Decentralized microblogging/ }).click();
    const signIn = page.getByRole('button', { name: 'Sign in with Bluesky' });
    await expect(signIn).toBeEnabled();

    // Hold the redirect open so the in-flight state is observable.
    await page.route('**/.well-known/oauth-*', (route) => {});
    await signIn.click();

    const busy = page.getByRole('button', { name: /Contacting/ });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
  });

  test('a failed connect re-enables the button instead of stranding the user', async ({ page }) => {
    // The busy state is cleared in a finally, and this is why: the OAuth paths
    // usually redirect away before it runs, but a failing one has to hand the
    // button back or the only way out is a page reload.
    await page.goto('/');
    await page.getByRole('button', { name: /Mastodon The federated social web/ }).click();
    await page.getByLabel('Instance URL').fill('mastodon.social');

    await page.route('**/api/v1/apps', (route) => route.abort('failed'));

    const connect = page.getByRole('button', { name: /^Connect Mastodon/ });
    await connect.click();

    await expect(page.getByRole('alert')).toContainText(/Could not connect/);
    await expect(page.getByRole('button', { name: /^Connect Mastodon/ })).toBeEnabled();
  });

});
