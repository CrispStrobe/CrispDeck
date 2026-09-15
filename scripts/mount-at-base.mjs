#!/usr/bin/env node
/**
 * Rewrite the static files that hardcode an origin or a root path, so the app
 * can be served somewhere other than the root of crispdeck.vercel.app.
 *
 * Run BEFORE `vite build`, and only for such a deployment. The committed files
 * stay exactly as the Vercel production deployment needs them — that one is the
 * canonical install and its OAuth client document is a published, registered
 * identity that must not drift. This script edits working-copy files in a CI
 * checkout; it is never meant to be committed back.
 *
 *   node scripts/mount-at-base.mjs --origin https://user.github.io --base /CrispDeck
 *
 * Three files need it:
 *   client-metadata.json  AT Protocol fetches client_id as a URL and requires
 *                         every redirect_uri to sit under the same origin. A
 *                         copy served elsewhere pointing at the Vercel origin
 *                         would send the user back to Vercel after sign-in,
 *                         leaving them logged in on the wrong deployment.
 *   manifest.json         start_url/scope/id decide what the installed PWA
 *                         opens and which pages it owns.
 *   sw.js                 the shell it precaches, and the offline fallback.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const origin = (args.origin ?? '').replace(/\/$/, '');
const base = (args.base ?? '').replace(/\/$/, '');
if (!origin) {
  console.error('mount-at-base: --origin is required (e.g. https://user.github.io)');
  process.exit(1);
}
const root = base || '';
const url = (p) => `${origin}${root}${p}`;

// --- client-metadata.json -------------------------------------------------
{
  const f = 'static/client-metadata.json';
  const m = JSON.parse(readFileSync(f, 'utf8'));
  m.client_id = url('/client-metadata.json');
  m.client_uri = `${origin}${root}/`;
  m.logo_uri = url('/favicon.png');
  m.redirect_uris = [url('/oauth/bsky-callback')];
  writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
  console.log(`  client_id    ${m.client_id}`);
  console.log(`  redirect_uri ${m.redirect_uris[0]}`);
}

// --- manifest.json --------------------------------------------------------
{
  const f = 'static/manifest.json';
  const m = JSON.parse(readFileSync(f, 'utf8'));
  const rebase = (p) => (p.startsWith('/') ? `${root}${p}` : p);
  m.start_url = `${root}/`;
  m.scope = `${root}/`;
  m.id = `${root}/`;
  if (Array.isArray(m.icons)) m.icons = m.icons.map((i) => ({ ...i, src: rebase(i.src) }));
  if (Array.isArray(m.shortcuts)) m.shortcuts = m.shortcuts.map((s) => ({ ...s, url: rebase(s.url) }));
  if (Array.isArray(m.screenshots)) m.screenshots = m.screenshots.map((s) => ({ ...s, src: rebase(s.src) }));
  writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
  console.log(`  manifest scope ${m.scope}`);
}

// --- sw.js ----------------------------------------------------------------
{
  const f = 'static/sw.js';
  let s = readFileSync(f, 'utf8');
  s = s.replace("const SHELL_URLS = ['/'];", `const SHELL_URLS = ['${root}/'];`);
  s = s.replace(/caches\.match\('\/'\)/g, `caches.match('${root}/')`);
  s = s.replace(/'\/favicon\.png'/g, `'${root}/favicon.png'`);
  s = s.replace(/\|\| '\/notifications'/g, `|| '${root}/notifications'`);
  writeFileSync(f, s);
  console.log(`  sw shell ${root}/`);
}
