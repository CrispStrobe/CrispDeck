/**
 * Theme persistence.
 *
 * This previously asserted `localStorage.getItem('crispdeck-theme') ?? 'dark'`
 * inline — a test of localStorage and the ?? operator, which passed whatever
 * the app did with the theme. It now exercises $lib/settings, which the layout
 * reads and writes.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, setTheme, nextTheme, THEMES, type Theme } from './settings';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme persistence', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(getTheme()).toBe('dark');
  });

  it('round-trips each theme', () => {
    for (const theme of THEMES) {
      setTheme(theme);
      expect(getTheme()).toBe(theme);
    }
  });

  it('writes the key the rest of the app reads', () => {
    setTheme('oled');
    expect(localStorage.getItem('crispdeck-theme')).toBe('oled');
  });

  it('ignores a value that is not a theme', () => {
    localStorage.setItem('crispdeck-theme', 'solarized');
    expect(getTheme()).toBe('dark');
  });

  it('ignores an empty value', () => {
    localStorage.setItem('crispdeck-theme', '');
    expect(getTheme()).toBe('dark');
  });
});

describe('theme cycling', () => {
  it('goes dark -> oled -> light -> dark', () => {
    expect(nextTheme('dark')).toBe('oled');
    expect(nextTheme('oled')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });

  it('returns to the start after one full cycle', () => {
    let theme: Theme = 'dark';
    for (let i = 0; i < THEMES.length; i++) theme = nextTheme(theme);
    expect(theme).toBe('dark');
  });

  it('visits every theme exactly once per cycle', () => {
    const seen: Theme[] = [];
    let theme: Theme = 'dark';
    for (let i = 0; i < THEMES.length; i++) { seen.push(theme); theme = nextTheme(theme); }
    expect(new Set(seen).size).toBe(THEMES.length);
  });
});
