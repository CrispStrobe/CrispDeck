/**
 * Unit tests for ThreadsClient API methods (mocked fetch).
 * Tests request construction, response parsing, error handling.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ThreadsClient } from './threads';

const TOKEN = 'test-token-abc';
const USER_ID = '12345678';

function mockFetch(data: any, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: () => Promise.resolve(data),
  });
}

function getCalledUrl(mock: ReturnType<typeof vi.fn>): URL {
  return new URL(mock.mock.calls[0][0]);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ThreadsClient API methods', () => {
  describe('getProfile', () => {
    it('fetches profile with correct fields', async () => {
      const fetch = mockFetch({ id: USER_ID, username: 'testuser', name: 'Test' });
      vi.stubGlobal('fetch', fetch);
      const client = new ThreadsClient(TOKEN, USER_ID);

      const profile = await client.getProfile();
      expect(profile.username).toBe('testuser');
      const url = getCalledUrl(fetch);
      expect(url.pathname).toBe(`/v1.0/${USER_ID}`);
      expect(url.searchParams.get('fields')).toContain('username');
      expect(url.searchParams.get('fields')).toContain('threads_profile_picture_url');
      expect(url.searchParams.get('access_token')).toBe(TOKEN);
    });
  });

  describe('getOwnPosts', () => {
    it('fetches own posts with default limit', async () => {
      const posts = [{ id: '1', text: 'Post 1' }, { id: '2', text: 'Post 2' }];
      const fetch = mockFetch({ data: posts });
      vi.stubGlobal('fetch', fetch);
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.getOwnPosts();
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('Post 1');
      const url = getCalledUrl(fetch);
      expect(url.pathname).toBe(`/v1.0/${USER_ID}/threads`);
      expect(url.searchParams.get('limit')).toBe('25');
    });

    it('accepts custom limit', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.getOwnPosts(10);
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('limit')).toBe('10');
    });

    it('returns empty array when data is null', async () => {
      vi.stubGlobal('fetch', mockFetch({}));
      const client = new ThreadsClient(TOKEN, USER_ID);
      const result = await client.getOwnPosts();
      expect(result).toEqual([]);
    });
  });

  describe('getPost', () => {
    it('fetches single post by ID', async () => {
      const post = { id: '999', text: 'Single post', media_type: 'TEXT_POST' };
      vi.stubGlobal('fetch', mockFetch(post));
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.getPost('999');
      expect(result.id).toBe('999');
      expect(result.text).toBe('Single post');
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.pathname).toBe('/v1.0/999');
    });
  });

  describe('getReplies', () => {
    it('fetches replies for a post', async () => {
      const replies = [{ id: 'r1', text: 'Reply 1' }, { id: 'r2', text: 'Reply 2' }];
      vi.stubGlobal('fetch', mockFetch({ data: replies }));
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.getReplies('999');
      expect(result).toHaveLength(2);
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.pathname).toBe('/v1.0/999/replies');
    });
  });

  describe('getMentions', () => {
    it('fetches mentions for the user', async () => {
      const mentions = [{ id: 'm1', text: 'Hey @user', username: 'other' }];
      vi.stubGlobal('fetch', mockFetch({ data: mentions }));
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.getMentions();
      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('other');
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.pathname).toBe(`/v1.0/${USER_ID}/mentions`);
      expect(url.searchParams.get('limit')).toBe('25');
    });

    it('accepts custom limit', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.getMentions(50);
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('limit')).toBe('50');
    });
  });

  describe('keywordSearch', () => {
    it('searches with query', async () => {
      const posts = [{ id: 's1', text: 'Found post' }];
      vi.stubGlobal('fetch', mockFetch({ data: posts }));
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.keywordSearch('svelte');
      expect(result).toHaveLength(1);
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.pathname).toBe('/v1.0/keyword_search');
      expect(url.searchParams.get('q')).toBe('svelte');
    });

    it('passes searchType option', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.keywordSearch('test', { searchType: 'RECENT' });
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('search_type')).toBe('RECENT');
    });

    it('passes mediaType option', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.keywordSearch('test', { mediaType: 'IMAGE' });
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('media_type')).toBe('IMAGE');
    });

    it('passes limit option', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.keywordSearch('test', { limit: 50 });
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('limit')).toBe('50');
    });

    it('does not include unset options', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.keywordSearch('test');
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.has('search_type')).toBe(false);
      expect(url.searchParams.has('media_type')).toBe(false);
    });
  });

  describe('getUserPosts', () => {
    it('fetches posts via profile_posts endpoint', async () => {
      const posts = [{ id: 'u1', text: 'User post', username: 'targetuser' }];
      vi.stubGlobal('fetch', mockFetch({ data: posts }));
      const client = new ThreadsClient(TOKEN, USER_ID);

      const result = await client.getUserPosts('@targetuser');
      expect(result).toHaveLength(1);
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.pathname).toBe('/v1.0/profile_posts');
      expect(url.searchParams.get('username')).toBe('targetuser');
    });

    it('strips @ from username', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.getUserPosts('@someuser');
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('username')).toBe('someuser');
    });

    it('handles username without @', async () => {
      vi.stubGlobal('fetch', mockFetch({ data: [] }));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.getUserPosts('plainuser');
      const url = getCalledUrl(vi.mocked(fetch));
      expect(url.searchParams.get('username')).toBe('plainuser');
    });
  });

  describe('error handling', () => {
    it('throws on API error with message', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: { message: 'Rate limited' } }, false, 429));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await expect(client.getOwnPosts()).rejects.toThrow('Rate limited');
    });

    it('throws generic error when no message', async () => {
      vi.stubGlobal('fetch', mockFetch({}, false, 500));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await expect(client.getOwnPosts()).rejects.toThrow('Threads API error');
    });
  });

  describe('like', () => {
    it('posts to /{userId}/likes with media_id', async () => {
      const fetchMock = mockFetch({ success: true });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.like('media-123');
      expect(fetchMock).toHaveBeenCalled();
      const body = fetchMock.mock.calls[0][1].body;
      expect(body.toString()).toContain('media_id=media-123');
    });
  });

  describe('unlike', () => {
    it('sends DELETE to /{userId}/likes', async () => {
      const fetchMock = mockFetch({ success: true });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ThreadsClient(TOKEN, USER_ID);
      await client.unlike('media-123');
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('throws on error response', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: { message: 'Not found' } }, false, 404));
      const client = new ThreadsClient(TOKEN, USER_ID);
      await expect(client.unlike('bad-id')).rejects.toThrow('Not found');
    });
  });

  describe('repost', () => {
    it('creates container then publishes', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          json: () => Promise.resolve(callCount === 1 ? { id: 'container-1' } : { id: 'published-1' }),
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ThreadsClient(TOKEN, USER_ID);
      const result = await client.repost('media-456');
      expect(result.id).toBe('published-1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('quote', () => {
    it('creates container with quote_post_id then publishes', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          json: () => Promise.resolve(callCount === 1 ? { id: 'container-q' } : { id: 'published-q' }),
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ThreadsClient(TOKEN, USER_ID);
      const result = await client.quote('media-789', 'Great post!');
      expect(result.id).toBe('published-q');
      // First call should include quote_post_id and text
      const firstBody = fetchMock.mock.calls[0][1].body;
      expect(firstBody.toString()).toContain('quote_post_id=media-789');
      expect(firstBody.toString()).toContain('text=Great+post');
    });
  });
});
