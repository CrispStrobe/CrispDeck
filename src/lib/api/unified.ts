import type { AppBskyFeedDefs } from '@atproto/api';
import type { mastodon } from 'masto';

import type { UnifiedPost, FeedItem, CrosspostGroup, Filters, Platform } from '$lib/types';
import type { ThreadsPost } from '$lib/api/threads';
import { fingerprint, similarity, usedWordFallback, ShingleIndex } from '$lib/api/near-duplicate';

/**
 * Whether a feed item's `reason` is a repost.
 *
 * A local guard rather than AppBskyFeedDefs.isReasonRepost, which is the only
 * value this module took from @atproto/api. That single value import pulled
 * the whole SDK -- 221 KB gzipped with zod, multiformats and jose behind it --
 * into the static closure of every route that renders a post, for one $type
 * string comparison. The type import above costs nothing at runtime.
 *
 * The discriminant is part of the lexicon and is what the SDK checks too, so
 * this cannot drift without the wire format itself changing.
 */
const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost';

function isReasonRepost(v: unknown): v is AppBskyFeedDefs.ReasonRepost {
  return !!v && typeof v === 'object' && (v as { $type?: unknown }).$type === REASON_REPOST;
}

type PlatformPost = AppBskyFeedDefs.FeedViewPost | mastodon.v1.Status | ThreadsPost;

// Cached HTML stripping — avoids regex per-post on re-renders
// Key includes content length as a cheap fingerprint to avoid stale cache
// when the same URI has different content (e.g. edited posts)
const _htmlCleanCache = new Map<string, string>();
function stripHtmlCached(uri: string, html: string): string {
  const key = `${uri}:${html.length}`;
  let clean = _htmlCleanCache.get(key);
  if (!clean) {
    clean = html.replace(/<[^>]*>?/gm, '');
    _htmlCleanCache.set(key, clean);
    // Cap cache size to prevent memory leak
    if (_htmlCleanCache.size > 2000) {
      const first = _htmlCleanCache.keys().next().value;
      if (first) _htmlCleanCache.delete(first);
    }
  }
  return clean;
}

// Cached Mastodon handle normalization — avoids URL parsing per-post
const _handleCache = new Map<string, string>();
function normalizeMastoHandle(acct: string, accountUrl: string): string {
  let handle = _handleCache.get(acct);
  if (!handle) {
    if (acct.includes('@')) {
      handle = `@${acct}`;
    } else {
      try {
        handle = `@${acct}@${new URL(accountUrl).hostname}`;
      } catch {
        handle = `@${acct}`;
      }
    }
    _handleCache.set(acct, handle);
  }
  return handle;
}

export function normalizePost(post: PlatformPost, platform: Platform): UnifiedPost {
  if (platform === 'threads') {
    const item = post as ThreadsPost;
    const isRepost = item.media_type === 'REPOST_FACADE';
    // Use reposted_post content if available, otherwise the post itself
    const target = (isRepost && item.reposted_post) ? item.reposted_post : item;
    // Build media array matching Mastodon attachment format for Post.svelte rendering
    const media: any[] = [];
    if (target.media_url && target.media_type && target.media_type !== 'TEXT_POST') {
      media.push({
        type: target.media_type === 'VIDEO' ? 'video' : 'image',
        url: target.media_url,
        previewUrl: target.thumbnail_url ?? target.media_url,
        description: '',
      });
    }
    return {
      uri: item.permalink ?? `threads://${item.id}`,
      text: target.text ?? '',
      author: {
        handle: target.username ? `@${target.username}` : (item.username ? `@${item.username}` : '?'),
        displayName: target.username ?? item.username,
        avatar: undefined,
      },
      createdAt: item.timestamp ?? new Date().toISOString(),
      platform: 'threads',
      replyCount: 0,
      repostCount: 0,
      likeCount: 0,
      isRepost,
      repostAuthor: isRepost ? { handle: item.username ? `@${item.username}` : '?', displayName: item.username } : undefined,
      embeds: media.length > 0 ? media : undefined,
      raw: item,
    };
  } else if (platform === 'bluesky') {
    const item = post as AppBskyFeedDefs.FeedViewPost;
    const p = item.post;
    const record = p.record as {
      text: string;
      createdAt: string;
      reply?: { parent: { uri: string } };
    };
    // For reposts: use the repost time (when it appeared in feed), not original post time
    const feedDate = isReasonRepost(item.reason)
      ? (item.reason.indexedAt ?? record.createdAt)
      : record.createdAt;

    return {
      uri: p.uri,
      text: record.text,
      author: {
        handle: p.author.handle,
        displayName: p.author.displayName,
        avatar: p.author.avatar,
      },
      createdAt: feedDate,
      platform: 'bluesky',
      replyCount: p.replyCount,
      repostCount: p.repostCount,
      likeCount: p.likeCount,
      replyParentUri: record.reply?.parent.uri,
      isRepost: isReasonRepost(item.reason),
      repostAuthor: isReasonRepost(item.reason)
        ? { handle: item.reason.by.handle, displayName: item.reason.by.displayName }
        : undefined,
      embeds: p.embed,
      raw: item,
    };
  } else {
    const item = post as mastodon.v1.Status;
    const target = item.reblog ?? item;
    // For reblogs: use the reblog time (item.createdAt), not original post time (target.createdAt)
    // Handle both camelCase (masto library) and snake_case (raw fetch) property names
    const feedDate = item.reblog
      ? (item.createdAt ?? (item as any).created_at)
      : (target.createdAt ?? (target as any).created_at);
    return {
      uri: target.uri,
      text: stripHtmlCached(target.uri, target.content),
      author: {
        handle: normalizeMastoHandle(target.account.acct, target.account.url),
        displayName: target.account.displayName ?? (target.account as any).display_name,
        avatar: target.account.avatar ?? (target.account as any).avatar_static,
      },
      createdAt: feedDate,
      platform: 'mastodon',
      replyCount: target.repliesCount ?? (target as any).replies_count ?? 0,
      repostCount: target.reblogsCount ?? (target as any).reblogs_count ?? 0,
      likeCount: target.favouritesCount ?? (target as any).favourites_count ?? 0,
      replyParentUri: target.inReplyToId ?? (target as any).in_reply_to_id ?? undefined,
      isRepost: !!item.reblog,
      repostAuthor: item.reblog
        ? {
            handle: normalizeMastoHandle(item.account.acct, item.account.url),
            displayName: item.account.displayName,
          }
        : undefined,
      embeds: target.mediaAttachments,
      raw: item,
      emojis: (target.emojis ?? (target as any).emojis)?.map((e: any) => ({
        shortcode: e.shortcode,
        url: e.url ?? e.static_url,
      })),
    };
  }
}

