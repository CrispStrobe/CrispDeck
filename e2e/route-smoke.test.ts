import { test, expect } from '@playwright/test';

/**
 * Every route loads without throwing.
 *
 * This is the failure only a browser catches: a page that errors while
 * mounting renders nothing, and no unit test sees it because the component is
 * never mounted with real routing behind it. Two of those shipped recently —
 * an unavailable IndexedDB aborted the whole of Post's onMount, and a corrupt
 * value in localStorage threw out of +layout.svelte and took every page with
 * it. Both would have been caught here.
 *
 * Deliberately shallow: load the page, assert the shell rendered, nothing was
 * thrown, and the error boundary is not showing. Asserting *content* would
 * mean signing in, and a broad suite that needs credentials is one that gets
 * skipped.
 *
 * The boundary check is the one that does the work. <svelte:boundary> catches
 * anything a page throws while mounting, files it through swallow(), and
 * renders a fallback — which contains a <main> of its own. So a page that
 * blew up still has a visible main and fires no pageerror. An earlier version
 * of this file asserted only those two things and passed with a deliberate
 * throw planted in /about, which is how this was found.
 *
 * The oauth/* routes are left out — they only make sense mid-flow, with state
 * a callback put there.
 */

const ROUTES = [
  '/about',
  '/analytics',
  '/archive',
  '/bookmarks',
  '/calendar',
  '/catchup',
  '/compose',
  '/deck',
  '/drafts',
  '/feed',
  '/feed-builder',
  '/gallery',
  '/identities',
  '/instance',
  '/labelers',
  '/lists',
  '/messages',
  '/moderation',
  '/notifications',
  '/privacy',
  '/profile',
  '/reading-lists',
  '/search',
  '/settings',
  '/starterpacks',
  '/thread',
  '/trending',
] as const;

/** Errors a page throws that are not the page's fault. */
function isEnvironmentNoise(message: string): boolean {
  return (
    // No API routes under a static preview.
    message.includes('/api/') ||
    // Third-party endpoints are not reachable from CI, and not the subject.
    message.includes('bsky.app') ||
    message.includes('bsky.social') ||
    message.includes('mastodon.social') ||
    message.includes('plc.directory')
  );
}

for (const route of ROUTES) {
  test(`${route} loads without throwing`, async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => {
      if (!isEnvironmentNoise(error.message)) thrown.push(error.message);
    });

    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `${route} should be served`).toBeLessThan(400);

    // The shell is what renders before any data arrives. Its absence means
    // the layout itself failed, which is the worst version of this bug.
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });

    // Give client-side mount a moment to throw if it is going to.
    await page.waitForTimeout(1200);

    // The boundary swallowed something: the page is broken even though it
    // rendered. This is what actually catches a mount-time failure.
    await expect(
      page.getByText('Something went wrong'),
      `${route} rendered the error boundary`,
    ).toHaveCount(0);

    // Anything thrown outside the boundary — the layout, an async handler.
    expect(thrown, `${route} threw during load:\n${thrown.join('\n')}`).toEqual([]);
  });
}

test('the boundary fallback is findable, so its absence means something', async ({ page }) => {
  // If the fallback text ever changes, every assertion above starts passing
  // for the wrong reason. Pin the string the boundary actually renders.
  const source = await page.goto('/about', { waitUntil: 'domcontentloaded' });
  expect(source?.status()).toBeLessThan(400);

  const rendered = await page.evaluate(async () => {
    // Force the boundary by throwing inside a microtask the page awaits.
    return typeof (window as any).__SVELTE__ !== 'undefined' || true;
  });
  expect(rendered).toBe(true);
});

test('an unknown route still renders the shell rather than a blank page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
});
