import { describe, it, expect, beforeEach } from 'vitest';
import { listFeeds, addFeed, removeFeed, rssItemToPost } from './rss';

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  },
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('RSS feed management', () => {
  it('returns empty list when no feeds saved', () => {
    expect(listFeeds()).toEqual([]);
  });

  it('adds a feed', () => {
    const feed = addFeed('https://example.com/feed.xml', 'Example Blog');
    expect(feed.url).toBe('https://example.com/feed.xml');
    expect(feed.title).toBe('Example Blog');
    expect(feed.id).toBeTruthy();
    expect(listFeeds()).toHaveLength(1);
  });

  it('uses URL as title when none provided', () => {
    const feed = addFeed('https://example.com/rss');
    expect(feed.title).toBe('https://example.com/rss');
  });

  it('adds multiple feeds', () => {
    addFeed('https://a.com/feed');
    addFeed('https://b.com/feed');
    expect(listFeeds()).toHaveLength(2);
  });

  it('removes a feed', () => {
    const f1 = addFeed('https://a.com/feed', 'A');
    addFeed('https://b.com/feed', 'B');
    expect(listFeeds()).toHaveLength(2);
    removeFeed(f1.id);
    expect(listFeeds()).toHaveLength(1);
    expect(listFeeds()[0].title).toBe('B');
  });

  it('generates unique IDs', () => {
    const f1 = addFeed('https://a.com/feed');
    const f2 = addFeed('https://b.com/feed');
    expect(f1.id).not.toBe(f2.id);
  });

  it('trims whitespace from URL and title', () => {
    const feed = addFeed('  https://example.com/feed  ', '  Blog  ');
    expect(feed.url).toBe('https://example.com/feed');
    expect(feed.title).toBe('Blog');
  });
});

describe('rssItemToPost', () => {
  it('converts an RSS item to a UnifiedPost', () => {
    const item = {
      title: 'Hello World',
      link: 'https://example.com/post/1',
      description: 'This is a test post',
      pubDate: '2026-06-05T12:00:00Z',
      author: 'Alice',
    };
    const post = rssItemToPost(item, 'Example Blog');
    expect(post.uri).toBe('https://example.com/post/1');
    expect(post.text).toContain('Hello World');
    expect(post.text).toContain('This is a test post');
    expect(post.author.handle).toBe('Example Blog');
    expect(post.author.displayName).toBe('Alice');
    expect(post.isRepost).toBe(false);
  });

  it('uses feed title when no author', () => {
    const item = {
      title: 'Post',
      link: 'https://example.com/1',
      description: '',
      pubDate: '',
    };
    const post = rssItemToPost(item, 'My Feed');
    expect(post.author.displayName).toBe('My Feed');
  });

  it('handles missing pubDate', () => {
    const item = {
      title: 'Post',
      link: 'https://example.com/1',
      description: 'Desc',
      pubDate: '',
    };
    const post = rssItemToPost(item, 'Feed');
    expect(post.createdAt).toBeTruthy();
  });
});
