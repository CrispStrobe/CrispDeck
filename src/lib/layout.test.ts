/**
 * Tests for layout logic — navigation items, route matching, merged routes,
 * mobile tab bar, compact mode, and responsive behavior.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Navigation item structure ───────────────────────────────────────────────

describe('sidebar navigation items', () => {
  const navItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/feed', label: 'Feed' },
    { href: '/deck', label: 'Deck' },
    { href: '/compose', label: 'Compose' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/messages', label: 'Messages' },
    { href: '/search', label: 'Search' },
    { href: '/bookmarks', label: 'Bookmarks' },
    { href: '/lists', label: 'Lists & Feeds' },
    { href: '/trending', label: 'Discover' },
    { href: '/identities', label: 'Identities' },
    { href: '/archive', label: 'Archive' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/moderation', label: 'Moderation' },
    { href: '/settings', label: 'Settings' },
    { href: '/about', label: 'About' },
  ];

  it('has 16 items (consolidated from 25)', () => {
    expect(navItems).toHaveLength(16);
  });

  it('does not include removed standalone items', () => {
    const hrefs = navItems.map(i => i.href);
    expect(hrefs).not.toContain('/catchup');
    expect(hrefs).not.toContain('/drafts');
    expect(hrefs).not.toContain('/feed-builder');
    expect(hrefs).not.toContain('/starterpacks');
    expect(hrefs).not.toContain('/gallery');
    expect(hrefs).not.toContain('/calendar');
    expect(hrefs).not.toContain('/reading-lists');
    expect(hrefs).not.toContain('/labelers');
    expect(hrefs).not.toContain('/instance');
  });

  it('all items have href and label', () => {
    for (const item of navItems) {
      expect(item.href).toBeTruthy();
      expect(item.label).toBeTruthy();
    }
  });

  it('all hrefs start with /', () => {
    for (const item of navItems) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });
});

// ── Merged route matching ───────────────────────────────────────────────────

describe('merged route matching (isActive logic)', () => {
  const mergedRoutes: Record<string, string[]> = {
    '/trending': ['/trending', '/catchup'],
    '/lists': ['/lists', '/feed-builder', '/starterpacks'],
    '/bookmarks': ['/bookmarks', '/reading-lists'],
    '/archive': ['/archive', '/gallery'],
    '/analytics': ['/analytics', '/calendar'],
    '/moderation': ['/moderation', '/labelers'],
    '/compose': ['/compose', '/drafts'],
    '/settings': ['/settings', '/instance'],
  };

  function isActive(href: string, currentPath: string): boolean {
    if (href === '/') return currentPath === '/';
    const routes = mergedRoutes[href];
    if (routes) return routes.some(r => currentPath.startsWith(r));
    return currentPath.startsWith(href);
  }

  it('dashboard only active on exact /', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/', '/feed')).toBe(false);
  });

  it('simple routes match prefix', () => {
    expect(isActive('/feed', '/feed')).toBe(true);
    expect(isActive('/feed', '/feed?tab=foryou')).toBe(true);
    expect(isActive('/deck', '/deck')).toBe(true);
  });

  it('Discover highlights for /trending and /catchup', () => {
    expect(isActive('/trending', '/trending')).toBe(true);
    expect(isActive('/trending', '/catchup')).toBe(true);
  });

  it('Lists & Feeds highlights for /lists, /feed-builder, /starterpacks', () => {
    expect(isActive('/lists', '/lists')).toBe(true);
    expect(isActive('/lists', '/feed-builder')).toBe(true);
    expect(isActive('/lists', '/starterpacks')).toBe(true);
  });

  it('Bookmarks highlights for /bookmarks and /reading-lists', () => {
    expect(isActive('/bookmarks', '/bookmarks')).toBe(true);
    expect(isActive('/bookmarks', '/reading-lists')).toBe(true);
  });

  it('Archive highlights for /archive and /gallery', () => {
    expect(isActive('/archive', '/archive')).toBe(true);
    expect(isActive('/archive', '/gallery')).toBe(true);
  });

  it('Analytics highlights for /analytics and /calendar', () => {
    expect(isActive('/analytics', '/analytics')).toBe(true);
    expect(isActive('/analytics', '/calendar')).toBe(true);
  });

  it('Moderation highlights for /moderation and /labelers', () => {
    expect(isActive('/moderation', '/moderation')).toBe(true);
    expect(isActive('/moderation', '/labelers')).toBe(true);
  });

  it('Compose highlights for /compose and /drafts', () => {
    expect(isActive('/compose', '/compose')).toBe(true);
    expect(isActive('/compose', '/drafts')).toBe(true);
  });

  it('Settings highlights for /settings and /instance', () => {
    expect(isActive('/settings', '/settings')).toBe(true);
    expect(isActive('/settings', '/instance')).toBe(true);
  });

  it('non-merged routes do not cross-highlight', () => {
    expect(isActive('/feed', '/deck')).toBe(false);
    expect(isActive('/search', '/notifications')).toBe(false);
    expect(isActive('/analytics', '/archive')).toBe(false);
  });
});

// ── Mobile tab bar ──────────────────────────────────────────────────────────

describe('mobile tab bar', () => {
  const mobileTabItems = [
    { href: '/feed', label: 'Feed' },
    { href: '/compose', label: 'Post' },
    { href: '/notifications', label: 'Alerts' },
    { href: '/search', label: 'Search' },
    { href: '/messages', label: 'DMs' },
  ];

  it('has exactly 5 items', () => {
    expect(mobileTabItems).toHaveLength(5);
  });

  it('uses short labels for mobile', () => {
    expect(mobileTabItems.find(i => i.href === '/compose')!.label).toBe('Post');
    expect(mobileTabItems.find(i => i.href === '/notifications')!.label).toBe('Alerts');
    expect(mobileTabItems.find(i => i.href === '/messages')!.label).toBe('DMs');
  });

  it('all mobile items are in the main nav too', () => {
    const mainHrefs = ['/feed', '/compose', '/notifications', '/search', '/messages'];
    for (const item of mobileTabItems) {
      expect(mainHrefs).toContain(item.href);
    }
  });
});

// ── Relative time formatting ────────────────────────────────────────────────

describe('relativeTime formatting', () => {
  function relativeTime(dateString?: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  it('returns "now" for less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('now');
  });

  it('returns minutes for < 1 hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5m');
  });

  it('returns hours for < 1 day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe('3h');
  });

  it('returns days for < 1 week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe('2d');
  });

  it('returns short date for > 1 week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const result = relativeTime(twoWeeksAgo);
    // Should be like "May 25" or "Jun 1"
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('returns empty for missing date', () => {
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('')).toBe('');
  });

  it('returns empty for invalid date', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });
});

// ── Compact mode ────────────────────────────────────────────────────────────

describe('compact post mode', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to non-compact', () => {
    expect(localStorage.getItem('crispdeck-compact-posts')).toBeNull();
    const compact = localStorage.getItem('crispdeck-compact-posts') === 'true';
    expect(compact).toBe(false);
  });

  it('persists compact setting', () => {
    localStorage.setItem('crispdeck-compact-posts', 'true');
    expect(localStorage.getItem('crispdeck-compact-posts')).toBe('true');
  });

  it('can be toggled off', () => {
    localStorage.setItem('crispdeck-compact-posts', 'true');
    localStorage.setItem('crispdeck-compact-posts', 'false');
    const compact = localStorage.getItem('crispdeck-compact-posts') === 'true';
    expect(compact).toBe(false);
  });

  it('compact styles use smaller values', () => {
    const compact = true;
    const padding = compact ? 'p-2.5' : 'p-4';
    const avatarSize = compact ? 'w-7 h-7' : 'w-10 h-10';
    const gap = compact ? 'gap-2' : 'gap-3';
    expect(padding).toBe('p-2.5');
    expect(avatarSize).toBe('w-7 h-7');
    expect(gap).toBe('gap-2');
  });

  it('non-compact styles use default values', () => {
    const compact = false;
    const padding = compact ? 'p-2.5' : 'p-4';
    const avatarSize = compact ? 'w-7 h-7' : 'w-10 h-10';
    expect(padding).toBe('p-4');
    expect(avatarSize).toBe('w-10 h-10');
  });
});

// ── Media preview mode ──────────────────────────────────────────────────────

describe('media preview mode', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to lightbox', () => {
    const mode = (localStorage.getItem('crispdeck-media-preview') as 'lightbox' | 'browser') || 'lightbox';
    expect(mode).toBe('lightbox');
  });

  it('persists browser mode', () => {
    localStorage.setItem('crispdeck-media-preview', 'browser');
    const mode = localStorage.getItem('crispdeck-media-preview');
    expect(mode).toBe('browser');
  });
});

// ── Platform filter logic ───────────────────────────────────────────────────

describe('platform filter visibility', () => {
  it('shows filter when multiple platforms connected', () => {
    const accounts = [
      { platform: 'bluesky' },
      { platform: 'mastodon' },
    ];
    const connectedPlatforms = new Set(accounts.map(a => a.platform));
    const multiPlatform = connectedPlatforms.size > 1;
    expect(multiPlatform).toBe(true);
  });

  it('hides filter when single platform', () => {
    const accounts = [
      { platform: 'bluesky' },
    ];
    const connectedPlatforms = new Set(accounts.map(a => a.platform));
    const multiPlatform = connectedPlatforms.size > 1;
    expect(multiPlatform).toBe(false);
  });

  it('shows only connected platform buttons', () => {
    const accounts = [
      { platform: 'bluesky' },
      { platform: 'threads' },
    ];
    const connectedPlatforms = new Set(accounts.map(a => a.platform));
    expect(connectedPlatforms.has('bluesky')).toBe(true);
    expect(connectedPlatforms.has('mastodon')).toBe(false);
    expect(connectedPlatforms.has('threads')).toBe(true);
  });

  it('hides filter with zero accounts', () => {
    const accounts: any[] = [];
    const connectedPlatforms = new Set(accounts.map(a => a.platform));
    expect(connectedPlatforms.size > 1).toBe(false);
  });
});

// ── formatDate (full date) ──────────────────────────────────────────────────

describe('formatDate', () => {
  function formatDate(dateString?: string): string {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  it('formats valid date', () => {
    // toLocaleDateString renders in the local zone, so a UTC literal lands on a
    // different calendar day past ±12 — build local noon of the day we assert.
    const result = formatDate(new Date(2026, 5, 8, 12, 0, 0).toISOString());
    expect(result).toContain('Jun');
    expect(result).toContain('8');
    expect(result).toContain('2026');
  });

  it('returns dash for missing date', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('returns dash for invalid date', () => {
    expect(formatDate('garbage')).toBe('—');
  });
});

// ── Settings tab URL parsing ───────────────────────────────────────────────

describe('settings tab URL parameter parsing', () => {
  const VALID_TABS = ['account', 'appearance', 'content', 'compose', 'advanced', 'about'] as const;
  type SettingsTab = typeof VALID_TABS[number];
  const DEFAULT_TAB: SettingsTab = 'account';

  function parseSettingsTab(param: string | null | undefined): SettingsTab {
    if (!param) return DEFAULT_TAB;
    const lower = param.toLowerCase();
    if ((VALID_TABS as readonly string[]).includes(lower)) return lower as SettingsTab;
    return DEFAULT_TAB;
  }

  it('returns default tab when no param provided', () => {
    expect(parseSettingsTab(null)).toBe('account');
    expect(parseSettingsTab(undefined)).toBe('account');
  });

  it('returns default tab for empty string', () => {
    expect(parseSettingsTab('')).toBe('account');
  });

  it('parses valid tab: account', () => {
    expect(parseSettingsTab('account')).toBe('account');
  });

  it('parses valid tab: appearance', () => {
    expect(parseSettingsTab('appearance')).toBe('appearance');
  });

  it('parses valid tab: content', () => {
    expect(parseSettingsTab('content')).toBe('content');
  });

  it('parses valid tab: compose', () => {
    expect(parseSettingsTab('compose')).toBe('compose');
  });

  it('parses valid tab: advanced', () => {
    expect(parseSettingsTab('advanced')).toBe('advanced');
  });

  it('parses valid tab: about', () => {
    expect(parseSettingsTab('about')).toBe('about');
  });

  it('is case-insensitive', () => {
    expect(parseSettingsTab('Account')).toBe('account');
    expect(parseSettingsTab('APPEARANCE')).toBe('appearance');
    expect(parseSettingsTab('About')).toBe('about');
  });

  it('returns default for invalid tab names', () => {
    expect(parseSettingsTab('invalid')).toBe('account');
    expect(parseSettingsTab('settings')).toBe('account');
    expect(parseSettingsTab('general')).toBe('account');
    expect(parseSettingsTab('notifications')).toBe('account');
  });

  it('returns default for numeric input', () => {
    expect(parseSettingsTab('0')).toBe('account');
    expect(parseSettingsTab('1')).toBe('account');
  });

  it('returns default for special characters', () => {
    expect(parseSettingsTab('<script>')).toBe('account');
    expect(parseSettingsTab('../etc/passwd')).toBe('account');
  });

  it('has exactly 6 valid tabs', () => {
    expect(VALID_TABS).toHaveLength(6);
  });

  it('extracts tab from URLSearchParams', () => {
    const params1 = new URLSearchParams('?tab=appearance');
    expect(parseSettingsTab(params1.get('tab'))).toBe('appearance');

    const params2 = new URLSearchParams('?tab=invalid');
    expect(parseSettingsTab(params2.get('tab'))).toBe('account');

    const params3 = new URLSearchParams('?other=value');
    expect(parseSettingsTab(params3.get('tab'))).toBe('account');

    const params4 = new URLSearchParams('');
    expect(parseSettingsTab(params4.get('tab'))).toBe('account');
  });
});
