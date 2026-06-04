/**
 * Extended tests for thread splitting — edge cases, unicode handling,
 * and boundary conditions.
 */
import { describe, it, expect } from 'vitest';
import { splitForPlatform, planThread } from './thread';

describe('splitForPlatform — extended', () => {
  describe('unicode and emoji handling', () => {
    it('does not produce empty parts when splitting emoji-heavy text', () => {
      const text = 'a'.repeat(295) + ' 😀😀😀😀';
      const result = splitForPlatform(text, 'bluesky');
      // All parts should have non-empty text
      for (const part of result.parts) {
        expect(part.text.trim().length).toBeGreaterThan(0);
      }
      // All emoji should survive the split
      const combined = result.parts.map(p => p.text).join('');
      expect(combined).toContain('😀');
    });

    it('counts CJK characters correctly for splitting', () => {
      // 301 CJK characters should need 2 posts on Bluesky
      const text = '日'.repeat(301);
      const result = splitForPlatform(text, 'bluesky');
      expect(result.needsThread).toBe(true);
      expect(result.parts.length).toBeGreaterThanOrEqual(2);
    });

    it('handles mixed emoji and text', () => {
      const text = '👋 Hello! '.repeat(40); // ~400 chars
      const result = splitForPlatform(text, 'bluesky');
      expect(result.needsThread).toBe(true);
    });
  });

  describe('whitespace handling', () => {
    it('handles text with only newlines', () => {
      const text = '\n'.repeat(10);
      const result = splitForPlatform(text, 'bluesky');
      expect(result.parts.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves paragraph breaks when splitting', () => {
      const para1 = 'First paragraph. '.repeat(10);
      const para2 = 'Second paragraph. '.repeat(10);
      const text = `${para1}\n\n${para2}`;
      const result = splitForPlatform(text, 'bluesky');
      if (result.needsThread) {
        // At least one part should contain recognizable content
        const allText = result.parts.map(p => p.text).join('');
        expect(allText).toContain('First paragraph');
        expect(allText).toContain('Second paragraph');
      }
    });
  });

  describe('platform differences', () => {
    it('text at 301 chars needs thread on Bluesky but not Mastodon', () => {
      const text = 'a'.repeat(301);
      expect(splitForPlatform(text, 'bluesky').needsThread).toBe(true);
      expect(splitForPlatform(text, 'mastodon').needsThread).toBe(false);
    });

    it('text at 501 chars needs thread on both platforms', () => {
      const text = 'a'.repeat(501);
      expect(splitForPlatform(text, 'bluesky').needsThread).toBe(true);
      expect(splitForPlatform(text, 'mastodon').needsThread).toBe(true);
    });

    it('text at 300 chars fits Bluesky in one post', () => {
      const text = 'a'.repeat(300);
      expect(splitForPlatform(text, 'bluesky').needsThread).toBe(false);
      expect(splitForPlatform(text, 'bluesky').parts).toHaveLength(1);
    });

    it('text at 500 chars fits Mastodon in one post', () => {
      const text = 'a'.repeat(500);
      expect(splitForPlatform(text, 'mastodon').needsThread).toBe(false);
    });
  });

  describe('content preservation', () => {
    it('all words from input appear in output parts', () => {
      const words = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'];
      const text = (words.join(' ') + '. ').repeat(20);
      const result = splitForPlatform(text, 'bluesky');
      const combined = result.parts.map(p => p.text).join(' ');
      for (const word of words) {
        expect(combined).toContain(word);
      }
    });

    it('each part respects the platform char limit', () => {
      const text = 'Word '.repeat(200); // ~1000 chars
      const result = splitForPlatform(text, 'bluesky');
      for (const part of result.parts) {
        expect(part.charCount).toBeLessThanOrEqual(part.charLimit);
      }
    });
  });
});

describe('planThread — extended', () => {
  it('returns perPlatform plans for both platforms', () => {
    const text = 'Hello world!';
    const result = planThread(text, ['bluesky', 'mastodon']);
    expect(result.perPlatform).toHaveLength(2);
    expect(result.perPlatform.map(p => p.platform).sort()).toEqual(['bluesky', 'mastodon']);
  });

  it('short text produces single-part plans for both platforms', () => {
    const result = planThread('Short text', ['bluesky', 'mastodon']);
    for (const plan of result.perPlatform) {
      expect(plan.parts).toHaveLength(1);
      expect(plan.needsThread).toBe(false);
    }
  });

  it('400-char text: Bluesky needs thread, Mastodon does not', () => {
    const text = 'a'.repeat(400);
    const result = planThread(text, ['bluesky', 'mastodon']);
    const bsky = result.perPlatform.find(p => p.platform === 'bluesky')!;
    const masto = result.perPlatform.find(p => p.platform === 'mastodon')!;
    expect(bsky.needsThread).toBe(true);
    expect(masto.needsThread).toBe(false);
  });

  it('unified array is at least as long as the longest platform split', () => {
    const text = 'Hello world! '.repeat(60); // ~780 chars
    const result = planThread(text, ['bluesky', 'mastodon']);
    const maxParts = Math.max(...result.perPlatform.map(p => p.parts.length));
    expect(result.unified.length).toBe(maxParts);
    expect(maxParts).toBeGreaterThanOrEqual(2);
  });

  it('single platform works', () => {
    const result = planThread('Hello', ['bluesky']);
    expect(result.perPlatform).toHaveLength(1);
    expect(result.perPlatform[0].platform).toBe('bluesky');
    expect(result.unified).toHaveLength(1);
  });
});
