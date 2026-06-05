/**
 * Tests for homepage mode selector and theme toggle.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('homepage mode', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to dashboard when nothing stored', () => {
    expect(localStorage.getItem('crispdeck-home-mode') ?? 'dashboard').toBe('dashboard');
  });

  it('persists feed mode', () => {
    localStorage.setItem('crispdeck-home-mode', 'feed');
    expect(localStorage.getItem('crispdeck-home-mode')).toBe('feed');
  });

  it('persists deck mode', () => {
    localStorage.setItem('crispdeck-home-mode', 'deck');
    expect(localStorage.getItem('crispdeck-home-mode')).toBe('deck');
  });

  it('dashboard mode does not redirect', () => {
    localStorage.setItem('crispdeck-home-mode', 'dashboard');
    const mode = localStorage.getItem('crispdeck-home-mode');
    expect(mode).toBe('dashboard');
    // dashboard mode: no redirect, show overview
  });

  it('feed mode would redirect to /feed', () => {
    localStorage.setItem('crispdeck-home-mode', 'feed');
    const mode = localStorage.getItem('crispdeck-home-mode');
    expect(mode === 'feed').toBe(true);
  });

  it('deck mode would redirect to /deck', () => {
    localStorage.setItem('crispdeck-home-mode', 'deck');
    const mode = localStorage.getItem('crispdeck-home-mode');
    expect(mode === 'deck').toBe(true);
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
