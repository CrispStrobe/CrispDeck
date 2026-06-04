/**
 * Voice command parser — maps spoken phrases to navigation/actions.
 *
 * Used by the dictation system: when the mic is active and the user
 * speaks a command phrase, it's intercepted before insertion into the
 * compose text area.
 *
 * Supports English + German command phrases. Extensible via the
 * commands map.
 */

import { goto } from '$app/navigation';

export interface VoiceCommand {
  /** Trigger phrases (lowercase, any match fires) */
  phrases: string[];
  /** Action to execute */
  action: () => void;
  /** Human-readable description */
  description: string;
}

export const commands: VoiceCommand[] = [
  // Navigation
  {
    phrases: ['go to feed', 'open feed', 'show feed', 'zum feed', 'feed öffnen'],
    action: () => goto('/feed'),
    description: 'Navigate to feed',
  },
  {
    phrases: ['go to compose', 'new post', 'write post', 'neuer beitrag', 'verfassen'],
    action: () => goto('/compose'),
    description: 'Open compose',
  },
  {
    phrases: ['go to notifications', 'show notifications', 'benachrichtigungen'],
    action: () => goto('/notifications'),
    description: 'Open notifications',
  },
  {
    phrases: ['go to messages', 'open messages', 'show messages', 'nachrichten'],
    action: () => goto('/messages'),
    description: 'Open messages',
  },
  {
    phrases: ['go to search', 'open search', 'suche', 'suchen'],
    action: () => goto('/search'),
    description: 'Open search',
  },
  {
    phrases: ['go to bookmarks', 'show bookmarks', 'lesezeichen'],
    action: () => goto('/bookmarks'),
    description: 'Open bookmarks',
  },
  {
    phrases: ['go to settings', 'open settings', 'einstellungen'],
    action: () => goto('/settings'),
    description: 'Open settings',
  },
  {
    phrases: ['go to deck', 'open deck', 'deck öffnen'],
    action: () => goto('/deck'),
    description: 'Open deck',
  },
  {
    phrases: ['go to trending', 'show trending', 'trends', 'trending'],
    action: () => goto('/trending'),
    description: 'Open trending',
  },
  {
    phrases: ['go to analytics', 'show analytics', 'analytik'],
    action: () => goto('/analytics'),
    description: 'Open analytics',
  },
  {
    phrases: ['go to archive', 'show archive', 'archiv'],
    action: () => goto('/archive'),
    description: 'Open archive',
  },
  {
    phrases: ['go home', 'go to dashboard', 'home', 'startseite', 'übersicht'],
    action: () => goto('/'),
    description: 'Go to dashboard',
  },

  // Actions
  {
    phrases: ['scroll up', 'go up', 'nach oben'],
    action: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    description: 'Scroll to top',
  },
  {
    phrases: ['scroll down', 'go down', 'nach unten'],
    action: () => window.scrollBy({ top: 500, behavior: 'smooth' }),
    description: 'Scroll down',
  },
  {
    phrases: ['go back', 'back', 'zurück'],
    action: () => history.back(),
    description: 'Go back',
  },
];

/**
 * Try to match a transcript against known voice commands.
 * Returns true if a command was matched and executed.
 */
export function tryVoiceCommand(transcript: string): boolean {
  const lower = transcript.toLowerCase().trim();
  for (const cmd of commands) {
    for (const phrase of cmd.phrases) {
      if (lower.includes(phrase)) {
        cmd.action();
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a transcript looks like it might be a command
 * (starts with "go to", "open", "show", etc.)
 */
export function looksLikeCommand(transcript: string): boolean {
  const lower = transcript.toLowerCase().trim();
  const prefixes = ['go to', 'open', 'show', 'navigate', 'scroll', 'go back',
    'zum', 'öffne', 'zeige', 'gehe zu', 'nach oben', 'nach unten', 'zurück'];
  return prefixes.some(p => lower.startsWith(p));
}
