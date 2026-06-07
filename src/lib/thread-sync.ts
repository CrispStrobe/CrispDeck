/**
 * Cross-network thread sync — post a thread on one platform,
 * auto-create the same thread on other platforms with optimized formatting.
 *
 * Uses the existing crosspostThread infrastructure but adds:
 * - Thread detection from existing posts (e.g., "sync this Bluesky thread to Mastodon")
 * - Platform-specific formatting (mentions, links, char limits)
 * - Reply chain reconstruction
 */

import { splitForPlatform } from './compose/thread';
import type { Platform, UnifiedPost } from './types';

export interface ThreadSyncPlan {
  sourcePlatform: Platform;
  sourcePosts: UnifiedPost[];
  targets: Array<{
    platform: Platform;
    parts: string[];
    charLimit: number;
    needsResplit: boolean;
  }>;
}

/**
 * Given a thread (array of posts in order), plan how to sync it to other platforms.
 * Handles re-splitting if target platform has different char limits.
 */
export function planThreadSync(
  threadPosts: UnifiedPost[],
  targetPlatforms: Platform[],
): ThreadSyncPlan {
  const sourcePlatform = threadPosts[0]?.platform ?? 'bluesky';
  const fullText = threadPosts.map(p => p.text).join('\n\n');

  const targets = targetPlatforms
    .filter(p => p !== sourcePlatform)
    .map(platform => {
      const plan = splitForPlatform(fullText, platform);
      return {
        platform,
        parts: plan.parts.map(p => p.text),
        charLimit: plan.parts[0]?.charLimit ?? 500,
        needsResplit: plan.parts.length !== threadPosts.length,
      };
    });

  return {
    sourcePlatform,
    sourcePosts: threadPosts,
    targets,
  };
}

/**
 * Extract thread text from a list of posts (removes numbering like "(1/5)").
 */
export function extractThreadText(posts: UnifiedPost[]): string {
  return posts
    .map(p => p.text.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim())
    .join('\n\n');
}

/**
 * Check if a list of posts forms a thread (reply chain from same author).
 */
export function isThread(posts: UnifiedPost[]): boolean {
  if (posts.length < 2) return false;
  const author = posts[0].author.handle;
  return posts.every(p => p.author.handle === author);
}

/**
 * Adapt text formatting for a target platform.
 * - Bluesky: @handles (no instance), 300 char limit
 * - Mastodon: @user@instance, 500 char limit, can include HTML-safe links
 * - Threads: plain text, 500 char limit
 */
export function adaptTextForPlatform(text: string, targetPlatform: Platform): string {
  if (targetPlatform === 'threads') {
    // Threads doesn't support mentions in the same way — strip @instance parts
    return text.replace(/@(\w+)@[\w.-]+/g, '@$1');
  }
  if (targetPlatform === 'bluesky') {
    // Strip @instance suffixes for Bluesky (they resolve handles automatically)
    return text.replace(/@(\w+)@[\w.-]+/g, '@$1');
  }
  // Mastodon: keep full handles
  return text;
}
