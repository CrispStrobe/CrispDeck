import { describe, it, expect } from 'vitest';
import { getCharLimit, graphemeLength } from './adapter';

describe('getCharLimit', () => {
  it('returns 300 for bluesky', () => {
    expect(getCharLimit('bluesky')).toBe(300);
  });

  it('returns 500 for mastodon', () => {
    expect(getCharLimit('mastodon')).toBe(500);
  });
});

describe('graphemeLength', () => {
  it('counts ASCII characters', () => {
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts emoji as single graphemes', () => {
    // Single emoji = 1 grapheme
    expect(graphemeLength('👍')).toBe(1);
  });

  it('counts compound emoji as single graphemes', () => {
    // Family emoji (ZWJ sequence) = 1 grapheme
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1);
  });

  it('counts flag emoji as single graphemes', () => {
    expect(graphemeLength('🇺🇸')).toBe(1);
  });

  it('handles mixed content', () => {
    // "Hi 👋" = 3 chars + space + 1 emoji = 4 graphemes
    expect(graphemeLength('Hi 👋')).toBe(4);
  });

  it('handles empty string', () => {
    expect(graphemeLength('')).toBe(0);
  });

  it('counts CJK characters as single graphemes', () => {
    expect(graphemeLength('日本語')).toBe(3);
  });

  it('counts combining diacritics correctly', () => {
    // "é" as e + combining acute = 1 grapheme
    expect(graphemeLength('e\u0301')).toBe(1);
  });
});
