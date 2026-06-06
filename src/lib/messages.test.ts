/**
 * Tests for messages logic — conversation model, message formatting,
 * unread counting, new conversation creation.
 */
import { describe, it, expect } from 'vitest';

interface Conversation {
  id: string;
  platform: 'bluesky' | 'mastodon' | 'threads';
  participant: { handle: string; displayName?: string; avatar?: string };
  lastMessage?: string;
  lastDate?: string;
  unread: boolean;
}

interface Message {
  id: string;
  text: string;
  sender: { handle: string; displayName?: string };
  createdAt: string;
  isOurs: boolean;
}

describe('conversation model', () => {
  it('represents a Bluesky conversation', () => {
    const convo: Conversation = {
      id: 'bsky-convo-1',
      platform: 'bluesky',
      participant: { handle: 'alice.bsky.social', displayName: 'Alice' },
      lastMessage: 'Hey!',
      lastDate: '2026-06-01T12:00:00Z',
      unread: true,
    };
    expect(convo.platform).toBe('bluesky');
    expect(convo.unread).toBe(true);
  });

  it('represents a Mastodon conversation', () => {
    const convo: Conversation = {
      id: 'masto-convo-1',
      platform: 'mastodon',
      participant: { handle: '@bob@mastodon.social' },
      unread: false,
    };
    expect(convo.platform).toBe('mastodon');
    expect(convo.lastMessage).toBeUndefined();
  });
});

describe('unread count calculation', () => {
  it('counts unread conversations', () => {
    const conversations: Conversation[] = [
      { id: '1', platform: 'bluesky', participant: { handle: 'a' }, unread: true },
      { id: '2', platform: 'mastodon', participant: { handle: 'b' }, unread: false },
      { id: '3', platform: 'bluesky', participant: { handle: 'c' }, unread: true },
    ];
    const unreadCount = conversations.filter(c => c.unread).length;
    expect(unreadCount).toBe(2);
  });

  it('zero unread when all read', () => {
    const conversations: Conversation[] = [
      { id: '1', platform: 'bluesky', participant: { handle: 'a' }, unread: false },
    ];
    const unreadCount = conversations.filter(c => c.unread).length;
    expect(unreadCount).toBe(0);
  });
});

describe('conversation sorting', () => {
  it('sorts by most recent message first', () => {
    const convos: Conversation[] = [
      { id: '1', platform: 'bluesky', participant: { handle: 'a' }, lastDate: '2026-06-01T10:00:00Z', unread: false },
      { id: '2', platform: 'mastodon', participant: { handle: 'b' }, lastDate: '2026-06-01T14:00:00Z', unread: false },
      { id: '3', platform: 'bluesky', participant: { handle: 'c' }, lastDate: '2026-06-01T08:00:00Z', unread: false },
    ];
    const sorted = convos.sort((a, b) =>
      (b.lastDate ? new Date(b.lastDate).getTime() : 0) - (a.lastDate ? new Date(a.lastDate).getTime() : 0)
    );
    expect(sorted[0].id).toBe('2');
    expect(sorted[2].id).toBe('3');
  });
});

describe('message time formatting', () => {
  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  it('shows minutes for recent messages', () => {
    const recent = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatTime(recent)).toBe('5m');
  });

  it('shows hours for today messages', () => {
    const hours = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(formatTime(hours)).toBe('3h');
  });

  it('shows date for older messages', () => {
    const old = '2026-01-15T12:00:00Z';
    const formatted = formatTime(old);
    expect(formatted).toContain('Jan');
  });
});

describe('new conversation creation', () => {
  it('infers Mastodon platform from @ handle', () => {
    const handle = '@user@mastodon.social';
    const platform = handle.includes('@') ? 'mastodon' : 'bluesky';
    expect(platform).toBe('mastodon');
  });

  it('infers Bluesky platform from dot handle', () => {
    const handle = 'alice.bsky.social';
    const platform = handle.includes('@') ? 'mastodon' : 'bluesky';
    expect(platform).toBe('bluesky');
  });
});
