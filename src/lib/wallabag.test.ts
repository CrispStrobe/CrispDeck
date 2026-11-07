import { describe, it, expect } from 'vitest';
import { wallabagBookmarklet } from './wallabag';
describe('Wallabag link action', () => {
  it('builds a bookmarklet link for an instance installed under a path', () => {
    const result = new URL(wallabagBookmarklet('https://read.example.com/wallabag/', 'https://example.org/a?x=1&y=2')!);
    expect(result.origin+result.pathname).toBe('https://read.example.com/wallabag/bookmarklet');
    expect(result.searchParams.get('url')).toBe('https://example.org/a?x=1&y=2');
  });
  it('rejects invalid protocols and credentials', () => {
    expect(wallabagBookmarklet('javascript:alert(1)','https://example.org')).toBeNull();
    expect(wallabagBookmarklet('https://user:secret@example.org','https://example.org')).toBeNull();
    expect(wallabagBookmarklet('https://example.org','javascript:alert(1)')).toBeNull();
    expect(wallabagBookmarklet('https://example.org','https://user:secret@article.example')).toBeNull();
  });
});
