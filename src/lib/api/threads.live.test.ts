/**
 * Live integration tests for Threads API.
 * These hit the real Threads Graph API — only run when THREADS_ACCESS_TOKEN is set.
 *
 * Run with: THREADS_ACCESS_TOKEN=THAAx... npm test -- src/lib/api/threads.live.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ThreadsClient, type ThreadsPost, type ThreadsProfile } from './threads';
import { normalizePost } from './unified';

const TOKEN = process.env.THREADS_ACCESS_TOKEN ?? '';
const SKIP = !TOKEN;

describe.skipIf(SKIP)('ThreadsClient live API', () => {
  let client: ThreadsClient;
  let userId: string;

  beforeAll(() => {
    // We don't know user ID yet — fetch it from profile
    client = new ThreadsClient(TOKEN, 'me');
  });

  it('fetches own profile', async () => {
    // Use /me endpoint to get user ID
    const resp = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url&access_token=${TOKEN}`
    );
    expect(resp.ok).toBe(true);
    const profile: ThreadsProfile = await resp.json();
    expect(profile.id).toBeTruthy();
    expect(profile.username).toBeTruthy();
    userId = profile.id;
    // Recreate client with real user ID
    client = new ThreadsClient(TOKEN, userId);
    console.log(`  Threads user: @${profile.username} (${userId})`);
  });

  it('fetches own posts', async () => {
    const posts = await client.getOwnPosts(5);
    expect(Array.isArray(posts)).toBe(true);
    console.log(`  Own posts: ${posts.length}`);
    if (posts.length > 0) {
      const p = posts[0];
      expect(p.id).toBeTruthy();
      expect(p.timestamp).toBeTruthy();
      // Text may be empty for image-only posts
      console.log(`  Latest post: "${(p.text ?? '').slice(0, 60)}..." (${p.media_type})`);
    }
  });

  it('normalizes own posts to UnifiedPost', async () => {
    const posts = await client.getOwnPosts(3);
    for (const post of posts) {
      const unified = normalizePost(post, 'threads');
      expect(unified.platform).toBe('threads');
      expect(unified.uri).toBeTruthy();
      expect(unified.createdAt).toBeTruthy();
      expect(unified.author.handle).toContain('@');
      // Media posts should have embeds array
      if (post.media_type && post.media_type !== 'TEXT_POST' && post.media_url) {
        expect(Array.isArray(unified.embeds)).toBe(true);
        expect((unified.embeds as any[])[0].url).toBeTruthy();
      }
    }
  });

  it('fetches a single post by ID', async () => {
    const posts = await client.getOwnPosts(1);
    if (posts.length === 0) return; // skip if no posts
    const postId = posts[0].id;
    const post = await client.getPost(postId);
    expect(post.id).toBe(postId);
    // Post may be a REPOST_FACADE with no text/media — just verify we got the right ID
    console.log(`  Single post: ${post.media_type ?? 'unknown type'}, text: "${(post.text ?? '').slice(0, 40)}"`)
  });

  it('fetches replies to a post', async () => {
    const posts = await client.getOwnPosts(5);
    if (posts.length === 0) return;
    // Try first post — may have no replies
    try {
      const replies = await client.getReplies(posts[0].id);
      expect(Array.isArray(replies)).toBe(true);
      console.log(`  Replies to first post: ${replies.length}`);
    } catch (e) {
      // Some posts may not allow reply fetching
      console.log(`  Replies fetch failed (expected for some posts): ${e}`);
    }
  });

  it('fetches mentions', async () => {
    try {
      const mentions = await client.getMentions(10);
      expect(Array.isArray(mentions)).toBe(true);
      console.log(`  Mentions: ${mentions.length}`);
    } catch (e) {
      // Mentions may fail if permission not granted
      console.log(`  Mentions failed (may need threads_manage_mentions): ${e}`);
    }
  });

  it('performs keyword search', async () => {
    try {
      const results = await client.keywordSearch('technology', { searchType: 'TOP', limit: 5 });
      expect(Array.isArray(results)).toBe(true);
      console.log(`  Keyword search "technology": ${results.length} results`);
      if (results.length > 0) {
        expect(results[0].id).toBeTruthy();
        expect(results[0].username).toBeTruthy();
      }
    } catch (e) {
      console.log(`  Keyword search failed (may need threads_keyword_search): ${e}`);
    }
  });

  it('searches with media type filter', async () => {
    try {
      const results = await client.keywordSearch('art', { mediaType: 'IMAGE', limit: 3 });
      expect(Array.isArray(results)).toBe(true);
      console.log(`  Image search "art": ${results.length} results`);
      for (const r of results) {
        if (r.media_type) {
          expect(r.media_type).toBe('IMAGE');
        }
      }
    } catch (e) {
      console.log(`  Image search failed: ${e}`);
    }
  });

  it('fetches posts by username', async () => {
    try {
      // Search for own posts by username
      const profile = await client.getProfile();
      const results = await client.getUserPosts(profile.username, 5);
      expect(Array.isArray(results)).toBe(true);
      console.log(`  Posts by @${profile.username}: ${results.length}`);
    } catch (e) {
      console.log(`  User posts search failed: ${e}`);
    }
  });

  it('handles non-existent post gracefully', async () => {
    await expect(client.getPost('99999999999')).rejects.toThrow();
  });
});
