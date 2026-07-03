/**
 * Tests for HTML sanitization and DOMPurify preloading.
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeHtml, preloadSanitizer } from './sanitize';

describe('sanitize', () => {
  describe('sanitizeHtml', () => {
    it('strips HTML tags in fallback mode (before DOMPurify loads)', () => {
      // In Node/test environment, DOMPurify won't load — falls back to tag stripping
      const result = sanitizeHtml('<p>Hello <b>bold</b> world</p>');
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('<b>');
      expect(result).toContain('Hello');
      expect(result).toContain('bold');
      expect(result).toContain('world');
    });

    it('handles empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('returns plain text unchanged', () => {
      expect(sanitizeHtml('Hello world')).toBe('Hello world');
    });

    it('strips dangerous attributes', () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
    });

    it('handles nested tags', () => {
      const result = sanitizeHtml('<div><p>Nested <b>bold</b></p></div>');
      expect(result).toContain('Nested');
      expect(result).toContain('bold');
    });
  });

  describe('preloadSanitizer', () => {
    it('is a callable function', () => {
      expect(typeof preloadSanitizer).toBe('function');
    });

    it('does not throw when called', () => {
      expect(() => preloadSanitizer()).not.toThrow();
    });

    it('can be called multiple times safely (idempotent)', () => {
      preloadSanitizer();
      preloadSanitizer();
      preloadSanitizer();
      // No error = success
    });
  });
});
