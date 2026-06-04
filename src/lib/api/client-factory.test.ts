/**
 * Tests for client factory helper functions — getBskyAgent, getBskyClient, getMastoClient.
 * These are pure functions that operate on a Map, no network needed.
 */
import { describe, it, expect } from 'vitest';
import { getBskyAgent, getBskyClient, getMastoClient, type ClientEntry } from './client-factory';
import { BlueskyClient } from './bluesky';
import { MastodonClient } from './mastodon';

function makeClients(): Map<number, ClientEntry> {
  const map = new Map<number, ClientEntry>();
  map.set(1, {
    accountId: 1,
    platform: 'bluesky',
    handle: 'alice.bsky.social',
    client: BlueskyClient.readOnly('alice.bsky.social'),
  });
  map.set(2, {
    accountId: 2,
    platform: 'mastodon',
    handle: '@bob@mastodon.social',
    client: new MastodonClient('https://mastodon.social', 'fake-token'),
  });
  return map;
}

describe('getBskyClient', () => {
  it('returns the Bluesky client', () => {
    const clients = makeClients();
    const bsky = getBskyClient(clients);
    expect(bsky).toBeInstanceOf(BlueskyClient);
  });

  it('returns null when no Bluesky client exists', () => {
    const map = new Map<number, ClientEntry>();
    map.set(1, {
      accountId: 1,
      platform: 'mastodon',
      handle: '@bob@mastodon.social',
      client: new MastodonClient('https://mastodon.social', 'token'),
    });
    expect(getBskyClient(map)).toBeNull();
  });

  it('returns null for empty map', () => {
    expect(getBskyClient(new Map())).toBeNull();
  });
});

describe('getMastoClient', () => {
  it('returns the Mastodon client', () => {
    const clients = makeClients();
    const masto = getMastoClient(clients);
    expect(masto).toBeInstanceOf(MastodonClient);
  });

  it('returns null when no Mastodon client exists', () => {
    const map = new Map<number, ClientEntry>();
    map.set(1, {
      accountId: 1,
      platform: 'bluesky',
      handle: 'alice.bsky.social',
      client: BlueskyClient.readOnly('alice.bsky.social'),
    });
    expect(getMastoClient(map)).toBeNull();
  });

  it('returns null for empty map', () => {
    expect(getMastoClient(new Map())).toBeNull();
  });
});

describe('getBskyAgent', () => {
  it('returns null for read-only client without OAuth', () => {
    const map = new Map<number, ClientEntry>();
    map.set(1, {
      accountId: 1,
      platform: 'bluesky',
      handle: 'alice.bsky.social',
      client: BlueskyClient.readOnly('alice.bsky.social'),
    });
    // read-only client's getAgent throws, so getBskyAgent returns null
    expect(getBskyAgent(map)).toBeNull();
  });

  it('returns null for empty map', () => {
    expect(getBskyAgent(new Map())).toBeNull();
  });

  it('returns null for Mastodon-only clients', () => {
    const map = new Map<number, ClientEntry>();
    map.set(1, {
      accountId: 1,
      platform: 'mastodon',
      handle: '@bob@mastodon.social',
      client: new MastodonClient('https://mastodon.social', 'token'),
    });
    expect(getBskyAgent(map)).toBeNull();
  });

  it('prefers OAuth agent when available', () => {
    const fakeAgent = { did: 'did:plc:test' } as any;
    const map = new Map<number, ClientEntry>();
    map.set(1, {
      accountId: 1,
      platform: 'bluesky',
      handle: 'alice.bsky.social',
      client: BlueskyClient.readOnly('alice.bsky.social'),
      oauthAgent: fakeAgent,
    });
    expect(getBskyAgent(map)).toBe(fakeAgent);
  });
});
