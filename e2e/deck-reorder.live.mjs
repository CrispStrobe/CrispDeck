// Exercises the actual deck in WebKit with an isolated local test account.
import {spawn} from 'node:child_process'; import {webkit} from '@playwright/test'; import assert from 'node:assert/strict';
let server,browser;
try {
 server=spawn('npm',['run','dev','--','--port','4179','--strictPort'],{stdio:'ignore'}); browser=await webkit.launch(); const page=await browser.newPage({viewport:{width:1600,height:900}});
 for(let i=0;;i++){try{await page.goto('http://localhost:4179/compose',{waitUntil:'domcontentloaded',timeout:5000});break}catch(e){if(i===40)throw e;await new Promise(r=>setTimeout(r,250));}}
 await page.locator('textarea').first().waitFor({timeout:15000});
 await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const request=indexedDB.open('crispdeck');request.onsuccess=()=>{const tx=request.result.transaction('accounts','readwrite');tx.objectStore('accounts').put({id:99,platform:'bluesky',handle:'sample.bsky.social',display_name:'Test',credentials:'invalid'});tx.oncomplete=resolve;tx.onerror=reject;};});localStorage.setItem('crispdeck-live-counters','false');});
 await page.goto('http://localhost:4179/deck',{waitUntil:'domcontentloaded'});const handles=page.locator('.drag-handle');await handles.first().waitFor({timeout:20000});
 const order=()=>handles.evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
 let initial=await order();assert.equal(initial.length,3);
 await handles.nth(2).dragTo(page.getByRole('region',{name:'Timeline'}));
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('crispdeck-deck-columns')??'[]')[0]?.title==='Mentions');
 assert.match((await order())[0],/Mentions/);
 await page.reload();await page.locator('.drag-handle').first().waitFor({timeout:20000});assert.match((await order())[0],/Mentions/);
 await handles.first().focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('crispdeck-deck-columns')??'[]')[1]?.title==='Mentions');assert.match((await order())[1],/Mentions/);
 console.log('Deck drag, persistence and keyboard reorder passed');
} finally {await browser?.close();server?.kill('SIGTERM');}
