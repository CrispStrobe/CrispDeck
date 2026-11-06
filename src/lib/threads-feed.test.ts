import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildThreadsFeed, importThreadsProfiles, parseKeywords, parseProfiles, saveThreadsSources, getThreadsSources } from './threads-feed';
import type { ThreadsClient, ThreadsPost } from './api/threads';

describe('Threads feed sources', () => {
  beforeEach(() => localStorage.clear());
  it('parses unique usernames and phrases and saves them per account', () => {
    const value = { profiles: parseProfiles('@Meta\nmeta\n@threads'), keywords: parseKeywords('climate change\nreligion\nreligion') };
    expect(value).toEqual({ profiles: ['meta', 'threads'], keywords: ['climate change', 'religion'] });
    expect(saveThreadsSources('alice', value)).toBe(true);
    expect(getThreadsSources('alice')).toEqual(value);
    expect(getThreadsSources('bob').profiles).toEqual([]);
  });
  it('imports usernames from a Meta JSON export and rejects unrelated JSON', () => {
    expect(importThreadsProfiles(JSON.stringify({ relationships_following: [{ string_list_data: [{ value: 'Alice' }, { value: 'bob' }] }] }))).toEqual(['alice', 'bob']);
    expect(() => importThreadsProfiles('{"name":"alice"}')).toThrow('No usernames');
  });
  it('combines sources, removes duplicate posts, caches requests and reports failures', async () => {
    const post = (id: string): ThreadsPost => ({ id, text: id });
    const client = { getOwnPosts: vi.fn().mockResolvedValue([post('own')]), getAllMentions: vi.fn().mockResolvedValue([post('mention')]), getUserPosts: vi.fn().mockResolvedValue([post('profile'), post('own')]), keywordSearch: vi.fn().mockRejectedValue(new Error('permission denied')) } as unknown as ThreadsClient;
    const sources = { profiles: ['test-profile'], keywords: ['test phrase'] };
    const result = await buildThreadsFeed(client, 'cache-test', sources, 20);
    expect(result.posts.map(p => p.id)).toEqual(['own', 'mention', 'profile']);
    expect(result.failures).toEqual(['“test phrase”']);
    await buildThreadsFeed(client, 'cache-test', sources, 20);
    expect(client.getUserPosts).toHaveBeenCalledTimes(1);
    expect(client.keywordSearch).toHaveBeenCalledTimes(1);
  });
});
