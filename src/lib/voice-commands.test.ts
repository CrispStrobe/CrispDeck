/**
 * Tests for voice command parsing and matching.
 */
import { describe, it, expect, vi } from 'vitest';
import { tryVoiceCommand, looksLikeCommand, commands } from './voice-commands';

// Mock $app/navigation since it's a SvelteKit module
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

describe('voice commands', () => {
  describe('command registry', () => {
    it('has at least 10 commands', () => {
      expect(commands.length).toBeGreaterThanOrEqual(10);
    });

    it('every command has phrases, action, and description', () => {
      for (const cmd of commands) {
        expect(cmd.phrases.length).toBeGreaterThan(0);
        expect(typeof cmd.action).toBe('function');
        expect(cmd.description).toBeTruthy();
      }
    });

    it('all phrases are lowercase', () => {
      for (const cmd of commands) {
        for (const phrase of cmd.phrases) {
          expect(phrase).toBe(phrase.toLowerCase());
        }
      }
    });

    it('no duplicate phrases across commands', () => {
      const allPhrases = commands.flatMap(c => c.phrases);
      const unique = new Set(allPhrases);
      expect(unique.size).toBe(allPhrases.length);
    });
  });

  describe('tryVoiceCommand', () => {
    it('matches "go to feed"', () => {
      const result = tryVoiceCommand('go to feed');
      expect(result).toBe(true);
    });

    it('matches "new post"', () => {
      const result = tryVoiceCommand('new post');
      expect(result).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(tryVoiceCommand('Go To Feed')).toBe(true);
      expect(tryVoiceCommand('NEW POST')).toBe(true);
    });

    it('matches German phrases', () => {
      expect(tryVoiceCommand('zum feed')).toBe(true);
      expect(tryVoiceCommand('neuer beitrag')).toBe(true);
      expect(tryVoiceCommand('einstellungen')).toBe(true);
    });

    it('returns false for unknown phrases', () => {
      expect(tryVoiceCommand('make me a sandwich')).toBe(false);
      expect(tryVoiceCommand('hello world')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(tryVoiceCommand('')).toBe(false);
    });

    it('matches partial transcript containing command', () => {
      expect(tryVoiceCommand('please go to feed now')).toBe(true);
    });
  });

  describe('looksLikeCommand', () => {
    it('detects "go to" prefix', () => {
      expect(looksLikeCommand('go to something')).toBe(true);
    });

    it('detects "open" prefix', () => {
      expect(looksLikeCommand('open settings')).toBe(true);
    });

    it('detects "show" prefix', () => {
      expect(looksLikeCommand('show bookmarks')).toBe(true);
    });

    it('detects German prefixes', () => {
      expect(looksLikeCommand('gehe zu feed')).toBe(true);
      expect(looksLikeCommand('öffne nachrichten')).toBe(true);
      expect(looksLikeCommand('nach oben')).toBe(true);
    });

    it('returns false for non-command text', () => {
      expect(looksLikeCommand('hello world')).toBe(false);
      expect(looksLikeCommand('this is a post')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(looksLikeCommand('')).toBe(false);
    });
  });
});
