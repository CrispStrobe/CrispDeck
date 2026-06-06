import { listIdentities, resolveHandle } from '$lib/db';
import type { Identity, Platform } from '$lib/types';

export interface MentionSuggestion {
  /** The text the user typed (e.g. "@alice") */
  query: string;
  /** Resolved handles per platform from identity DB */
  identityId: number | null;
  identityName: string | null;
  handles: Record<Platform, string | null>;
}

/**
 * Given a partial handle typed by the user, search the identity DB
 * for matching linked accounts and return suggestions.
 */
export async function searchMentions(query: string): Promise<MentionSuggestion[]> {
  const clean = query.replace(/^@/, '').toLowerCase();
  if (clean.length < 2) return [];

  try {
    const identities = await listIdentities();
    const results: MentionSuggestion[] = [];

    for (const identity of identities) {
      // Check if any linked handle or display name matches the query
      const matches = identity.links.some(
        link =>
          link.handle.toLowerCase().includes(clean) ||
          (link.display_name && link.display_name.toLowerCase().includes(clean))
      );

      if (matches || (identity.display_name && identity.display_name.toLowerCase().includes(clean))) {
        const handles: Record<Platform, string | null> = {
          bluesky: null,
          mastodon: null,
          threads: null,
        };

        for (const link of identity.links) {
          if (!handles[link.platform as Platform]) {
            handles[link.platform as Platform] = link.handle;
          }
        }

        results.push({
          query,
          identityId: identity.id,
          identityName: identity.display_name,
          handles,
        });
      }
    }

    return results.slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Replace identity-based mentions in text with platform-specific handles.
 *
 * The user writes `@alice` in the compose box. When posting:
 * - For Bluesky: replace with `@alice.bsky.social` (the Bluesky handle)
 * - For Mastodon: replace with `@alice@mastodon.social` (the Mastodon handle)
 *
 * This uses db_resolve_handle to look up the mapping.
 */
export async function resolveMentionsForPlatform(
  text: string,
  platform: Platform,
): Promise<string> {
  // Find all @mentions in text
  const mentionRegex = /@([\w.-]+(?:@[\w.-]+)?)/g;
  let result = text;
  const matches = [...text.matchAll(mentionRegex)];

  // Process in reverse order to preserve string indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const handle = match[1];
    const fullMatch = match[0];
    const startIndex = match.index!;

    // Skip if it's already a full Mastodon handle (user@instance)
    if (handle.includes('@') && platform === 'mastodon') continue;
    // Skip if it already looks like a full Bluesky handle (user.bsky.social)
    if (handle.includes('.') && platform === 'bluesky') continue;

    try {
      const resolved = await resolveHandle(fullMatch, platform);

      // Also try without the @
      const resolved2 = resolved ?? await resolveHandle(handle, platform);

      if (resolved2) {
        const replacement = resolved2.startsWith('@') ? resolved2 : `@${resolved2}`;
        result = result.substring(0, startIndex) + replacement + result.substring(startIndex + fullMatch.length);
      }
    } catch {
      // No mapping found, leave as-is
    }
  }

  return result;
}
