import { describe, it, expect, beforeEach } from 'vitest';
import {
  listHashtagSets, saveHashtagSet, updateHashtagSet,
  deleteHashtagSet, formatHashtagSet,
} from './hashtag-bank';

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

describe('hashtag-bank', () => {
  it('returns empty array when no sets saved', () => {
    expect(listHashtagSets()).toEqual([]);
  });

  it('saves and lists a hashtag set', () => {
    const set = saveHashtagSet({ name: 'AI', hashtags: ['#AI', '#LLM', '#MachineLearning'] });
    expect(set.id).toBeTruthy();
    expect(set.name).toBe('AI');
    expect(set.hashtags).toEqual(['#AI', '#LLM', '#MachineLearning']);
    expect(listHashtagSets()).toHaveLength(1);
  });

  it('auto-prefixes # on hashtags without it', () => {
    const set = saveHashtagSet({ name: 'Tech', hashtags: ['svelte', 'typescript', '#rust'] });
    expect(set.hashtags).toEqual(['#svelte', '#typescript', '#rust']);
  });

  it('saves multiple sets', () => {
    saveHashtagSet({ name: 'AI', hashtags: ['#AI'] });
    saveHashtagSet({ name: 'Tech', hashtags: ['#tech'] });
    expect(listHashtagSets()).toHaveLength(2);
  });

  it('generates unique IDs', () => {
    const s1 = saveHashtagSet({ name: 'A', hashtags: ['#a'] });
    const s2 = saveHashtagSet({ name: 'B', hashtags: ['#b'] });
    expect(s1.id).not.toBe(s2.id);
  });

  it('updates a hashtag set', () => {
    const set = saveHashtagSet({ name: 'AI', hashtags: ['#AI'] });
    updateHashtagSet(set.id, { hashtags: ['#AI', '#ML', '#NLP'] });
    const updated = listHashtagSets().find(s => s.id === set.id);
    expect(updated?.hashtags).toEqual(['#AI', '#ML', '#NLP']);
    expect(updated?.name).toBe('AI');
  });

  it('update auto-prefixes hashtags', () => {
    const set = saveHashtagSet({ name: 'Test', hashtags: ['#a'] });
    updateHashtagSet(set.id, { hashtags: ['b', 'c'] });
    expect(listHashtagSets()[0].hashtags).toEqual(['#b', '#c']);
  });

  it('updates name only', () => {
    const set = saveHashtagSet({ name: 'Old', hashtags: ['#x'] });
    updateHashtagSet(set.id, { name: 'New' });
    expect(listHashtagSets()[0].name).toBe('New');
    expect(listHashtagSets()[0].hashtags).toEqual(['#x']);
  });

  it('deletes a hashtag set', () => {
    const s1 = saveHashtagSet({ name: 'A', hashtags: ['#a'] });
    saveHashtagSet({ name: 'B', hashtags: ['#b'] });
    deleteHashtagSet(s1.id);
    expect(listHashtagSets()).toHaveLength(1);
    expect(listHashtagSets()[0].name).toBe('B');
  });

  it('delete non-existent is no-op', () => {
    saveHashtagSet({ name: 'A', hashtags: ['#a'] });
    deleteHashtagSet('nonexistent');
    expect(listHashtagSets()).toHaveLength(1);
  });

  it('formats set as space-separated string', () => {
    const set = saveHashtagSet({ name: 'AI', hashtags: ['#AI', '#LLM', '#ML'] });
    expect(formatHashtagSet(set)).toBe('#AI #LLM #ML');
  });

  it('formats empty set as empty string', () => {
    const set = saveHashtagSet({ name: 'Empty', hashtags: [] });
    expect(formatHashtagSet(set)).toBe('');
  });
});
