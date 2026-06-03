/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportAsJson, exportAsCsv, exportAsMarkdown } from './export';
import type { UnifiedPost } from '$lib/types';

// Mock DOM APIs
let downloadedContent = '';
let downloadedFilename = '';

beforeEach(() => {
  downloadedContent = '';
  downloadedFilename = '';

  // Mock URL.createObjectURL / revokeObjectURL
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();

  // Mock document.createElement and friends
  const mockLink = {
    href: '',
    download: '',
    click: vi.fn(),
  };
  vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
  vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);

  // Capture the Blob content
  const originalBlob = global.Blob;
  vi.spyOn(global, 'Blob').mockImplementation((parts, options) => {
    downloadedContent = parts?.join('') ?? '';
    return new originalBlob(parts, options);
  });
});

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/abc123',
    text: 'Test post content',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: '2024-06-01T12:00:00Z',
    platform: 'bluesky',
    replyCount: 2,
    repostCount: 5,
    likeCount: 10,
    isRepost: false,
    ...overrides,
  };
}

describe('exportAsJson', () => {
  it('generates valid JSON with metadata', () => {
    const posts = [makePost()];
    exportAsJson(posts, 'alice.bsky.social');
    const parsed = JSON.parse(downloadedContent);
    expect(parsed.user).toBe('alice.bsky.social');
    expect(parsed.postCount).toBe(1);
    expect(parsed.posts[0].text).toBe('Test post content');
    expect(parsed.exportDate).toBeDefined();
  });

  it('includes all post fields', () => {
    const posts = [makePost({ likeCount: 42, repostCount: 7 })];
    exportAsJson(posts, 'test');
    const parsed = JSON.parse(downloadedContent);
    expect(parsed.posts[0].likeCount).toBe(42);
    expect(parsed.posts[0].repostCount).toBe(7);
    expect(parsed.posts[0].platform).toBe('bluesky');
  });

  it('handles empty posts array', () => {
    exportAsJson([], 'test');
    const parsed = JSON.parse(downloadedContent);
    expect(parsed.postCount).toBe(0);
    expect(parsed.posts).toHaveLength(0);
  });
});

describe('exportAsCsv', () => {
  it('includes headers', () => {
    exportAsCsv([makePost()], 'test');
    const firstLine = downloadedContent.split('\n')[0];
    expect(firstLine).toContain('uri');
    expect(firstLine).toContain('platform');
    expect(firstLine).toContain('text');
    expect(firstLine).toContain('likes');
  });

  it('escapes commas in text', () => {
    const posts = [makePost({ text: 'Hello, world' })];
    exportAsCsv(posts, 'test');
    expect(downloadedContent).toContain('"Hello, world"');
  });

  it('escapes quotes in text', () => {
    const posts = [makePost({ text: 'She said "hello"' })];
    exportAsCsv(posts, 'test');
    expect(downloadedContent).toContain('""hello""');
  });

  it('escapes newlines in text', () => {
    const posts = [makePost({ text: 'Line 1\nLine 2' })];
    exportAsCsv(posts, 'test');
    expect(downloadedContent).toContain('"Line 1\nLine 2"');
  });

  it('has correct number of rows', () => {
    const posts = [makePost(), makePost(), makePost()];
    exportAsCsv(posts, 'test');
    const lines = downloadedContent.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(4); // 1 header + 3 rows
  });
});

describe('exportAsMarkdown', () => {
  it('includes title and export date', () => {
    exportAsMarkdown([makePost()], 'alice.bsky.social');
    expect(downloadedContent).toContain('# Post Archive for alice.bsky.social');
    expect(downloadedContent).toContain('Exported on');
  });

  it('includes post content as blockquote', () => {
    exportAsMarkdown([makePost({ text: 'My great post' })], 'test');
    expect(downloadedContent).toContain('> My great post');
  });

  it('includes stats', () => {
    exportAsMarkdown([makePost({ likeCount: 42, repostCount: 7 })], 'test');
    expect(downloadedContent).toContain('Likes: 42');
    expect(downloadedContent).toContain('Reposts: 7');
  });

  it('includes post URL for Bluesky', () => {
    exportAsMarkdown([makePost()], 'test');
    expect(downloadedContent).toContain('https://bsky.app/profile/alice.bsky.social/post/abc123');
  });
});
