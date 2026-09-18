/**
 * Pure compose-text helpers.
 *
 * Deliberately free of @atproto/api: the compose page needs a live character
 * count on every keystroke, and importing these from adapter.ts pulled the
 * lexicon bundle (~1 MB raw) into the compose route's entry chunk.
 */
import type { Platform } from '$lib/types';

/** Get the character limit for a platform */
export function getCharLimit(platform: Platform): number {
  if (platform === 'bluesky') return 300;
  return 500; // mastodon + threads
}

/** Count graphemes (what Bluesky uses for character counting) */
export function graphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  return [...text].length;
}
