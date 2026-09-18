import { describe, it, expect } from 'vitest';
import { normalizeForCompare, profileText, textSimilarity, similarity } from './similarity';

const LONG = 'Shipping the new release today with a full changelog in the thread below for anyone interested';

describe('normalizeForCompare', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForCompare('  Hello   WORLD  ')).toBe('hello world');
  });

  it('strips urls', () => {
    expect(normalizeForCompare('read this https://example.com/a?b=1 now')).toBe('read this now');
  });

  it('strips hashtags and handles', () => {
    expect(normalizeForCompare('hello #tag @user.bsky.social world')).toBe('hello world');
  });

  it('strips punctuation but keeps letters and numbers', () => {
    expect(normalizeForCompare('Hello, world! 42 times…')).toBe('hello world 42 times');
  });

  it('keeps non-latin scripts', () => {
    expect(normalizeForCompare('日本語のテスト')).toBe('日本語のテスト');
    expect(normalizeForCompare('Привет, мир!')).toBe('привет мир');
  });

  it('handles an empty string', () => {
    expect(normalizeForCompare('')).toBe('');
    expect(normalizeForCompare('   ')).toBe('');
  });
});

describe('profileText', () => {
  it('builds word trigrams', () => {
    const p = profileText('one two three four');
    expect([...p.shingles]).toEqual(['one two three', 'two three four']);
  });

  it('falls back to bare words below three words', () => {
    expect([...profileText('one two').shingles]).toEqual(['one', 'two']);
  });

  it('is empty for empty text', () => {
    expect(profileText('').shingles.size).toBe(0);
  });
});

describe('textSimilarity', () => {
  const sim = (a: string, b: string) => similarity(a, b);

  it('is 1 for identical text', () => {
    expect(sim(LONG, LONG)).toBe(1);
  });

  it('is 1 for text differing only in case and punctuation', () => {
    expect(sim(LONG, LONG.toUpperCase() + '!!!')).toBe(1);
  });

  it('is 1 when one side just appends a link', () => {
    expect(sim(LONG, LONG + ' https://example.com/x')).toBe(1);
  });

  it('is 1 when one side just appends hashtags', () => {
    expect(sim(LONG, LONG + ' #a #b')).toBe(1);
  });

  it('is 1 for a truncated copy — containment, not jaccard', () => {
    expect(sim(LONG, LONG.split(' ').slice(0, 8).join(' '))).toBe(1);
  });

  it('is low for unrelated text of similar length', () => {
    const other = 'Completely different subject about gardening and the weather this weekend in the garden';
    expect(sim(LONG, other)).toBeLessThan(0.3);
  });

  /** The case that motivated replacing the character-level metric. */
  it('is low for posts sharing only a boilerplate opening', () => {
    const opening = 'Good morning everyone here is the daily update for the project ';
    const a = opening + 'we finally landed the streaming rewrite after three weeks of debugging';
    const b = opening + 'the design review is postponed until next Tuesday because of travel';
    expect(sim(a, b)).toBeLessThan(0.6);
  });

  it('is symmetric', () => {
    const a = LONG;
    const b = LONG.split(' ').slice(0, 10).join(' ');
    expect(sim(a, b)).toBe(sim(b, a));
  });

  it('is always within [0, 1]', () => {
    const samples = [LONG, '', 'a', 'a b', 'a b c', LONG + ' extra words here', '日本語のテスト です'];
    for (const a of samples) {
      for (const b of samples) {
        const s = sim(a, b);
        expect(s, `${a} / ${b}`).toBeGreaterThanOrEqual(0);
        expect(s, `${a} / ${b}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('requires an exact match for texts too short to form trigrams', () => {
    expect(sim('back online', 'back online')).toBe(1);
    expect(sim('thanks', 'thanks!')).toBe(1);        // identical after normalizing
    expect(sim('thanks', 'thanks so much')).toBe(0); // too short to compare loosely
    expect(sim('good', 'great')).toBe(0);
  });

  it('two empty texts are identical, empty vs non-empty is not', () => {
    expect(sim('', '')).toBe(1);
    expect(sim('', LONG)).toBe(0);
  });

  it('reuses profiles without changing the answer', () => {
    const a = profileText(LONG);
    const b = profileText(LONG + ' #tag');
    expect(textSimilarity(a, b)).toBe(similarity(LONG, LONG + ' #tag'));
  });
});
