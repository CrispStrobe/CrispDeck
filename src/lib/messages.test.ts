/**
 * Conversation list model.
 *
 * This previously declared its own Conversation and Message interfaces and
 * reimplemented the unread count, the sort and the time formatting, so nothing
 * here could fail when the messages page changed. It now exercises
 * $lib/messages, which that page uses.
 */
import { describe, it, expect } from 'vitest';
import {
  countUnread, sortByRecent, inferPlatformFromHandle, formatConversationTime,
  type Conversation,
} from './messages';

function convo(o: Partial<Conversation> & { id: string }): Conversation {
  return {
    platform: 'bluesky',
    participant: { handle: 'alice.bsky.social', displayName: 'Alice' },
    unread: false,
    ...o,
  } as Conversation;
}

describe('unread counting', () => {
  it('counts the conversations waiting', () => {
    expect(countUnread([
      convo({ id: '1', unread: true }),
      convo({ id: '2', unread: false }),
      convo({ id: '3', unread: true }),
    ])).toBe(2);
  });

  it('is zero when everything is read', () => {
    expect(countUnread([convo({ id: '1' }), convo({ id: '2' })])).toBe(0);
  });

  it('is zero for no conversations', () => {
    expect(countUnread([])).toBe(0);
  });
});

describe('sorting', () => {
  it('puts the most recent first', () => {
    const sorted = sortByRecent([
      convo({ id: 'old', lastDate: '2026-01-01T00:00:00.000Z' }),
      convo({ id: 'new', lastDate: '2026-01-03T00:00:00.000Z' }),
      convo({ id: 'mid', lastDate: '2026-01-02T00:00:00.000Z' }),
    ]);
    expect(sorted.map(c => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts a conversation with no date last, not first', () => {
    const sorted = sortByRecent([
      convo({ id: 'none' }),
      convo({ id: 'dated', lastDate: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(sorted.map(c => c.id)).toEqual(['dated', 'none']);
  });

  it('does not mutate the input', () => {
    const input = [
      convo({ id: 'a', lastDate: '2026-01-01T00:00:00.000Z' }),
      convo({ id: 'b', lastDate: '2026-01-02T00:00:00.000Z' }),
    ];
    sortByRecent(input);
    expect(input.map(c => c.id)).toEqual(['a', 'b']);
  });
});

describe('platform inference', () => {
  it('reads a Mastodon handle as Mastodon', () => {
    expect(inferPlatformFromHandle('@user@mastodon.social')).toBe('mastodon');
  });

  it('reads a bare domain as Bluesky', () => {
    expect(inferPlatformFromHandle('alice.bsky.social')).toBe('bluesky');
  });

  /** Pinned, not endorsed: a leading @ is enough to swing it. */
  it('misreads a Bluesky handle typed with a leading @', () => {
    expect(inferPlatformFromHandle('@alice.bsky.social')).toBe('mastodon');
  });
});

describe('conversation time', () => {
  const now = Date.parse('2026-06-15T12:00:00.000Z');

  it('shows minutes within the hour', () => {
    expect(formatConversationTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m');
  });

  it('shows hours within the day', () => {
    expect(formatConversationTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h');
  });

  it('shows a date beyond a day', () => {
    expect(formatConversationTime('2026-01-15T12:00:00.000Z', now)).toContain('Jan');
  });

  it('shows 0m for something that just arrived', () => {
    expect(formatConversationTime(new Date(now).toISOString(), now)).toBe('0m');
  });

  it('crosses from minutes to hours at exactly one hour', () => {
    expect(formatConversationTime(new Date(now - 59 * 60_000).toISOString(), now)).toBe('59m');
    expect(formatConversationTime(new Date(now - 60 * 60_000).toISOString(), now)).toBe('1h');
  });

  it('crosses from hours to a date at exactly one day', () => {
    expect(formatConversationTime(new Date(now - 23 * 3_600_000).toISOString(), now)).toBe('23h');
    expect(formatConversationTime(new Date(now - 24 * 3_600_000).toISOString(), now)).not.toMatch(/h$/);
  });
});
