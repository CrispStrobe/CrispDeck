/**
 * Column-level mute filters.
 * Applied on top of global mute rules, scoped to individual columns.
 */

import type { UnifiedPost } from '$lib/types';

/**
 * Filter posts using column-specific mute words.
 * Supports plain keywords and /regex/ patterns (same as global mute words).
 */
export function applyColumnMuteFilter(posts: UnifiedPost[], muteWords: string[]): UnifiedPost[] {
  if (!muteWords || muteWords.length === 0) return posts;

  const matchers: ((text: string) => boolean)[] = muteWords.map(word => {
    const regexMatch = word.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        const regex = new RegExp(regexMatch[1], regexMatch[2] || 'i');
        return (text: string) => regex.test(text);
      } catch {
        return () => false;
      }
    }
    const lower = word.toLowerCase();
    return (text: string) => text.toLowerCase().includes(lower);
  });

  return posts.filter(post => {
    const text = post.text;
    return !matchers.some(match => match(text));
  });
}
