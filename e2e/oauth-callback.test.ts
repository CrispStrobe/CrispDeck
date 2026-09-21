/**
 * The OAuth callback page, driven the way an attacker would drive it.
 *
 * The page used to exchange whatever `code` arrived in the query string. These
 * run the real page in a real browser with a real localStorage attempt, which
 * is the only place the check and the storage and the rendering meet.
 *
 * No accounts and no network needed: every case here is refused before the
 * page would reach an instance.
 */
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'crispdeck-oauth-state';

/** Seed the attempt the settings page would have stored before redirecting. */
async function seedAttempt(page: import('@playwright/test').Page, state: string | null) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key as string, value as string);
      } catch {
        /* storage disabled — the test below will say so */
      }
    },
    [
      STORAGE_KEY,
      JSON.stringify({
        instance_url: 'https://instance.invalid',
        client_id: 'cid',
        client_secret: 'csec',
        redirect_uri: 'http://localhost:4173/oauth/callback',
        ...(state === null ? {} : { state }),
      }),
    ]
  );
}

const errorBox = (page: import('@playwright/test').Page) => page.locator('p.text-red-400');

test.describe('OAuth callback', () => {
  test('refuses a code that arrives with the wrong state', async ({ page }) => {
    // The attack: a link that opens this page with a code the attacker holds.
    // Before the state check it was exchanged on sight.
    await seedAttempt(page, 'the-real-state');
    await page.goto('/oauth/callback?code=attacker-code&state=not-ours');

    await expect(errorBox(page)).toContainText('did not come from the sign-in you started');
  });

  test('drops the stored attempt when it refuses, so a retry starts clean', async ({ page }) => {
    await seedAttempt(page, 'the-real-state');
    await page.goto('/oauth/callback?code=attacker-code&state=not-ours');
    await expect(errorBox(page)).toBeVisible();

    const left = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(left, 'a refused attempt should not be left lying around').toBeNull();
  });

  test('refuses a callback carrying no state at all', async ({ page }) => {
    // Exactly the shape of every callback before the fix.
    await seedAttempt(page, 'the-real-state');
    await page.goto('/oauth/callback?code=abc123');

    await expect(errorBox(page)).toContainText('did not come from the sign-in you started');
  });

  test('refuses when the stored attempt predates states', async ({ page }) => {
    // An entry written by an older build: nothing to compare against, so the
    // sign-in has to be started again rather than waved through.
    await seedAttempt(page, null);
    await page.goto('/oauth/callback?code=abc123&state=anything');

    await expect(errorBox(page)).toContainText('did not come from the sign-in you started');
  });

  test('reports what the instance said when the user pressed Cancel', async ({ page }) => {
    await seedAttempt(page, 'the-real-state');
    await page.goto(
      '/oauth/callback?error=access_denied&error_description=The+user+denied+the+request'
    );

    await expect(errorBox(page)).toContainText('access_denied');
    await expect(errorBox(page)).toContainText('denied the request');
  });

  test('says the attempt is missing rather than blaming the state', async ({ page }) => {
    // Nothing seeded: the user opened the callback directly, or storage was
    // cleared between the redirect and the return.
    await page.goto('/oauth/callback?code=abc123&state=whatever');

    await expect(errorBox(page)).toContainText('No OAuth state found');
  });

  test('a matching state gets past the check and fails at the instance instead', async ({ page }) => {
    // The other half: the guard must not refuse a legitimate return. The
    // instance here does not resolve, so getting a *different* error is the
    // evidence that the state check passed.
    await seedAttempt(page, 'the-real-state');
    await page.goto('/oauth/callback?code=abc123&state=the-real-state');

    await expect(errorBox(page)).toBeVisible();
    await expect(errorBox(page)).not.toContainText('did not come from the sign-in you started');
    await expect(errorBox(page)).not.toContainText('No OAuth state found');
  });
});
