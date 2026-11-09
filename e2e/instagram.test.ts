import { test, expect } from '@playwright/test';

test('Instagram offers the official feed link in the web app', async ({ page }) => {
  await page.goto('/instagram');
  await expect(page.getByRole('heading', { name: 'Instagram', exact: true })).toBeVisible();
  await expect(page.getByText('Use the Windows or macOS desktop app for an embedded timeline.', { exact: false })).toBeVisible();
  const link = page.getByRole('main').getByRole('link', { name: 'Open in browser', exact: true });
  await expect(link).toHaveAttribute('href', 'https://www.instagram.com/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('the default sidebar and Deck both lead to the Instagram timeline', async ({ page }) => {
  await page.goto('/feed');
  await page.evaluate(() => {
    (window as any).__instagramTransitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (start) document.startViewTransition = (update) => {
      (window as any).__instagramTransitions++;
      return start(update);
    };
  });
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await navigation.getByRole('link', { name: 'Instagram', exact: true }).click();
  await expect(page).toHaveURL(/\/instagram$/);

  await navigation.getByRole('link', { name: 'Deck', exact: true }).click();
  await expect(page).toHaveURL(/\/deck$/);
  await page.getByRole('main').getByRole('link', { name: 'Instagram', exact: true }).click();
  await expect(page).toHaveURL(/\/instagram$/);
  await expect(page.getByRole('heading', { name: 'Instagram', exact: true })).toBeVisible();
  // Native child webviews cannot take part in DOM snapshot transitions.
  expect(await page.evaluate(() => (window as any).__instagramTransitions)).toBe(0);
});
