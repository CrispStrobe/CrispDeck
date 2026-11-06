// Run with PLAYWRIGHT_BROWSERS_PATH set to your Playwright browser directory.
// This test exercises a real public Bluesky thread and therefore needs network access.
import { spawn } from 'node:child_process';
import { webkit } from '@playwright/test';
import assert from 'node:assert/strict';
let server, browser;
try {
  server = spawn('npm', ['run','dev','--','--port','4177','--strictPort'], {stdio:'ignore'});
  browser = await webkit.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const root='at://did:plc:mencpxk4spd3xn3qotwkyyqf/app.bsky.feed.post/3mzmmrrbyn22s';
  const quoted='at://did:plc:mencpxk4spd3xn3qotwkyyqf/app.bsky.feed.post/3mykjpik4gk2g';
  for (let i=0;;i++) {
    try { await page.goto(`http://localhost:4177/thread?uri=${encodeURIComponent(root)}&platform=bluesky`); break; }
    catch(e) { if(i===40) throw e; await new Promise(r=>setTimeout(r,250)); }
  }
  await page.getByRole('button',{name:/Younger white people being slightly/}).first().click({timeout:20000});
  await page.waitForURL(/3mykjpik4gk2g/);
  await page.locator(`[data-post-uri="${quoted}"]`).first().waitFor({timeout:20000});
  assert.equal(await page.getByText('Something went wrong').count(),0);
  await page.getByRole('button',{name:/Back to feed/}).click();
  await page.waitForURL('**/feed');
  console.log('Quoted thread navigation and Back to feed passed');
} finally { await browser?.close(); server?.kill('SIGTERM'); }
