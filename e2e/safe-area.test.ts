import { test, expect, type Page } from '@playwright/test';

// A narrow desktop viewport does not exercise (pointer: coarse), which was
// enlarging the header controls without enlarging the content's top offset.
test.use({ hasTouch: true, isMobile: true, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });

type Insets = { width: number; height: number; top: number; bottom: number; side: number };

async function applyInsets(page: Page, device: Insets) {
  await page.setViewportSize({ width: device.width, height: device.height });
  await page.evaluate(({ top, bottom, side }) => {
    const style = document.documentElement.style;
    style.setProperty('--safe-area-top', `${top}px`);
    style.setProperty('--safe-area-bottom', `${bottom}px`);
    style.setProperty('--safe-area-left', `${side}px`);
    style.setProperty('--safe-area-right', `${side}px`);
  }, device);
}

async function expectSafeShell(page: Page, device: Insets) {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const header = page.locator('.mobile-top-bar');
  const headerBounds = (await header.boundingBox())!;
  for (const control of await header.locator('button, a').all()) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(device.top);
    expect(bounds.x).toBeGreaterThanOrEqual(device.side);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(device.width - device.side);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }

  const main = page.locator('#main-content');
  await main.evaluate(element => { element.scrollTop = 0; });
  const heading = (await main.locator('h1').first().boundingBox())!;
  expect(heading.y, 'the fixed header must not cover the page heading')
    .toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
  const content = (await main.boundingBox())!;
  expect(content.y + content.height).toBeLessThanOrEqual(device.height - device.bottom);
  expect(content.x).toBeGreaterThanOrEqual(device.side);
  expect(content.x + content.width).toBeLessThanOrEqual(device.width - device.side);

  const tabs = page.locator('.mobile-tab-bar');
  for (const link of await tabs.locator('a').all()) {
    const bounds = (await link.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(device.side);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(device.width - device.side);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(device.height - device.bottom);
    const icon = (await link.locator('svg').boundingBox())!;
    const label = (await link.locator('span').last().boundingBox())!;
    expect(icon.y + icon.height, 'tab icons and labels must not overlap').toBeLessThanOrEqual(label.y);
  }
  expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

// Chromium reports zero physical insets. These exercise CSS geometry; the
// native Android smoke test checks the actual system-bar/WebView boundary.
for (const device of [
  { name: 'Android three-button navigation', width: 360, height: 800, top: 24, bottom: 48, side: 0 },
  { name: 'notched portrait', width: 402, height: 874, top: 62, bottom: 34, side: 0 },
  { name: 'narrow landscape', width: 720, height: 390, top: 0, bottom: 21, side: 44 },
]) {
  test(`navigation and scrollable content stay inside safe areas: ${device.name}`, async ({ page }) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Threads Instagram/ })).toBeVisible();
    await applyInsets(page, device);
    await expectSafeShell(page, device);

    const main = page.locator('#main-content');
    const tabBounds = (await page.locator('.mobile-tab-bar').boundingBox())!;
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastCard = (await page.getByRole('button', { name: /Threads Instagram/ }).boundingBox())!;
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(tabBounds.y);

    await page.getByRole('button', { name: 'Main navigation', exact: true }).tap();
    const menu = page.locator('#mobile-navigation');
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await menu.locator('a').first().boundingBox())?.x ?? -1)
      .toBeGreaterThanOrEqual(device.side);
    const first = (await menu.locator('a').first().boundingBox())!;
    const header = (await page.locator('.mobile-top-bar').boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(first.x).toBeGreaterThanOrEqual(device.side);
    await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const last = (await menu.locator('a:visible').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(tabBounds.y);
  });
}

test('safe-area geometry updates when a touch device rotates', async ({ page }) => {
  await page.goto('/feed');
  await expect(page.locator('#main-content h1')).toBeVisible();
  for (const device of [
    { width: 390, height: 844, top: 24, bottom: 48, side: 0 },
    { width: 720, height: 390, top: 0, bottom: 24, side: 44 },
    { width: 390, height: 844, top: 24, bottom: 24, side: 0 },
  ]) {
    await applyInsets(page, device);
    await expectSafeShell(page, device);
  }
});
