/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsJson, exportAsCsv, exportAsMarkdown } from './export';
import type { UnifiedPost } from '$lib/types';

// Mock DOM APIs
let downloadedContent = '';
let downloadedFilename = '';
const OriginalBlob = global.Blob;
afterEach(() => vi.restoreAllMocks());

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
  vi.spyOn(global, 'Blob').mockImplementation(class extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      downloadedContent = parts?.join('') ?? '';
    }
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

  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1'])('neutralizes spreadsheet formulas in remote text: %s', text => {
    exportAsCsv([makePost({ text })], 'test');
    expect(downloadedContent).toContain(`'${text}`);
  });

  it('escapes every remote string column, including handles and URLs', () => {
    exportAsCsv([makePost({ uri: 'https://example.com/post,a', author: { handle: '=1+1', displayName: 'Alice' }, text: 'hello\rworld' })], 'test');
    expect(downloadedContent).toContain('"https://example.com/post,a"');
    expect(downloadedContent).toContain(",bluesky,'=1+1,");
    expect(downloadedContent).toContain('"hello\rworld"');
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
