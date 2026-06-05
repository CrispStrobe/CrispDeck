/**
 * Live integration tests for Bluesky public API endpoints.
 * These hit real network endpoints — run with `npm test`.
 */
import { describe, it, expect } from 'vitest';

const PUBLIC_API = 'https://public.api.bsky.app';

describe('Bluesky public API — live', () => {
  it('trending topics returns data', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.unspecced.getTrendingTopics?limit=10`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    // May have topics or suggested — API shape varies
    const topics = data.topics ?? data.suggested ?? [];
    expect(Array.isArray(topics)).toBe(true);
    if (topics.length > 0) {
      expect(topics[0]).toHaveProperty('topic');
    }
  }, 15000);

  it('search posts endpoint exists (may require auth)', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=hello&limit=5`);
    // Search requires auth — 200, 401, or 403 are all valid responses
    expect([200, 401, 403].includes(resp.status)).toBe(true);
    if (resp.ok) {
      const data = await resp.json();
      expect(Array.isArray(data.posts)).toBe(true);
    }
  }, 15000);

  it('search actors returns results', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.actor.searchActors?term=bsky&limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data.actors)).toBe(true);
    expect(data.actors.length).toBeGreaterThan(0);
    expect(data.actors[0]).toHaveProperty('handle');
  }, 15000);

  it('get profile for bsky.app works', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=bsky.app`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.handle).toBe('bsky.app');
    expect(data.did).toMatch(/^did:/);
  }, 15000);

  it('resolve handle returns DID', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.did).toMatch(/^did:plc:/);
  }, 15000);

  it('get popular feed generators returns feeds', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.unspecced.getPopularFeedGenerators?limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data.feeds)).toBe(true);
    if (data.feeds.length > 0) {
      expect(data.feeds[0]).toHaveProperty('uri');
      expect(data.feeds[0]).toHaveProperty('displayName');
    }
  }, 15000);

  it('get post thread works', async () => {
    // Use a known bsky.app post
    const profileResp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=1`);
    expect(profileResp.ok).toBe(true);
    const profileData = await profileResp.json();
    if (profileData.feed?.length > 0) {
      const uri = profileData.feed[0].post.uri;
      const threadResp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`);
      expect(threadResp.ok).toBe(true);
      const threadData = await threadResp.json();
      expect(threadData.thread).toBeTruthy();
    }
  }, 15000);

  it('PDS resolution via plc.directory', async () => {
    // Resolve bsky.app's DID to PDS
    const resolveResp = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app`);
    const { did } = await resolveResp.json();

    const plcResp = await fetch(`https://plc.directory/${did}`);
    expect(plcResp.ok).toBe(true);
    const doc = await plcResp.json();
    expect(doc.service).toBeTruthy();
    const pds = doc.service.find((s: any) => s.type === 'AtprotoPersonalDataServer');
    expect(pds?.serviceEndpoint).toMatch(/^https:\/\//);
  }, 15000);

  it('search for nonexistent user returns empty', async () => {
    const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.actor.searchActors?term=zzzznonexistent999888777&limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.actors.length).toBe(0);
  }, 15000);
});
