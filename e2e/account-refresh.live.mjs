// Exercises account addition while the root layout and client cache are alive.
import {spawn} from 'node:child_process'; import {webkit} from '@playwright/test'; import assert from 'node:assert/strict';
let server,browser;
try {
 server=spawn('npm',['run','dev','--','--port','4181','--strictPort'],{stdio:'ignore'});browser=await webkit.launch();const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});const page=await context.newPage();
 for(let i=0;;i++){try{await page.goto('http://localhost:4181/',{waitUntil:'domcontentloaded',timeout:5000});break}catch(e){if(i===40)throw e;await new Promise(r=>setTimeout(r,250));}}
 await page.route('https://mastodon.social/**',async route=>{
  const url=route.request().url(); const posts=url.includes('/api/v1/timelines/home')?[{id:'42',uri:'https://mastodon.social/@alice/42',url:'https://mastodon.social/@alice/42',created_at:new Date().toISOString(),content:'<p>Fresh Mastodon timeline post</p>',account:{id:'10',acct:'alice',url:'https://mastodon.social/@alice',display_name:'Alice',avatar:'https://mastodon.social/a.png'},media_attachments:[],replies_count:0,reblogs_count:0,favourites_count:0}]:[];
  await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},contentType:'application/json',body:JSON.stringify(posts)});
 });
 await page.evaluate(async()=>{const db=await import('/src/lib/db.ts');await db.addAccount({platform:'bluesky',handle:'dummy.bsky.social',credentials:'{}'});});
 await page.getByText('1 account',{exact:true}).waitFor({timeout:10000});
 // Warm the same factory cache that was stale after the Mastodon OAuth callback.
 await page.evaluate(async()=>{const factory=await import('/src/lib/api/client-factory.ts');await factory.initAllClients();});
 await page.evaluate(async()=>{const db=await import('/src/lib/db.ts');await db.addAccount({platform:'mastodon',handle:'@alice@mastodon.social',instance_url:'https://mastodon.social',credentials:JSON.stringify({access_token:'fake-test-token'})});});
 await page.getByText('2 accounts',{exact:true}).waitFor({timeout:10000});
 const result=await page.evaluate(async()=>{const factory=await import('/src/lib/api/client-factory.ts');const value=await factory.initAllClients();return {accounts:value.accounts.length,platforms:[...value.clients.values()].map(x=>x.platform)};});
 assert.equal(result.accounts,2);assert.ok(result.platforms.includes('mastodon'));
 await page.getByRole('link',{name:'Feed',exact:true}).first().click();
 try { await page.getByText('Fresh Mastodon timeline post').first().waitFor({timeout:15000}); } catch (e) { console.error((await page.locator('body').innerText()).slice(-1800)); throw e; }
 console.log('Account addition, sidebar refresh, client invalidation and Mastodon timeline passed');
} finally {await browser?.close();server?.kill('SIGTERM');}