/**
 * Build a lookup set from confirmed identities: pairs of handles that are the same person.
 * Returns a Set of "handleA<>handleB" keys (sorted so order doesn't matter).
 */
export function buildIdentityPairs(identities: { confirmed: boolean; links: { handle: string }[] }[]): Set<string> {
  const pairs = new Set<string>();
  for (const identity of identities) {
    if (!identity.confirmed) continue;
    const handles = identity.links.map(l => l.handle.toLowerCase());
    // Create pairs from all links (typically 2: one bsky + one mastodon)
    for (let i = 0; i < handles.length; i++) {
      for (let j = i + 1; j < handles.length; j++) {
        const key = [handles[i], handles[j]].sort().join('<>');
        pairs.add(key);
      }
    }
  }
  return pairs;
}

/** Check if two handles are confirmed to be the same person */
function areIdentityMatched(handle1: string, handle2: string, identityPairs: Set<string>): boolean {
  const key = [handle1.toLowerCase(), handle2.toLowerCase()].sort().join('<>');
  return identityPairs.has(key);
}

/**
 * Detect crossposted content between platforms.
 * When identityPairs is provided, uses a lower similarity threshold (0.7)
 * for posts by authors confirmed to be the same person.
 *
 * Optimized: caches results by URI set, uses text-length bucketing to reduce
 * comparisons, and exits early on high-confidence matches.
 */
let _crosspostCache: { key: string; result: FeedItem[] } | null = null;

