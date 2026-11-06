// Run with: PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers node e2e/feed-layout.live.mjs
// Creates a temporary development-only route so production builds do not ship fixtures.
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { webkit } from '@playwright/test';
import assert from 'node:assert/strict';
const route = 'src/routes/__layout_test';
let server, browser, created = false;
try {
  await mkdir(route); // Refuse to overwrite a pre-existing route.
  created = true;
  await copyFile('e2e/fixtures/feed-layout.svelte', `${route}/+page.svelte`);
  server = spawn('npm', ['run', 'dev', '--', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
  browser = await webkit.launch({headless:true});
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    for (let i=0;;i++) {
      try { await page.goto('http://localhost:4175/__layout_test'); break; }
      catch (e) { if (i===40) throw e; await new Promise(r=>setTimeout(r,250)); }
    }
    await page.waitForSelector('article');
    await page.waitForFunction(() => document.querySelectorAll('article').length === 7 && document.querySelector('img[alt="orange image"]')?.complete);
    const cards = page.locator('.fixture-post');
    for (let i=0;i<7;i++) {
      const card=cards.nth(i);
      await assertCard(card, viewport.height);
    }
    const first = cards.nth(0);
    const altBounds = await first.evaluate(el => {
      const preview = el.querySelector('.feed-preview').getBoundingClientRect();
      const alt = el.querySelector('button[aria-expanded]').getBoundingClientRect();
      return {top: alt.top, bottom: alt.bottom, previewTop: preview.top, previewBottom: preview.bottom};
    });
    assert.ok(altBounds.top >= altBounds.previewTop && altBounds.bottom <= altBounds.previewBottom, 'ALT button must be fully visible');
    const altButton = first.locator('button[aria-expanded]');
    await altButton.click();
    assert.equal(await altButton.getAttribute('aria-expanded'), 'true');
    await altButton.click();
    assert.equal(await first.locator('.post-layout').evaluate(e=>getComputedStyle(e).display),viewport.width>700?'grid':'block');
    const quoted = cards.nth(2);
    const quote = quoted.locator('.quote-copy');
    const image = quoted.locator('.post-media img[alt="orange image"]');
    assert.equal(await quote.count(), 1, 'quoted author and text must be in their own text block');
    assert.equal(await image.count(), 1, 'quoted image must remain independently clickable');
    const positions = await quoted.evaluate(el => {
      const text = el.querySelector('.quote-copy').getBoundingClientRect();
      const img = el.querySelector('.post-media img').getBoundingClientRect();
      const original = el.querySelector('.post-copy').getBoundingClientRect();
      return { textX:text.x, textY:text.y, imgX:img.x, originalY:original.y };
    });
    assert.ok(positions.textY > positions.originalY, 'quote text belongs below original text');
    if (viewport.width > 700) assert.ok(positions.imgX > positions.textX + 100, 'only the image belongs on the right');
    for (const index of [3, 4]) {
      const quoteOnly = cards.nth(index);
      const placement = await quoteOnly.evaluate(el => {
        const copy = el.querySelector('.post-copy').getBoundingClientRect();
        const quote = el.querySelector('.post-media').getBoundingClientRect();
        return {copyBottom:copy.bottom, quoteTop:quote.top, display:getComputedStyle(el.querySelector('.post-layout')).display};
      });
      assert.equal(placement.display, 'block', 'a quote without a directly embedded image must stack');
      assert.ok(placement.quoteTop >= placement.copyBottom - 1, 'quoted text belongs below the original');
    }
    await image.click();
    assert.equal(await page.locator('[role="dialog"]').count(), 1, 'quoted image opens the gallery');
    await page.keyboard.press('Escape');
    const long=cards.nth(1);
    const toggle = long.getByRole('button',{name:'Show full post'});
    const positionsBeforeExpand = await long.evaluate(el => ({preview:el.querySelector('.feed-preview').getBoundingClientRect().bottom, toggle:el.querySelector('.preview-toggle').getBoundingClientRect().top}));
    assert.ok(positionsBeforeExpand.toggle >= positionsBeforeExpand.preview, 'expand control must not obscure post text');
    await toggle.click();
    assert.equal(await long.getByRole('button',{name:'Show less'}).count(),1);
    await long.getByRole('button',{name:'Show less'}).click();
    await cards.nth(2).scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#test-feed').evaluate(e=>e.scrollTop)>0);
    const replyContext = cards.nth(6).locator('.reply-context');
    assert.match(await replyContext.innerText(), /Replying to Parent author/);
    assert.match(await replyContext.innerText(), /Parent message context/);
    assert.match(await replyContext.getAttribute('href'), /thread\?uri=/);
    const linkTitle = await cards.nth(5).evaluate(el => {
      const preview = el.querySelector('.feed-preview').getBoundingClientRect();
      const title = el.querySelector('.link-preview-copy .font-semibold').getBoundingClientRect();
      return { titleTop: title.top, titleBottom: title.bottom, previewTop: preview.top, previewBottom: preview.bottom };
    });
    assert.ok(linkTitle.titleTop >= linkTitle.previewTop && linkTitle.titleBottom <= linkTitle.previewBottom, 'link title must be fully visible in compact preview');
    await page.evaluate(() => {
      window.isTauri = true;
      window.__openedUrls = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => { if (command === 'plugin:opener|open_url') window.__openedUrls.push(args.url); } };
    });
    await cards.nth(5).getByRole('link', {name: /Podcast/}).click();
    await page.waitForFunction(() => window.__openedUrls?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__openedUrls), ['https://www.freiheitmachtpolitik.de/podcast/fm-politik']);
    await page.evaluate(() => localStorage.setItem('crispdeck-wallabag-url','https://read.example.com/wallabag'));
    await page.getByRole('button', {name:'Enable menu test'}).click();
    await cards.nth(5).getByRole('link', {name:/Podcast/}).click({button:'right'});
    const menu = page.getByRole('menu', {name:'Link actions'});
    assert.equal(await menu.getByRole('menuitem', {name:'Open link'}).count(), 1);
    assert.equal(await menu.getByRole('menuitem', {name:'Copy link'}).count(), 1);
    await menu.getByRole('menuitem', {name:'Save to Wallabag'}).click();
    await page.waitForFunction(() => window.__openedUrls.length === 2);
    const saved = new URL((await page.evaluate(() => window.__openedUrls))[1]);
    assert.equal(saved.origin + saved.pathname, 'https://read.example.com/wallabag/bookmarklet');
    assert.equal(saved.searchParams.get('url'), 'https://www.freiheitmachtpolitik.de/podcast/fm-politik');
    await page.close();
  }
  console.log('Feed layout: wide and narrow WebKit checks passed');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  if (created) await rm(route,{recursive:true,force:true});
}
async function assertCard(card, height) {
  const metrics=await card.locator('article').evaluate(e=>({height:e.getBoundingClientRect().height,overflow:getComputedStyle(e.parentElement).overflowY}));
  assert.ok(metrics.height <= height/2+1, `card height ${metrics.height} exceeds half of ${height}`);
  assert.notEqual(metrics.overflow,'auto','feed card must not trap scrolling');
}
