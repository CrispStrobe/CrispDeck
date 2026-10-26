import { chromium } from '@playwright/test';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'play-store-assets');
await mkdir(out, { recursive: true });
const icon = await readFile('static/icon-512.png');
if (icon.readUInt32BE(16) !== 512 || icon.readUInt32BE(20) !== 512) throw new Error('Store icon must be 512×512');
await copyFile('static/icon-512.png', path.join(out, 'store-icon.png'));
const graphic = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0c1428"/><stop offset="1" stop-color="#172c48"/></linearGradient></defs>
<rect width="1024" height="500" fill="url(#bg)"/>
<circle cx="1000" cy="20" r="260" fill="#60a5fa" opacity=".07"/>
<circle cx="980" cy="500" r="300" fill="#22d3ee" opacity=".05"/>
<image href="data:image/png;base64,${icon.toString('base64')}" x="64" y="58" width="104" height="104"/>
<text x="64" y="250" fill="#f8fafc" font-family="Arial,sans-serif" font-size="72" font-weight="700">CrispDeck</text>
<text x="68" y="310" fill="#dbeafe" font-family="Arial,sans-serif" font-size="32">Read, compose and crosspost.</text>
<text x="68" y="390" fill="#93c5fd" font-family="Arial,sans-serif" font-size="25">Mastodon · Bluesky · Threads</text>
<g fill="#60a5fa" opacity=".3"><rect x="735" y="120" width="54" height="225" rx="12"/><rect x="805" y="92" width="54" height="281" rx="12"/><rect x="875" y="148" width="54" height="169" rx="12"/></g>
</svg>`;
await writeFile(path.join(out, 'feature-graphic.svg'), graphic);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0">${graphic}</body></html>`);
  await page.locator('image').evaluate(image => new Promise((resolve, reject) => {
    const probe = new Image(); probe.onload = () => resolve(true); probe.onerror = () => reject(new Error('Store icon failed to load')); probe.src = image.getAttribute('href');
  }));
  await page.screenshot({ path: path.join(out, 'feature-graphic.png') });
} finally { await browser.close(); }
await copyFile('tools/play/listing.json', path.join(out, 'listing.json'));
await writeFile(path.join(out, 'README.txt'), 'Draft Google Play listing assets. Feature graphic: 1024x500; icon: 512x512. Screenshots render the actual web UI at Android-sized viewports using synthetic network fixtures. They are not physical-device/live-account validation. Review the screenshots against native Android behavior before Console upload. No asset has been uploaded to Play Console.\n');
