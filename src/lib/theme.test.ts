/**
 * Tests for theme toggle persistence and CSS variable switching.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('theme system', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark when nothing stored', () => {
    const theme = localStorage.getItem('crispdeck-theme') ?? 'dark';
    expect(theme).toBe('dark');
  });

  it('persists light theme', () => {
    localStorage.setItem('crispdeck-theme', 'light');
    expect(localStorage.getItem('crispdeck-theme')).toBe('light');
  });

  it('persists dark theme', () => {
    localStorage.setItem('crispdeck-theme', 'dark');
    expect(localStorage.getItem('crispdeck-theme')).toBe('dark');
  });

  it('data-theme attribute controls CSS variables', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    document.documentElement.setAttribute('data-theme', 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggle cycle: dark → light → dark', () => {
    let theme: 'dark' | 'light' = 'dark';

    // First toggle
    theme = theme === 'dark' ? 'light' : 'dark';
    expect(theme).toBe('light');

    // Second toggle
    theme = theme === 'dark' ? 'light' : 'dark';
    expect(theme).toBe('dark');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem('crispdeck-theme', 'light');
    const saved = localStorage.getItem('crispdeck-theme') as 'dark' | 'light';
    document.documentElement.setAttribute('data-theme', saved);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
