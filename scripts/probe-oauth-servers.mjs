#!/usr/bin/env node
// Ask the real sign-in servers whether they accept CrispDeck as configured.
//
//   node scripts/probe-oauth-servers.mjs                  # Bluesky only
//   node scripts/probe-oauth-servers.mjs --mastodon mastodon.social
//
// Bluesky: a pushed authorization request (PAR) to bsky.social for each
// published client. 201 means the server fetched that client's metadata from
// crispdeck.vercel.app and accepted its redirect URI. Nothing is created; the
// request expires on its own. Also confirms that prompt=none is refused for
// these public clients, which is why silent re-login cannot work.
//
// Mastodon (opt-in, because it registers an app on that instance): registers
// with the app's redirect URI and scopes, then checks the authorize URL is
// accepted (302 to sign-in, not an error page).
import { webcrypto as c } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SITE = 'https://crispdeck.vercel.app';
const AS = 'https://bsky.social';
const b64u = (b) => Buffer.from(b).toString('base64url');
let failed = false;
const report = (ok, what, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

async function par(clientId, redirectUri, extra = {}) {
  const meta = await (await fetch(`${AS}/.well-known/oauth-authorization-server`)).json();
  const endpoint = meta.pushed_authorization_request_endpoint;
  const kp = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const { kty, crv, x, y } = await c.subtle.exportKey('jwk', kp.publicKey);
  const dpop = async (nonce) => {
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty, crv, x, y } };
    const claims = { jti: b64u(c.getRandomValues(new Uint8Array(16))), htm: 'POST', htu: endpoint, iat: Math.floor(Date.now() / 1000), ...(nonce && { nonce }) };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    const sig = await c.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(input));
    return `${input}.${b64u(sig)}`;
  };
  const verifier = b64u(c.getRandomValues(new Uint8Array(32)));
  const body = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'atproto transition:generic transition:chat.bsky',
    code_challenge: b64u(await c.subtle.digest('SHA-256', Buffer.from(verifier))),
    code_challenge_method: 'S256',
    state: b64u(c.getRandomValues(new Uint8Array(16))),
    ...extra,
  });
  let nonce;
  for (;;) {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', DPoP: await dpop(nonce) }, body });
    const text = await r.text();
    if (r.status === 400 && !nonce && /use_dpop_nonce/.test(text)) { nonce = r.headers.get('dpop-nonce'); continue; }
    return { status: r.status, text };
  }
}

for (const file of ['client-metadata.json', 'client-metadata-native.json']) {
  const local = JSON.parse(readFileSync(new URL(`../static/${file}`, import.meta.url), 'utf8'));
  const live = await fetch(`${SITE}/${file}`).then((r) => r.json()).catch(() => null);
  report(JSON.stringify(live) === JSON.stringify(local), `${file} deployed`, live ? '' : 'not served');
  const signIn = await par(local.client_id, local.redirect_uris[0]);
  report(signIn.status === 201, `${file}: bsky.social accepts sign-in`, signIn.status === 201 ? '' : signIn.text);
  const silent = await par(local.client_id, local.redirect_uris[0], { prompt: 'none' });
  console.log(`info ${file}: prompt=none → ${silent.status} ${silent.text}`);
}

const i = process.argv.indexOf('--mastodon');
if (i > 0) {
  const host = process.argv[i + 1];
  const src = readFileSync(new URL('../src/lib/mastodon-app.ts', import.meta.url), 'utf8');
  const scopes = src.match(/MASTODON_SCOPES = \[([^\]]*)\]/)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1)).join(' ');
  const redirect = 'app.vercel.crispdeck://oauth/mastodon';
  const r = await fetch(`https://${host}/api/v1/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'CrispDeck (probe)', redirect_uris: redirect, scopes, website: SITE }),
  });
  const app = await r.json();
  report(r.ok && app.client_id, `${host}: registers with ${redirect}`, r.ok ? '' : JSON.stringify(app));
  if (app.client_id) {
    const q = new URLSearchParams({ client_id: app.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes });
    const a = await fetch(`https://${host}/oauth/authorize?${q}`, { redirect: 'manual' });
    report(a.status === 302, `${host}: authorize URL accepted`, `${a.status} ${a.headers.get('location') ?? ''}`);
  }
}

process.exit(failed ? 1 : 0);
