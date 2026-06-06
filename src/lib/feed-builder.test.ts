/**
 * Tests for the Bluesky visual feed builder — rule engine, query compiler, persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRule, createFeedDefinition, compileQuery, describeFeed,
  getRuleLabel, getRulePlaceholder, RULE_TYPES,
  listSavedFeeds, saveFeedDefinition, deleteFeedDefinition, getFeedDefinition,
  type FeedRule, type FeedDefinition,
} from './feed-builder';

// ── Query compiler ───────────────────────────────────────────────────────────

describe('compileQuery', () => {
  it('returns empty string for no rules', () => {
    expect(compileQuery([])).toBe('');
  });

  it('compiles a keyword rule', () => {
    const rules = [createRule('keyword', 'typescript svelte')];
    expect(compileQuery(rules)).toBe('typescript svelte');
  });

  it('compiles a phrase rule with quotes', () => {
    const rules = [createRule('phrase', 'machine learning')];
    expect(compileQuery(rules)).toBe('"machine learning"');
  });

  it('compiles an exclude rule with negation', () => {
    const rules = [createRule('exclude', 'politics drama')];
    expect(compileQuery(rules)).toBe('-politics -drama');
  });

  it('compiles a language rule', () => {
    const rules = [createRule('language', 'en')];
    expect(compileQuery(rules)).toBe('lang:en');
  });

  it('compiles an author rule', () => {
    const rules = [createRule('author', 'alice.bsky.social')];
    expect(compileQuery(rules)).toBe('from:alice.bsky.social');
  });

  it('strips @ from author handles', () => {
    const rules = [createRule('author', '@alice.bsky.social')];
    expect(compileQuery(rules)).toBe('from:alice.bsky.social');
  });

  it('compiles multiple authors (comma-separated)', () => {
    const rules = [createRule('author', 'alice.bsky.social, bob.bsky.social')];
    expect(compileQuery(rules)).toBe('from:alice.bsky.social from:bob.bsky.social');
  });

  it('compiles exclude-author rule', () => {
    const rules = [createRule('exclude-author', 'spammer.bsky.social')];
    expect(compileQuery(rules)).toBe('-from:spammer.bsky.social');
  });

  it('compiles has-media rule', () => {
    const rules = [createRule('has-media', 'images')];
    expect(compileQuery(rules)).toBe('has:images');
  });

  it('compiles domain rule', () => {
    const rules = [createRule('domain', 'github.com')];
    expect(compileQuery(rules)).toBe('domain:github.com');
  });

  it('compiles mentions rule', () => {
    const rules = [createRule('mentions', '@user.bsky.social')];
    expect(compileQuery(rules)).toBe('mentions:user.bsky.social');
  });

  it('compiles since rule', () => {
    const rules = [createRule('since', '2026-01-01')];
    expect(compileQuery(rules)).toBe('since:2026-01-01');
  });

  it('compiles until rule', () => {
    const rules = [createRule('until', '2026-12-31')];
    expect(compileQuery(rules)).toBe('until:2026-12-31');
  });

  it('combines multiple rules', () => {
    const rules = [
      createRule('keyword', 'svelte'),
      createRule('language', 'en'),
      createRule('has-media', 'images'),
      createRule('exclude', 'react'),
    ];
    expect(compileQuery(rules)).toBe('svelte lang:en has:images -react');
  });

  it('skips disabled rules', () => {
    const rules = [
      createRule('keyword', 'svelte'),
      { ...createRule('language', 'en'), enabled: false },
    ];
    expect(compileQuery(rules)).toBe('svelte');
  });

  it('skips rules with empty values', () => {
    const rules = [
      createRule('keyword', 'svelte'),
      createRule('language', ''),
      createRule('author', '  '),
    ];
    expect(compileQuery(rules)).toBe('svelte');
  });
});

// ── describeFeed ─────────────────────────────────────────────────────────────

describe('describeFeed', () => {
  it('returns hint for no rules', () => {
    expect(describeFeed([])).toContain('No filters');
  });

  it('describes keyword rules', () => {
    const rules = [createRule('keyword', 'typescript')];
    expect(describeFeed(rules)).toContain('contains "typescript"');
  });

  it('describes combined rules', () => {
    const rules = [
      createRule('keyword', 'svelte'),
      createRule('language', 'en'),
    ];
    const desc = describeFeed(rules);
    expect(desc).toContain('contains "svelte"');
    expect(desc).toContain('language: en');
  });
});

// ── Rule helpers ─────────────────────────────────────────────────────────────

describe('createRule', () => {
  it('creates a rule with unique id', () => {
    const r1 = createRule('keyword', 'test');
    const r2 = createRule('keyword', 'test');
    expect(r1.id).not.toBe(r2.id);
  });

  it('creates enabled by default', () => {
    const rule = createRule('keyword');
    expect(rule.enabled).toBe(true);
    expect(rule.value).toBe('');
  });
});

describe('createFeedDefinition', () => {
  it('creates a feed with defaults', () => {
    const feed = createFeedDefinition();
    expect(feed.name).toBe('New Feed');
    expect(feed.rules).toEqual([]);
    expect(feed.id).toBeTruthy();
  });

  it('accepts a custom name', () => {
    const feed = createFeedDefinition('My Feed');
    expect(feed.name).toBe('My Feed');
  });
});

describe('getRuleLabel', () => {
  it('returns label for keyword', () => {
    expect(getRuleLabel('keyword')).toBe('Keywords');
  });

  it('returns label for all types', () => {
    for (const rt of RULE_TYPES) {
      expect(getRuleLabel(rt.type)).toBeTruthy();
    }
  });
});

describe('getRulePlaceholder', () => {
  it('returns placeholder for all types', () => {
    for (const rt of RULE_TYPES) {
      expect(getRulePlaceholder(rt.type)).toBeTruthy();
    }
  });
});

describe('RULE_TYPES', () => {
  it('has 11 rule types', () => {
    expect(RULE_TYPES).toHaveLength(11);
  });

  it('each has type, label, icon', () => {
    for (const rt of RULE_TYPES) {
      expect(rt.type).toBeTruthy();
      expect(rt.label).toBeTruthy();
      expect(rt.icon).toBeTruthy();
    }
  });
});

// ── Persistence ──────────────────────────────────────────────────────────────

describe('persistence', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('returns empty list when nothing saved', () => {
    expect(listSavedFeeds()).toEqual([]);
  });

  it('saves and retrieves a feed', () => {
    const feed = createFeedDefinition('Test Feed');
    feed.rules = [createRule('keyword', 'svelte')];
    saveFeedDefinition(feed);

    const saved = listSavedFeeds();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Test Feed');
    expect(saved[0].rules).toHaveLength(1);
  });

  it('updates an existing feed', () => {
    const feed = createFeedDefinition('Test Feed');
    saveFeedDefinition(feed);

    feed.name = 'Updated Feed';
    saveFeedDefinition(feed);

    const saved = listSavedFeeds();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Updated Feed');
  });

  it('deletes a feed', () => {
    const feed = createFeedDefinition('Delete Me');
    saveFeedDefinition(feed);
    expect(listSavedFeeds()).toHaveLength(1);

    deleteFeedDefinition(feed.id);
    expect(listSavedFeeds()).toHaveLength(0);
  });

  it('gets a feed by id', () => {
    const feed = createFeedDefinition('Find Me');
    saveFeedDefinition(feed);

    const found = getFeedDefinition(feed.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Find Me');
  });

  it('returns null for non-existent id', () => {
    expect(getFeedDefinition('nonexistent')).toBeNull();
  });

  it('handles multiple feeds', () => {
    saveFeedDefinition(createFeedDefinition('Feed A'));
    saveFeedDefinition(createFeedDefinition('Feed B'));
    saveFeedDefinition(createFeedDefinition('Feed C'));
    expect(listSavedFeeds()).toHaveLength(3);
  });
});
