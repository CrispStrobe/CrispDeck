import { test, expect } from '@playwright/test';

// Chromium has zero device insets. Supply portrait/landscape insets to exercise
// the layout; native Simulator screenshots verify WebKit's actual env() values.
for (const device of [
  { name: 'notched portrait', width: 402, height: 874, top: 62, bottom: 34, side: 0 },
  { name: 'narrow landscape', width: 720, height: 390, top: 0, bottom: 21, side: 44 },
]) {
  test(`navigation and scrollable content stay inside safe areas: ${device.name}`, async ({ page }) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto('/');
    await page.addStyleTag({ content: `:root {
      --safe-area-top: ${device.top}px; --safe-area-bottom: ${device.bottom}px;
      --safe-area-left: ${device.side}px; --safe-area-right: ${device.side}px;
    }` });

    const title = await page.locator('.mobile-top-bar a').first().boundingBox();
    expect(title).not.toBeNull();
    expect(title!.y).toBeGreaterThanOrEqual(device.top);
    expect(title!.x).toBeGreaterThanOrEqual(device.side);
    const main = page.locator('#main-content');
    const content = await main.boundingBox();
    expect(content!.y + content!.height).toBeLessThanOrEqual(device.height - device.bottom);
    expect(content!.x).toBeGreaterThanOrEqual(device.side);
    expect(content!.x + content!.width).toBeLessThanOrEqual(device.width - device.side);

    const tabs = page.locator('.mobile-tab-bar');
    const tabBounds = (await tabs.boundingBox())!;
    for (const link of await tabs.locator('a').all()) {
      const bounds = (await link.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(device.side);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(device.width - device.side);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(device.height - device.bottom);
    }
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastCard = (await page.getByRole('button', { name: /Threads Instagram/ }).boundingBox())!;
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(tabBounds.y);

    await page.getByRole('button', { name: 'Main navigation', exact: true }).click();
    const menu = page.locator('#mobile-navigation');
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await menu.locator('a').first().boundingBox())?.x ?? -1)
      .toBeGreaterThanOrEqual(device.side);
    const first = (await menu.locator('a').first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(device.top);
    expect(first.x).toBeGreaterThanOrEqual(device.side);
    await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const last = (await menu.locator('a').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(tabBounds.y);
  });
}