export function detectCrossposts(posts: UnifiedPost[], identityPairs?: Set<string>): FeedItem[] {
  // Order-independent cache key: length + hash of all URIs
  let h = 0;
  for (const p of posts) { for (let i = 0; i < p.uri.length; i++) h = ((h << 5) - h + p.uri.charCodeAt(i)) | 0; }
  const cacheKey = `${posts.length}:${h}`;
  if (_crosspostCache && _crosspostCache.key === cacheKey) return _crosspostCache.result;

  /**
   * How much of the shorter post has to appear, word-run for word-run, in the
   * longer one.
   *
   * Scored against src/lib/api/crosspost-corpus.ts, where real crosspost
   * shapes land between 0.75 and 1.00 and unrelated pairs between 0.00 and
   * 0.50. 0.65 sits in that gap with room on both sides.
   *
   * A confirmed same-person pairing is evidence, so it lowers the bar — but
   * only a little. Two different posts by one author are still two posts, and
   * the worst near-miss in the corpus, a pair sharing only a sign-off, scores
   * 0.50 and stays below both numbers.
   */
  const DEFAULT_THRESHOLD = 0.65;
  const IDENTITY_THRESHOLD = 0.55;
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  const feedItems: FeedItem[] = [];
  const processedUris = new Set<string>();

  const timestamps = new Map<string, number>();
  for (const p of posts) timestamps.set(p.uri, new Date(p.createdAt).getTime());

  // One fingerprint per post, reused by every comparison it takes part in.
  const prints = posts.map((p) => fingerprint(p.text));
  // The index is what removes the quadratic term: a post is only scored
  // against posts sharing a run of three words, and unrelated posts share
  // none, so they never become candidates at all.
  const index = new ShingleIndex(prints);

  for (let i = 0; i < posts.length; i++) {
    const post1 = posts[i];
    if (processedUris.has(post1.uri)) continue;

    const t1 = timestamps.get(post1.uri)!;
    let bestMatch: UnifiedPost | null = null;
    let bestScore = 0;
    let bestIsIdentityMatch = false;

    for (const j of index.candidates(prints[i])) {
      if (j === i) continue;
      const post2 = posts[j];
      // A crosspost is the same text on a *different* network.
      if (post2.platform === post1.platform) continue;
      if (processedUris.has(post2.uri)) continue;
      if (Math.abs(t1 - timestamps.get(post2.uri)!) >= TIME_WINDOW_MS) continue;

      // A score involving a text too short to form a shingle only says that one
      // post's words appear in the other: "thanks" is fully contained in
      // "thanks everyone", and two strangers both posting "Good morning!" score
      // a perfect 1. Grouping those as a crosspost merges unrelated people's
      // small talk and hides one of the posts, so a short text has to be
      // corroborated by the authors being the same person.
      if (usedWordFallback(prints[i]) || usedWordFallback(prints[j])) {
        const sameHandle =
          post1.author.handle.toLowerCase() === post2.author.handle.toLowerCase();
        const sameIdentity = identityPairs
          ? areIdentityMatched(post1.author.handle, post2.author.handle, identityPairs)
          : false;
        if (!sameHandle && !sameIdentity) continue;
      }

      const score = similarity(prints[i], prints[j]);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post2;
        bestIsIdentityMatch = identityPairs
          ? areIdentityMatched(post1.author.handle, post2.author.handle, identityPairs)
          : false;
        if (score >= 1) break; // nothing can beat a full containment
      }
    }

    const threshold = bestIsIdentityMatch ? IDENTITY_THRESHOLD : DEFAULT_THRESHOLD;

    if (bestMatch && bestScore >= threshold) {
      const allMatches = [post1, bestMatch].sort((a, b) =>
        a.platform.localeCompare(b.platform)
      );
      const group: CrosspostGroup = {
        type: 'crosspost',
        id: post1.uri,
        posts: allMatches,
        similarity: bestScore,
      };
      feedItems.push(group);
      allMatches.forEach((p) => processedUris.add(p.uri));
    } else {
      feedItems.push(post1);
      processedUris.add(post1.uri);
    }
  }

  _crosspostCache = { key: cacheKey, result: feedItems };
  return feedItems;
}

/** Sort posts by the given criteria.
 * For date sorts, pre-computes timestamps to avoid repeated Date parsing in comparator. */
export function sortPosts(
  posts: UnifiedPost[],
  sortBy: string
): UnifiedPost[] {
  if (sortBy === 'oldest' || sortBy === 'newest') {
    // Schwartzian transform: parse dates once, sort by cached timestamp
    const decorated = posts.map(p => ({ p, t: new Date(p.createdAt).getTime() }));
    decorated.sort((a, b) => sortBy === 'oldest' ? a.t - b.t : b.t - a.t);
    return decorated.map(d => d.p);
  }
  return [...posts].sort((a, b) => {
    switch (sortBy) {
      case 'likes':
        return (b.likeCount ?? 0) - (a.likeCount ?? 0);
      case 'reposts':
        return (b.repostCount ?? 0) - (a.repostCount ?? 0);
      case 'engagement':
        return (
          (b.likeCount ?? 0) + (b.repostCount ?? 0) -
          ((a.likeCount ?? 0) + (a.repostCount ?? 0))
        );
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });
}

/** Narrow a FeedItem to a crosspost group. */
export function isCrosspostGroup(item: FeedItem): item is CrosspostGroup {
  return 'type' in item && item.type === 'crosspost';
}

/** Apply filters to a post array. Ordering is sortPosts' job, hence no `sortBy`. */
export function filterPosts(
  posts: UnifiedPost[],
  filters: Omit<Filters, 'sortBy'>,
): UnifiedPost[] {
  return posts.filter((post) => {
    if (filters.hideReposts && post.isRepost) return false;
    if (
      filters.searchTerm &&
      !post.text.toLowerCase().includes(filters.searchTerm.toLowerCase())
    )
      return false;
    if (filters.hideReplies) {
      if (post.replyParentUri) return false;
      if (post.platform === 'mastodon' && post.text.trim().startsWith('@'))
        return false;
    }
    if (filters.hasMedia) {
      const hasBskyMedia = post.platform === 'bluesky' && post.embeds;
      const hasMastoMedia =
        post.platform === 'mastodon' &&
        Array.isArray(post.embeds) &&
        (post.embeds as unknown[]).length > 0;
      const hasThreadsMedia = post.platform === 'threads' && post.embeds;
      if (!hasBskyMedia && !hasMastoMedia && !hasThreadsMedia) return false;
    }
    if (filters.minLikes > 0 && (post.likeCount ?? 0) < filters.minLikes)
      return false;
    return true;
  });
}
