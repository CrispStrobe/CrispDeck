/**
 * Extended tests for the compose adapter — graphemeLength edge cases,
 * char limits, and thread interactions.
 */
import { describe, it, expect } from 'vitest';
import { graphemeLength, getCharLimit } from './adapter';

describe('graphemeLength — extended', () => {
  it('counts ASCII text correctly', () => {
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts empty string as 0', () => {
    expect(graphemeLength('')).toBe(0);
  });

  it('counts single emoji as 1 grapheme', () => {
    expect(graphemeLength('😀')).toBe(1);
    expect(graphemeLength('❤️')).toBe(1);
    expect(graphemeLength('👍')).toBe(1);
  });

  it('counts ZWJ emoji sequences as 1 grapheme', () => {
    // Family emoji (ZWJ sequence)
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1);
    // Flag
    expect(graphemeLength('🏳️‍🌈')).toBe(1);
  });

  it('counts mixed ASCII and emoji', () => {
    expect(graphemeLength('Hi 👋')).toBe(4); // H, i, space, wave
  });

  it('counts CJK characters', () => {
    expect(graphemeLength('日本語')).toBe(3);
    expect(graphemeLength('你好世界')).toBe(4);
  });

  it('counts combining diacritical marks as 1 grapheme', () => {
    // e + combining acute accent
    expect(graphemeLength('e\u0301')).toBe(1);
  });

  it('counts Korean Hangul', () => {
    expect(graphemeLength('한국어')).toBe(3);
  });

  it('counts Arabic text', () => {
    expect(graphemeLength('مرحبا')).toBe(5);
  });

  it('counts skin tone modifiers as part of the emoji', () => {
    // Wave + skin tone modifier = 1 grapheme
    expect(graphemeLength('👋🏿')).toBe(1);
  });

  it('counts newlines as graphemes', () => {
    expect(graphemeLength('a\nb\nc')).toBe(5);
  });

  it('counts tabs as graphemes', () => {
    expect(graphemeLength('\t')).toBe(1);
  });

  it('counts spaces', () => {
    expect(graphemeLength('   ')).toBe(3);
  });

  it('handles long text correctly', () => {
    const text = 'a'.repeat(300);
    expect(graphemeLength(text)).toBe(300);
  });

  it('handles text at Bluesky limit boundary', () => {
    const text = '日'.repeat(300); // 300 CJK characters = 300 graphemes
    expect(graphemeLength(text)).toBe(300);
  });

  it('flag emoji is 1 grapheme', () => {
    expect(graphemeLength('🇺🇸')).toBe(1);
    expect(graphemeLength('🇩🇪')).toBe(1);
  });
});

describe('getCharLimit — extended', () => {
  it('bluesky limit is 300', () => {
    expect(getCharLimit('bluesky')).toBe(300);
  });

  it('mastodon limit is 500', () => {
    expect(getCharLimit('mastodon')).toBe(500);
  });

  it('bluesky limit is lower than mastodon', () => {
    expect(getCharLimit('bluesky')).toBeLessThan(getCharLimit('mastodon'));
  });
});
