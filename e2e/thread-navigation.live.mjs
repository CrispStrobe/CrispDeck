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
  await page.locator(`[data-post-uri="${root}"]`).first().waitFor({timeout:20000});
  // Check actual rendered parent/child relationships against Bluesky's tree.
  const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(root)}&depth=4`);
  assert.ok(response.ok, `Bluesky thread HTTP ${response.status}`);
  const {thread} = await response.json();
  const pairs = [];
  const collect = node => {
    for (const child of node.replies ?? []) {
      if (node.post?.uri && child.post?.uri) pairs.push([node.post.uri, child.post.uri]);
      collect(child);
    }
  };
  collect(thread);
  let checked = 0;
  for (const [parent, child] of pairs) {
    const depths = await page.evaluate(([a,b]) => {
      const row = uri => [...document.querySelectorAll('[data-post-uri]')].find(el => el.getAttribute('data-post-uri') === uri)?.closest('[data-thread-depth]');
      const p = row(a), c = row(b);
      return p && c ? [Number(p.dataset.threadDepth), Number(c.dataset.threadDepth)] : null;
    }, [parent, child]);
    if (depths) { assert.equal(depths[1], depths[0] + 1); checked++; }
  }
  assert.ok(checked > 0, 'expected at least one visible parent/reply pair');
  await page.getByRole('button',{name:/Younger white people being slightly/}).first().click({timeout:20000});
  await page.waitForURL(/3mykjpik4gk2g/);
  await page.locator(`[data-post-uri="${quoted}"]`).first().waitFor({timeout:20000});
  assert.equal(await page.getByText('Something went wrong').count(),0);
  await page.getByRole('button',{name:/Back to feed/}).click();
  await page.waitForURL('**/feed');
  console.log('Quoted thread navigation and Back to feed passed');
} finally { await browser?.close(); server?.kill('SIGTERM'); }
