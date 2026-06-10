import { test, expect } from '@playwright/test';

test.describe('PWA & Meta', () => {
  test('manifest.json is served', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);
    const json = await response?.json();
    expect(json.name).toBe('CrispDeck');
    expect(json.icons.length).toBeGreaterThanOrEqual(4);
  });

  test('has Open Graph meta tags', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'CrispDeck');
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /cross-platform/i);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /icon-512/);
  });

  test('has Twitter Card meta tags', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
  });

  test('service worker is registered', async ({ page }) => {
    await page.goto('/');
    // Give SW time to register
    await page.waitForTimeout(2000);
    const swRegistrations = await page.evaluate(() =>
      navigator.serviceWorker?.getRegistrations().then(regs => regs.length)
    );
    expect(swRegistrations).toBeGreaterThan(0);
  });

  test('favicon files exist', async ({ request }) => {
    const pngResp = await request.get('/favicon.png');
    expect(pngResp.status()).toBe(200);
    const icoResp = await request.get('/favicon.ico');
    expect(icoResp.status()).toBe(200);
    const appleResp = await request.get('/apple-touch-icon.png');
    expect(appleResp.status()).toBe(200);
  });
});
