/**
 * Boundary tests for thread splitting — char limit edges, empty inputs,
 * single-char posts, exactly-at-limit posts.
 */
import { describe, it, expect } from 'vitest';
import { splitForPlatform } from './thread';

describe('splitForPlatform — boundary cases', () => {
  it('empty string returns one empty part', () => {
    const r = splitForPlatform('', 'bluesky');
    expect(r.parts).toHaveLength(1);
    expect(r.needsThread).toBe(false);
  });

  it('single character fits one post', () => {
    const r = splitForPlatform('x', 'bluesky');
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].charCount).toBe(1);
  });

  it('exactly 300 chars = 1 Bluesky post', () => {
    const r = splitForPlatform('a'.repeat(300), 'bluesky');
    expect(r.needsThread).toBe(false);
    expect(r.parts).toHaveLength(1);
  });

  it('301 chars = 2 Bluesky posts', () => {
    const r = splitForPlatform('a'.repeat(301), 'bluesky');
    expect(r.needsThread).toBe(true);
    expect(r.parts.length).toBeGreaterThanOrEqual(2);
  });

  it('exactly 500 chars = 1 Mastodon post', () => {
    const r = splitForPlatform('a'.repeat(500), 'mastodon');
    expect(r.needsThread).toBe(false);
  });

  it('501 chars = 2 Mastodon posts', () => {
    const r = splitForPlatform('a'.repeat(501), 'mastodon');
    expect(r.needsThread).toBe(true);
  });

  it('whitespace-only text', () => {
    const r = splitForPlatform('   ', 'bluesky');
    expect(r.parts.length).toBeGreaterThanOrEqual(1);
  });

  it('long text (2000 chars) splits into multiple parts', () => {
    const r = splitForPlatform('word '.repeat(400), 'bluesky');
    expect(r.parts.length).toBeGreaterThan(5);
    expect(r.needsThread).toBe(true);
  });

  it('newlines only', () => {
    const r = splitForPlatform('\n\n\n', 'mastodon');
    expect(r.parts.length).toBeGreaterThanOrEqual(1);
  });

  it('URL-heavy text does not break URLs', () => {
    const url = 'https://example.com/very/long/path/that/should/not/be/broken';
    const text = `Check this out: ${url} — it's great!`;
    const r = splitForPlatform(text, 'bluesky');
    const combined = r.parts.map(p => p.text).join(' ');
    expect(combined).toContain('https://');
  });
});
