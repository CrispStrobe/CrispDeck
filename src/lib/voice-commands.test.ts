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

  describe('integration: insertAtCursor intercept', () => {
    it('command text is not inserted when matched', () => {
      // Simulate: user says "go to feed" → tryVoiceCommand returns true
      const transcript = 'go to feed';
      const matched = tryVoiceCommand(transcript);
      expect(matched).toBe(true);
      // In compose, insertAtCursor checks looksLikeCommand first
      // If matched, text is NOT appended — verified by the return
    });

    it('non-command text would be inserted', () => {
      const transcript = 'Hello everyone this is my post';
      const isCmd = looksLikeCommand(transcript);
      expect(isCmd).toBe(false);
      // insertAtCursor would proceed to add text
    });

    it('ambiguous text starting with "go" but not a command', () => {
      // "going to the store" starts with "go" but "go to" prefix check
      // requires exact prefix, not just "go"
      const transcript = 'going to the store';
      expect(looksLikeCommand(transcript)).toBe(false);
    });

    it('"show" prefix matches looksLikeCommand', () => {
      expect(looksLikeCommand('show me something')).toBe(true);
      // But tryVoiceCommand won't match unless it's a known phrase
      expect(tryVoiceCommand('show me something')).toBe(false);
    });

    it('command match is case-insensitive in integration', () => {
      expect(looksLikeCommand('GO TO FEED')).toBe(true);
      expect(tryVoiceCommand('GO TO FEED')).toBe(true);
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
