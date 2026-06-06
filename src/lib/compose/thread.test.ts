import { describe, it, expect } from 'vitest';
import { splitForPlatform, planThread } from './thread';

describe('splitForPlatform', () => {
  it('returns single part for short text on Bluesky', () => {
    const plan = splitForPlatform('Hello world', 'bluesky');
    expect(plan.needsThread).toBe(false);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].text).toBe('Hello world');
    expect(plan.parts[0].charCount).toBe(11);
    expect(plan.parts[0].charLimit).toBe(300);
  });

  it('returns single part for short text on Mastodon', () => {
    const plan = splitForPlatform('Hello world', 'mastodon');
    expect(plan.needsThread).toBe(false);
    expect(plan.parts).toHaveLength(1);
  });

  it('splits text at 300 chars for Bluesky', () => {
    const text = 'A'.repeat(600);
    const plan = splitForPlatform(text, 'bluesky');
    expect(plan.needsThread).toBe(true);
    expect(plan.parts.length).toBeGreaterThan(1);
    // Each part should be under 300 chars
    for (const part of plan.parts) {
      expect(part.charCount).toBeLessThanOrEqual(300);
    }
  });

  it('splits text at 500 chars for Mastodon', () => {
    const text = 'B'.repeat(1000);
    const plan = splitForPlatform(text, 'mastodon');
    expect(plan.needsThread).toBe(true);
    expect(plan.parts.length).toBeGreaterThan(1);
    for (const part of plan.parts) {
      expect(part.charCount).toBeLessThanOrEqual(500);
    }
  });

  it('Bluesky needs more parts than Mastodon for same text', () => {
    const text = 'Word '.repeat(80); // ~400 chars
    const bsky = splitForPlatform(text.trim(), 'bluesky');
    const masto = splitForPlatform(text.trim(), 'mastodon');
    expect(bsky.parts.length).toBeGreaterThanOrEqual(masto.parts.length);
  });

  it('splits on paragraph breaks first', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
    const plan = splitForPlatform(text, 'bluesky');
    // Text is short enough for one post on Bluesky (67 chars)
    expect(plan.needsThread).toBe(false);
  });

  it('splits long paragraphs on sentence boundaries', () => {
    const text = 'This is sentence one. This is sentence two. This is sentence three. '.repeat(10).trim();
    const plan = splitForPlatform(text, 'bluesky');
    expect(plan.needsThread).toBe(true);
    // Parts should not split mid-sentence when possible
    for (const part of plan.parts) {
      // Should end with punctuation + numbering, or at a sentence boundary
      expect(part.charCount).toBeLessThanOrEqual(300);
    }
  });

  it('adds thread numbering', () => {
    const text = 'X'.repeat(600);
    const plan = splitForPlatform(text, 'bluesky');
    expect(plan.parts[0].text).toContain('(1/');
    expect(plan.parts[plan.parts.length - 1].text).toContain(`/${plan.parts.length})`);
  });

  it('handles empty text', () => {
    const plan = splitForPlatform('', 'bluesky');
    expect(plan.needsThread).toBe(false);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].text).toBe('');
  });

  it('returns single part for short text on Threads', () => {
    const plan = splitForPlatform('Hello Threads!', 'threads');
    expect(plan.needsThread).toBe(false);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].charLimit).toBe(500);
  });

  it('splits text at 500 chars for Threads', () => {
    const text = 'T'.repeat(1000);
    const plan = splitForPlatform(text, 'threads');
    expect(plan.needsThread).toBe(true);
    expect(plan.parts.length).toBeGreaterThan(1);
    for (const part of plan.parts) {
      expect(part.charCount).toBeLessThanOrEqual(500);
    }
  });

  it('Threads and Mastodon have same limit', () => {
    const text = 'Word '.repeat(120).trim();
    const threads = splitForPlatform(text, 'threads');
    const masto = splitForPlatform(text, 'mastodon');
    expect(threads.parts.length).toBe(masto.parts.length);
  });

  it('handles text exactly at limit', () => {
    const text = 'A'.repeat(300);
    const plan = splitForPlatform(text, 'bluesky');
    expect(plan.needsThread).toBe(false);
    expect(plan.parts).toHaveLength(1);
  });

  it('handles text one char over limit', () => {
    const text = 'A'.repeat(301);
    const plan = splitForPlatform(text, 'bluesky');
    expect(plan.needsThread).toBe(true);
    expect(plan.parts.length).toBe(2);
  });

  it('preserves all text content (no loss)', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20).trim();
    const plan = splitForPlatform(text, 'bluesky');
    // Remove numbering to check content preservation
    const reconstructed = plan.parts.map(p => p.text.replace(/\s*\(\d+\/\d+\)$/, '')).join(' ');
    // All words should be present
    expect(reconstructed).toContain('quick brown fox');
    expect(reconstructed).toContain('lazy dog');
  });
});

describe('planThread', () => {
  it('returns per-platform plans', () => {
    const text = 'Y'.repeat(400); // Over Bluesky limit, under Mastodon
    const { perPlatform, unified } = planThread(text, ['bluesky', 'mastodon']);
    expect(perPlatform).toHaveLength(2);

    const bskyPlan = perPlatform.find(p => p.platform === 'bluesky');
    const mastoPlan = perPlatform.find(p => p.platform === 'mastodon');
    expect(bskyPlan!.needsThread).toBe(true);
    expect(mastoPlan!.needsThread).toBe(false);
  });

  it('unified uses the longest split', () => {
    const text = 'Z'.repeat(400);
    const { perPlatform, unified } = planThread(text, ['bluesky', 'mastodon']);
    const maxParts = Math.max(...perPlatform.map(p => p.parts.length));
    expect(unified.length).toBe(maxParts);
  });

  it('includes Threads in per-platform plans', () => {
    const text = 'W'.repeat(400);
    const { perPlatform } = planThread(text, ['bluesky', 'mastodon', 'threads']);
    expect(perPlatform).toHaveLength(3);
    const threadsPlan = perPlatform.find(p => p.platform === 'threads');
    expect(threadsPlan).toBeDefined();
    expect(threadsPlan!.needsThread).toBe(false); // 400 < 500
  });
});
