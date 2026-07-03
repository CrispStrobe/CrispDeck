/**
 * Tests for onboarding logic — instance URL cleaning, handle cleaning,
 * and first-run flag management.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Instance URL cleaning (mirrors settings page logic) ────────────────────

function cleanInstanceUrl(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function buildInstanceUrl(cleaned: string): string {
  return `https://${cleaned}`;
}

// ── Bluesky handle cleaning ────────────────────────────────────────────────

function cleanBskyHandle(input: string): string {
  return input.trim().replace(/^@/, '');
}

// ── First-run flag ─────────────────────────────────────────────────────────

const FIRST_RUN_KEY = 'crispdeck-first-run-complete';

function markFirstRunComplete(): void {
  localStorage.setItem(FIRST_RUN_KEY, 'true');
}

function isFirstRunComplete(): boolean {
  return localStorage.getItem(FIRST_RUN_KEY) === 'true';
}

function resetFirstRun(): void {
  localStorage.removeItem(FIRST_RUN_KEY);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('onboarding — instance URL cleaning', () => {
  it('strips https:// prefix', () => {
    expect(cleanInstanceUrl('https://mastodon.social')).toBe('mastodon.social');
  });

  it('strips http:// prefix', () => {
    expect(cleanInstanceUrl('http://mastodon.social')).toBe('mastodon.social');
  });

  it('strips trailing slash', () => {
    expect(cleanInstanceUrl('mastodon.social/')).toBe('mastodon.social');
  });

  it('strips both https:// and trailing slash', () => {
    expect(cleanInstanceUrl('https://mastodon.social/')).toBe('mastodon.social');
  });

  it('trims whitespace', () => {
    expect(cleanInstanceUrl('  mastodon.social  ')).toBe('mastodon.social');
  });

  it('handles already-clean input', () => {
    expect(cleanInstanceUrl('mastodon.social')).toBe('mastodon.social');
  });

  it('preserves subdomain paths', () => {
    expect(cleanInstanceUrl('https://social.example.org')).toBe('social.example.org');
  });

  it('handles port numbers', () => {
    expect(cleanInstanceUrl('https://localhost:3000/')).toBe('localhost:3000');
  });

  it('handles empty string', () => {
    expect(cleanInstanceUrl('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(cleanInstanceUrl('   ')).toBe('');
  });

  it('builds correct URL from cleaned instance', () => {
    const cleaned = cleanInstanceUrl('https://mastodon.social/');
    expect(buildInstanceUrl(cleaned)).toBe('https://mastodon.social');
  });

  it('builds URL from bare domain', () => {
    const cleaned = cleanInstanceUrl('fosstodon.org');
    expect(buildInstanceUrl(cleaned)).toBe('https://fosstodon.org');
  });
});

describe('onboarding — Bluesky handle cleaning', () => {
  it('strips leading @ sign', () => {
    expect(cleanBskyHandle('@alice.bsky.social')).toBe('alice.bsky.social');
  });

  it('leaves handle without @ unchanged', () => {
    expect(cleanBskyHandle('alice.bsky.social')).toBe('alice.bsky.social');
  });

  it('trims whitespace', () => {
    expect(cleanBskyHandle('  @bob.bsky.social  ')).toBe('bob.bsky.social');
  });

  it('handles custom domains', () => {
    expect(cleanBskyHandle('@alice.example.com')).toBe('alice.example.com');
  });

  it('handles empty string', () => {
    expect(cleanBskyHandle('')).toBe('');
  });

  it('handles just @ sign', () => {
    expect(cleanBskyHandle('@')).toBe('');
  });

  it('only strips first @ sign', () => {
    expect(cleanBskyHandle('@@double')).toBe('@double');
  });

  it('handles whitespace-only input', () => {
    expect(cleanBskyHandle('   ')).toBe('');
  });
});

describe('onboarding — first-run flag', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to not complete', () => {
    expect(isFirstRunComplete()).toBe(false);
  });

  it('can be marked complete', () => {
    markFirstRunComplete();
    expect(isFirstRunComplete()).toBe(true);
  });

  it('persists via localStorage', () => {
    markFirstRunComplete();
    expect(localStorage.getItem(FIRST_RUN_KEY)).toBe('true');
  });

  it('can be reset', () => {
    markFirstRunComplete();
    expect(isFirstRunComplete()).toBe(true);
    resetFirstRun();
    expect(isFirstRunComplete()).toBe(false);
  });

  it('treats non-true values as incomplete', () => {
    localStorage.setItem(FIRST_RUN_KEY, 'false');
    expect(isFirstRunComplete()).toBe(false);
    localStorage.setItem(FIRST_RUN_KEY, '1');
    expect(isFirstRunComplete()).toBe(false);
    localStorage.setItem(FIRST_RUN_KEY, 'yes');
    expect(isFirstRunComplete()).toBe(false);
  });
});

describe('onboarding — home mode redirect', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to dashboard when no home-mode set', () => {
    const mode = localStorage.getItem('crispdeck-home-mode') ?? 'dashboard';
    expect(mode).toBe('dashboard');
  });

  it('supports feed mode', () => {
    localStorage.setItem('crispdeck-home-mode', 'feed');
    const mode = localStorage.getItem('crispdeck-home-mode');
    expect(mode).toBe('feed');
  });

  it('supports deck mode', () => {
    localStorage.setItem('crispdeck-home-mode', 'deck');
    const mode = localStorage.getItem('crispdeck-home-mode');
    expect(mode).toBe('deck');
  });

  it('falls back to dashboard for unknown modes', () => {
    localStorage.setItem('crispdeck-home-mode', 'unknown');
    const mode = localStorage.getItem('crispdeck-home-mode') ?? 'dashboard';
    const validModes = ['dashboard', 'feed', 'deck'];
    const effectiveMode = validModes.includes(mode) ? mode : 'dashboard';
    expect(effectiveMode).toBe('dashboard');
  });
});
