/**
 * Tests for mention resolution — regex parsing, handle resolution logic.
 * Mocks db imports since we can't access IndexedDB in tests.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the db module before importing mentions
vi.mock('$lib/db', () => ({
  listIdentities: vi.fn().mockResolvedValue([]),
  resolveHandle: vi.fn().mockResolvedValue(null),
}));

import { searchMentions, resolveMentionsForPlatform, type MentionSuggestion } from './mentions';
import { listIdentities, resolveHandle } from '$lib/db';

describe('searchMentions', () => {
  it('returns empty for short queries', async () => {
    expect(await searchMentions('@a')).toEqual([]);
    expect(await searchMentions('x')).toEqual([]);
  });

  it('strips leading @ from query', async () => {
    vi.mocked(listIdentities).mockResolvedValue([
      {
        id: 1,
        display_name: 'Alice',
        links: [{ handle: 'alice.bsky.social', platform: 'bluesky', display_name: 'Alice' }],
      } as any,
    ]);

    const results = await searchMentions('@alice');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].handles.bluesky).toBe('alice.bsky.social');
  });

  it('matches on handle substring', async () => {
    vi.mocked(listIdentities).mockResolvedValue([
      {
        id: 1, display_name: null,
        links: [
          { handle: 'alice.bsky.social', platform: 'bluesky', display_name: null },
          { handle: 'alice@mastodon.social', platform: 'mastodon', display_name: null },
        ],
      } as any,
    ]);

    const results = await searchMentions('ali');
    expect(results).toHaveLength(1);
    expect(results[0].handles.bluesky).toBe('alice.bsky.social');
    expect(results[0].handles.mastodon).toBe('alice@mastodon.social');
  });

  it('returns max 8 results', async () => {
    const identities = Array.from({ length: 20 }, (_, i) => ({
      id: i, display_name: `User ${i}`,
      links: [{ handle: `user${i}.bsky.social`, platform: 'bluesky', display_name: `User ${i}` }],
    }));
    vi.mocked(listIdentities).mockResolvedValue(identities as any);

    const results = await searchMentions('user');
    expect(results.length).toBeLessThanOrEqual(8);
  });

  it('handles empty identity db gracefully', async () => {
    vi.mocked(listIdentities).mockResolvedValue([]);
    const results = await searchMentions('alice');
    expect(results).toEqual([]);
  });

  it('handles db error gracefully', async () => {
    vi.mocked(listIdentities).mockRejectedValue(new Error('DB down'));
    const results = await searchMentions('alice');
    expect(results).toEqual([]);
  });
});

describe('resolveMentionsForPlatform', () => {
  it('passes through text with no mentions', async () => {
    const result = await resolveMentionsForPlatform('Hello world!', 'bluesky');
    expect(result).toBe('Hello world!');
  });

  it('skips already-qualified Mastodon handles', async () => {
    const text = 'Hello @alice@mastodon.social';
    const result = await resolveMentionsForPlatform(text, 'mastodon');
    expect(result).toBe(text); // unchanged
  });

  it('skips already-qualified Bluesky handles', async () => {
    const text = 'Hello @alice.bsky.social';
    const result = await resolveMentionsForPlatform(text, 'bluesky');
    expect(result).toBe(text); // unchanged
  });

  it('resolves a simple mention via resolveHandle', async () => {
    vi.mocked(resolveHandle).mockResolvedValue('alice.bsky.social');
    const result = await resolveMentionsForPlatform('Hey @alice', 'bluesky');
    expect(result).toBe('Hey @alice.bsky.social');
  });

  it('handles unresolved mentions gracefully', async () => {
    vi.mocked(resolveHandle).mockResolvedValue(null);
    const result = await resolveMentionsForPlatform('Hey @unknown', 'bluesky');
    expect(result).toBe('Hey @unknown');
  });

  it('resolves multiple mentions', async () => {
    vi.mocked(resolveHandle)
      .mockResolvedValueOnce('alice.bsky.social')
      .mockResolvedValueOnce(null) // second call for bare handle
      .mockResolvedValueOnce('bob.bsky.social')
      .mockResolvedValueOnce(null);
    const result = await resolveMentionsForPlatform('Hey @alice and @bob', 'bluesky');
    expect(result).toContain('alice.bsky.social');
    expect(result).toContain('bob.bsky.social');
  });
});

describe('MentionSuggestion type', () => {
  it('structures suggestion correctly', () => {
    const suggestion: MentionSuggestion = {
      query: '@alice',
      identityId: 1,
      identityName: 'Alice',
      handles: { bluesky: 'alice.bsky.social', mastodon: 'alice@mastodon.social', threads: null },
    };
    expect(suggestion.handles.bluesky).toBe('alice.bsky.social');
    expect(suggestion.handles.threads).toBeNull();
  });
});
