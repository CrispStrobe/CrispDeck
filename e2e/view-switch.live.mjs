// Tests cached view switches with deliberately slow Bluesky requests.
import {spawn} from 'node:child_process'; import {webkit} from '@playwright/test'; import assert from 'node:assert/strict';
let server,browser;
try {
 server=spawn('npm',['run','dev','--','--port','4180','--strictPort'],{stdio:'ignore'});browser=await webkit.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});
 for(let i=0;;i++){try{await page.goto('http://localhost:4180/',{waitUntil:'domcontentloaded',timeout:5000});break}catch(e){if(i===40)throw e;await new Promise(r=>setTimeout(r,250));}}
 await page.waitForTimeout(1200);
 await page.evaluate(async()=>{
  await new Promise((resolve,reject)=>{const request=indexedDB.open('crispdeck');request.onsuccess=()=>{const tx=request.result.transaction('accounts','readwrite');tx.objectStore('accounts').put({id:99,platform:'bluesky',handle:'sample.bsky.social',display_name:'Test',credentials:'invalid'});tx.oncomplete=resolve;tx.onerror=reject;};});
  const now=Date.now(); const post={uri:'at://did:plc:example/app.bsky.feed.post/a',text:'Cached feed test item',createdAt:new Date(now).toISOString(),platform:'bluesky',author:{handle:'sample.bsky.social',displayName:'Sample'},likeCount:0,repostCount:0,replyCount:0,isRepost:false};
  localStorage.setItem('crispdeck-vc-feed-timeline',JSON.stringify({data:[post],cachedAt:now}));
  localStorage.setItem('crispdeck-vc-notifications',JSON.stringify({data:[{id:'test',type:'follow',actors:[{handle:'cached-notification.bsky.social',displayName:'Cached notification actor',platform:'bluesky'}],latestAt:new Date(now).toISOString(),platforms:{}}],cachedAt:now}));
 });
 await page.route('https://**/xrpc/**',async route=>{await new Promise(r=>setTimeout(r,8000));await route.abort().catch(()=>{});});
 await page.goto('http://localhost:4180/feed',{waitUntil:'domcontentloaded'});
 await page.getByText('Cached feed test item').first().waitFor({timeout:5000});
 let start=Date.now();await page.getByRole('link',{name:'Notifications',exact:true}).first().click();await page.getByText('Cached notification actor').first().waitFor({timeout:3000});let notifications=Date.now()-start;
 start=Date.now();await page.getByRole('link',{name:'Feed',exact:true}).first().click();await page.getByText('Cached feed test item').first().waitFor({timeout:3000});let feed=Date.now()-start;
 assert.ok(notifications<3000 && feed<3000);console.log(`Cached view switches passed: notifications ${notifications} ms, feed ${feed} ms`);
} finally {await browser?.close();server?.kill('SIGTERM');}
