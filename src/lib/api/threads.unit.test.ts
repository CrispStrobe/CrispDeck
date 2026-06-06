/**
 * Unit tests for ThreadsClient — constructor, OAuth URL, normalization.
 * No network calls (the API requires real OAuth tokens).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ThreadsClient,
  getThreadsAuthUrl,
  getThreadsConfig,
  setThreadsConfig,
  type ThreadsPost,
  type ThreadsConfig,
} from './threads';

describe('ThreadsClient', () => {
  describe('constructor', () => {
    it('creates a client with access token and user ID', () => {
      const client = new ThreadsClient('test-token', '12345');
      expect(client.getAccessToken()).toBe('test-token');
      expect(client.getUserId()).toBe('12345');
    });
  });

  describe('normalizePost', () => {
    it('normalizes a text post', () => {
      const client = new ThreadsClient('token', '123');
      const post: ThreadsPost = {
        id: '456',
        text: 'Hello Threads!',
        username: 'testuser',
        timestamp: '2026-06-06T12:00:00Z',
        media_type: 'TEXT_POST',
        permalink: 'https://www.threads.net/@testuser/post/456',
      };

      const unified = client.normalizePost(post);
      expect(unified.text).toBe('Hello Threads!');
      expect(unified.platform).toBe('threads');
      expect(unified.author.handle).toBe('@testuser');
      expect(unified.uri).toBe('https://www.threads.net/@testuser/post/456');
      expect(unified.isRepost).toBe(false);
    });

    it('normalizes a repost facade', () => {
      const client = new ThreadsClient('token', '123');
      const post: ThreadsPost = {
        id: '789',
        text: 'Reposted content',
        username: 'reposter',
        timestamp: '2026-06-06T13:00:00Z',
        media_type: 'REPOST_FACADE',
      };

      const unified = client.normalizePost(post);
      expect(unified.isRepost).toBe(true);
    });

    it('handles post with no username', () => {
      const client = new ThreadsClient('token', '123');
      const post: ThreadsPost = {
        id: '101',
        text: 'Anonymous post',
      };

      const unified = client.normalizePost(post);
      expect(unified.author.handle).toBe('unknown');
    });

    it('handles post with media', () => {
      const client = new ThreadsClient('token', '123');
      const post: ThreadsPost = {
        id: '202',
        text: 'Image post',
        username: 'photouser',
        media_type: 'IMAGE',
        media_url: 'https://example.com/image.jpg',
        thumbnail_url: 'https://example.com/thumb.jpg',
      };

      const unified = client.normalizePost(post);
      expect(unified.embeds).toBeDefined();
      expect((unified.embeds as any).type).toBe('IMAGE');
      expect((unified.embeds as any).url).toBe('https://example.com/image.jpg');
    });

    it('uses threads:// URI when no permalink', () => {
      const client = new ThreadsClient('token', '123');
      const post: ThreadsPost = {
        id: '303',
        text: 'No permalink',
        username: 'user',
      };

      const unified = client.normalizePost(post);
      expect(unified.uri).toBe('threads://303');
    });
  });
});

describe('getThreadsAuthUrl', () => {
  it('builds correct OAuth URL', () => {
    const url = getThreadsAuthUrl('app-123', 'https://example.com/callback', 'state-xyz');
    expect(url).toContain('https://threads.net/oauth/authorize');
    expect(url).toContain('client_id=app-123');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    expect(url).toContain('state=state-xyz');
    expect(url).toContain('scope=threads_basic');
    expect(url).toContain('threads_content_publish');
    expect(url).toContain('response_type=code');
  });
});

describe('ThreadsConfig', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('returns null when no config stored', () => {
    expect(getThreadsConfig()).toBeNull();
  });

  it('round-trips config through localStorage', () => {
    const config: ThreadsConfig = {
      client_id: 'test-id',
      client_secret: 'test-secret',
      redirect_uri: 'https://example.com/callback',
    };
    setThreadsConfig(config);
    const loaded = getThreadsConfig();
    expect(loaded).toEqual(config);
  });
});
