// Run with: node e2e/post-mobile.live.mjs
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use a system Chromium install.
// The temporary fixture route is removed even when a regression fails.
import assert from 'node:assert/strict';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const route = 'src/routes/__post_mobile_test';
const port = 4187;
let server, browser, created = false;

try {
  await mkdir(route);
  created = true;
  await copyFile('e2e/fixtures/post-mobile.svelte', `${route}/+page.svelte`);
  await mkdir('playwright-results', { recursive: true });
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });

  for (const { width, height } of [
    ...[320, 360, 393, 430].map(width => ({ width, height: 844 })),
    { width: 720, height: 390 },
  ]) {
    const landscape = width > height;
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    for (let attempt = 0; ; attempt++) {
      try { await page.goto(`http://localhost:${port}/__post_mobile_test`); break; }
      catch (error) { if (attempt === 40) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    await page.waitForSelector('#mobile-post-fixture article');
    await page.waitForFunction(() => document.querySelector('img[alt="Landscape photo"]')?.complete);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the regression must exercise Android-style touch targets');

    const cards = page.locator('#mobile-post-fixture article');
    assert.equal(await cards.count(), 4);
    for (let index = 0; index < 4; index++) {
      const card = cards.nth(index);
      const metrics = await card.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const actions = element.querySelector('.post-actions').getBoundingClientRect();
        const controls = [...element.querySelector('.post-actions').children].map(control => {
          const rect = control.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
        });
        return { left: bounds.left, right: bounds.right, height: bounds.height, bottomGap: bounds.bottom - actions.bottom, actionsHeight: actions.height, controls, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      assert.equal(metrics.controls.length, 5, 'only the five primary controls occupy the collapsed action row');
      for (const control of metrics.controls) {
        assert.ok(control.width >= 44 && control.height >= 44, `primary touch target is too small at ${width}px`);
        assert.ok(Math.abs(control.y - metrics.controls[0].y) < 1, `action controls wrap at ${width}px`);
        assert.ok(control.x >= metrics.left && control.right <= metrics.right, `action escapes its post at ${width}px`);
      }
      assert.equal(metrics.actionsHeight, 44, 'hidden secondary actions must not reserve rows');
      assert.ok(metrics.bottomGap <= 18, `blank space remains below the actions: ${metrics.bottomGap}`);
      // On short landscape screens the author/media minimum takes precedence
      // over the portrait half-screen budget. Actions must still be reachable.
      if (!landscape) assert.ok(metrics.height <= height / 2 + 1, `collapsed post is too tall: ${metrics.height}`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `post overflows horizontally at ${width}px`);
      assert.equal(await card.locator('.post-secondary-actions').isVisible(), false);
    }

    const first = cards.first();
    assert.equal(await first.locator('.post-body').count(), 0, 'media-only posts must not contain an empty text link');
    const headerAndMedia = await first.evaluate(element => {
      const header = element.querySelector('.post-main').getBoundingClientRect();
      const image = element.querySelector('.media-preview-button').getBoundingClientRect();
      const author = element.querySelector('.post-author-name').getBoundingClientRect();
      const handle = element.querySelector('.post-author-handle').getBoundingClientRect();
      const time = element.querySelector('.post-time').getBoundingClientRect();
      const preview = element.querySelector('.preview-wrap').getBoundingClientRect();
      const photo = element.querySelector('.media-preview-image').getBoundingClientRect();
      return {
        gap: image.top - header.bottom, imageWidth: image.width, contentWidth: element.clientWidth - 32,
        nameBottom: author.bottom, handleTop: handle.top, authorRight: author.right, timeLeft: time.left,
        visiblePhotoHeight: Math.min(photo.bottom, preview.bottom) - Math.max(photo.top, preview.top), photoHeight: photo.height,
      };
    });
    assert.ok(headerAndMedia.gap <= 20, `blank media gap remains at ${width}px: ${headerAndMedia.gap}`);
    if (!landscape) {
      assert.ok(headerAndMedia.imageWidth >= headerAndMedia.contentWidth - 1, 'media must use the phone card width');
      assert.ok(headerAndMedia.handleTop >= headerAndMedia.nameBottom - 1, 'the handle must have its own line on phones');
    }
    assert.ok(headerAndMedia.visiblePhotoHeight >= 44, 'short viewports must retain a visible media preview');
    assert.ok(headerAndMedia.visiblePhotoHeight >= headerAndMedia.photoHeight - 1, 'the media-only preview must show the whole photo');
    assert.ok(headerAndMedia.authorRight < headerAndMedia.timeLeft, 'the author must not overlap the timestamp');
    await page.screenshot({ path: `playwright-results/post-mobile-${width}.png` });

    const more = first.getByRole('button', { name: 'More post actions', exact: true });
    await more.tap();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    const panel = first.getByRole('group', { name: 'More post actions', exact: true });
    for (const name of ['Quote post', 'Copy link to post', 'Pin post to top', 'Add post to reading list', 'Read post aloud', 'Translate post', 'Share post as image', 'Show post statistics', 'Report post', 'Close']) {
      assert.equal(await panel.getByRole('button', { name, exact: true }).isVisible(), true, `${name} must be accessible on touch`);
    }
    await panel.getByRole('button', { name: 'Add post to reading list', exact: true }).tap();
    assert.equal(await panel.getByRole('link', { name: 'Reading Lists', exact: true }).isVisible(), true);
    await panel.getByRole('button', { name: 'Close', exact: true }).tap();
    assert.equal(await more.getAttribute('aria-expanded'), 'false');

    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    assert.equal(await more.getAttribute('aria-expanded'), 'false', 'Escape closes the action disclosure');
    assert.equal(await more.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the disclosure control');
    await more.tap();
    await panel.getByRole('button', { name: 'Quote post', exact: true }).tap();
    assert.equal(await page.getByLabel('Quote calls').textContent(), '1', 'the quote action must still call the parent');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');

    const long = cards.nth(1);
    const before = (await long.boundingBox()).height;
    await long.getByRole('button', { name: 'Show full post', exact: true }).tap();
    assert.ok((await long.boundingBox()).height > before, 'long posts can still expand');
    await long.getByRole('button', { name: 'Show less', exact: true }).tap();
    console.log(`Android touch post layout and action disclosure passed at ${width}×${height}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  if (created) await rm(route, { recursive: true, force: true });
}
