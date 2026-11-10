import { test, expect } from '@playwright/test';
import { BSKY_FEED, BSKY_PROFILE } from '../tools/screenshots/fixtures.mjs';

test('a profile renders repeated appearances of a post without a duplicate-key crash', async ({ page }) => {
  await page.route('**/xrpc/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/app.bsky.actor.getProfile')) return route.fulfill({ json: BSKY_PROFILE });
    if (path.endsWith('/app.bsky.feed.getAuthorFeed')) {
      const first = BSKY_FEED[0];
      const repost = { ...first, reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: BSKY_PROFILE.did, handle: BSKY_PROFILE.handle, displayName: BSKY_PROFILE.displayName }, indexedAt: new Date().toISOString() } };
      return route.fulfill({ json: { feed: [first, repost] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/profile?handle=${encodeURIComponent(BSKY_PROFILE.handle)}&platform=bluesky`);
  await expect(page.getByRole('heading', { name: BSKY_PROFILE.displayName })).toBeVisible();
  await expect(page.locator('[data-post-uri]')).toHaveCount(2);
  await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
});

test('opening another author from a profile loads that author', async ({ page }) => {
  const post = BSKY_FEED[0];
  const author = post.post.author;
  await page.route('**/xrpc/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/app.bsky.actor.getProfile')) {
      return route.fulfill({ json: url.searchParams.get('actor') === author.handle
        ? { ...BSKY_PROFILE, ...author }
        : BSKY_PROFILE });
    }
    if (url.pathname.endsWith('/app.bsky.feed.getAuthorFeed')) return route.fulfill({ json: { feed: [post] } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/profile?handle=${encodeURIComponent(BSKY_PROFILE.handle)}&platform=bluesky`);
  await expect(page.getByRole('heading', { name: BSKY_PROFILE.displayName })).toBeVisible();
  await page.locator('.post-author').first().click();
  await expect(page).toHaveURL(new RegExp(`handle=${encodeURIComponent(author.handle)}`));
  await expect(page.getByRole('heading', { name: author.displayName })).toBeVisible();
});
