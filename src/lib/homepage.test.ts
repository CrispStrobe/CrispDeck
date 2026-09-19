/**
 * Tests for homepage mode selector and theme toggle.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getHomeMode, setHomeMode, homeRedirectPath, HOME_MODES } from './settings';

describe('homepage mode', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to dashboard when nothing stored', () => {
    expect(getHomeMode()).toBe('dashboard');
  });

  it('round-trips each mode', () => {
    for (const mode of HOME_MODES) {
      setHomeMode(mode);
      expect(getHomeMode()).toBe(mode);
    }
  });

  it('writes the key the dashboard reads', () => {
    setHomeMode('feed');
    expect(localStorage.getItem('crispdeck-home-mode')).toBe('feed');
  });

  it('ignores a value that is not a mode', () => {
    localStorage.setItem('crispdeck-home-mode', 'somewhere-else');
    expect(getHomeMode()).toBe('dashboard');
  });

  it('dashboard mode does not redirect', () => {
    expect(homeRedirectPath('dashboard')).toBeNull();
  });

  it('feed mode redirects to /feed', () => {
    expect(homeRedirectPath('feed')).toBe('/feed');
  });

  it('deck mode redirects to /deck', () => {
    expect(homeRedirectPath('deck')).toBe('/deck');
  });

  it('redirects include the mount point', () => {
    // The Pages mirror serves the app under /<repo>/.
    expect(homeRedirectPath('feed', '/CrispDeck')).toBe('/CrispDeck/feed');
    expect(homeRedirectPath('deck', '/CrispDeck')).toBe('/CrispDeck/deck');
    expect(homeRedirectPath('dashboard', '/CrispDeck')).toBeNull();
  });
});

describe('theme integration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('theme toggle updates both localStorage and DOM', () => {
    let theme: 'dark' | 'light' = 'dark';

    // Toggle to light
    theme = 'light';
    localStorage.setItem('crispdeck-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);

    expect(localStorage.getItem('crispdeck-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // Toggle back
    theme = 'dark';
    localStorage.setItem('crispdeck-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);

    expect(localStorage.getItem('crispdeck-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('theme restores from localStorage on load', () => {
    localStorage.setItem('crispdeck-theme', 'light');
    const saved = localStorage.getItem('crispdeck-theme') as 'dark' | 'light';
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('no saved theme means dark (default)', () => {
    const saved = localStorage.getItem('crispdeck-theme');
    expect(saved).toBeNull();
    // Default: no data-theme attribute = :root styles = dark
  });
});

describe('about page license loading', () => {
  it('handles empty licenses.json gracefully', () => {
    const raw = { generatedAt: '2026-01-01', counts: { frontend: 0, backend: 0, total: 0 }, licenses: [] };
    expect(Array.isArray(raw.licenses)).toBe(true);
    expect(raw.licenses.length).toBe(0);
  });

  it('handles legacy array format', () => {
    const raw = [{ name: 'svelte', version: '5.0.0', license: 'MIT', author: 'Rich Harris', link: '', source: 'Frontend' }];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw[0].name).toBe('svelte');
  });

  it('handles new object format', () => {
    const raw = {
      generatedAt: '2026-01-01',
      counts: { frontend: 1, backend: 0, total: 1 },
      licenses: [{ name: 'svelte', version: '5.0.0', license: 'MIT', author: 'Rich Harris', link: '', source: 'Frontend' }]
    };
    expect(Array.isArray(raw.licenses)).toBe(true);
    expect(raw.licenses[0].name).toBe('svelte');
    expect(raw.generatedAt).toBeTruthy();
  });

  it('license search filters correctly', () => {
    const licenses = [
      { name: 'svelte', license: 'MIT', author: 'Rich Harris' },
      { name: 'tailwindcss', license: 'MIT', author: 'Tailwind Labs' },
      { name: 'vitest', license: 'MIT', author: 'Anthony Fu' },
    ];
    const search = 'svelte';
    const filtered = licenses.filter(l =>
      l.name.toLowerCase().includes(search) ||
      l.author.toLowerCase().includes(search)
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('svelte');
  });
});
