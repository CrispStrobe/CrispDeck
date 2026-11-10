import { describe, expect, it } from 'vitest';
import { searchBlueskyAccount } from './bluesky-search';
import type { ClientEntry } from './client-factory';

const LIVE = !!process.env.CRISPDECK_LIVE;
const api = 'https://public.api.bsky.app/xrpc';

describe.skipIf(!LIVE)('multiword Bluesky search — live', () => {
  it('returns Dirk Suckow without unrelated people and loads his posts', async () => {
    async function get(endpoint: string, params: Record<string, string>) {
      const response = await fetch(`${api}/${endpoint}?${new URLSearchParams(params)}`);
      if (!response.ok) throw new Error(`Bluesky returned ${response.status}`);
      return response.json();
    }
    const client = {
      searchPosts: async () => ({ posts: [] }),
      searchActors: async (term: string) => (await get('app.bsky.actor.searchActors', { term, limit: '8' })).actors,
      getAuthorFeed: async (actor: string) => get('app.bsky.feed.getAuthorFeed', { actor, filter: 'posts_no_replies', limit: '10' }),
    };
    const result = await searchBlueskyAccount({ client } as unknown as ClientEntry, 'dirk suckow');
    expect(result.actors.some(actor => actor.handle === 'dirksuckow.bsky.social')).toBe(true);
    expect(result.actors.every(actor => {
      const text = `${actor.displayName ?? ''} ${actor.handle}`.toLowerCase();
      return text.includes('dirk') && text.includes('suckow');
    })).toBe(true);
    expect(result.posts.length).toBeGreaterThan(0);
  }, 30000);
});
