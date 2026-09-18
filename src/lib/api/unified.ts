import type { AppBskyFeedDefs } from '@atproto/api';

/**
 * Local stand-in for AppBskyFeedDefs.isReasonRepost.
 *
 * Importing it as a value pulls the whole @atproto/api lexicon bundle (~1 MB
 * raw) into every chunk that renders a feed, for one $type comparison. The
 * upstream predicate is exactly this check — see is$typed/is$type in
 * @atproto/api — and unified.isReasonRepost.test.ts pins the two together.
 */
const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost';

export function isReasonRepost(v: unknown): v is AppBskyFeedDefs.ReasonRepost {
  return v != null && typeof v === 'object' && '$type' in v &&
    (v as { $type?: unknown }).$type === REASON_REPOST;
}
import type { mastodon } from 'masto';
import type { UnifiedPost, FeedItem, CrosspostGroup, Platform } from '$lib/types';

type PlatformPost = AppBskyFeedDefs.FeedViewPost | mastodon.v1.Status;

export function normalizePost(post: PlatformPost, platform: Platform): UnifiedPost {
  if (platform === 'bluesky') {
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
      text: target.content.replace(/<[^>]*>?/gm, ''),
      author: {
        handle: target.account.acct.includes('@')
          ? `@${target.account.acct}`
          : `@${target.account.acct}@${new URL(target.account.url).hostname}`,
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
            handle: item.account.acct.includes('@')
              ? `@${item.account.acct}`
              : `@${item.account.acct}@${new URL(item.account.url).hostname}`,
            displayName: item.account.displayName,
          }
        : undefined,
      embeds: target.mediaAttachments,
      raw: item,
    };
  }
}

/**
 * Jaro-Winkler similarity (pure JS, no dependency needed for this)
 *
 * Scratch buffers live at module scope: crosspost detection calls this a large
 * number of times, and allocating two arrays per call dominated its cost.
 */
let jwScratch1 = new Uint8Array(512);
let jwScratch2 = new Uint8Array(512);

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  if (jwScratch1.length < len1) jwScratch1 = new Uint8Array(len1 * 2);
  if (jwScratch2.length < len2) jwScratch2 = new Uint8Array(len2 * 2);
  const s1Matches = jwScratch1, s2Matches = jwScratch2;
  s1Matches.fill(0, 0, len1);
  s2Matches.fill(0, 0, len2);

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);

  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    const c1 = s1.charCodeAt(i);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || c1 !== s2.charCodeAt(j)) continue;
      s1Matches[i] = 1;
      s2Matches[j] = 1;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1.charCodeAt(i) !== s2.charCodeAt(k)) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1.charCodeAt(i) === s2.charCodeAt(i)) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Tight upper bound on jaroWinkler(a, b) knowable from lengths alone.
 *
 * The best case is every character of the shorter string matching with no
 * transpositions, giving jaro <= (2 + r) / 3 where r = minLen / maxLen, plus a
 * full four-character prefix bonus, giving jw <= jaro + 0.4 * (1 - jaro).
 * Substituting gives jw <= 0.8 + 0.2 * r.
 *
 * Pruning against this bound is admissible: it only ever discards a candidate
 * that provably cannot outscore the incumbent best match, so detectCrossposts
 * returns exactly what an exhaustive comparison would.
 */
export function jaroWinklerUpperBound(len1: number, len2: number): number {
  if (len1 === 0 && len2 === 0) return 1; // two empty strings are identical
  if (len1 === 0 || len2 === 0) return 0;
  const r = len1 < len2 ? len1 / len2 : len2 / len1;
  return 0.8 + 0.2 * r;
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
 * Comparison is pairwise, but three things keep it off the hot path:
 *   - a single-platform feed can't contain crossposts at all, so it exits early;
 *   - timestamps are parsed once up front rather than once per pair, and when
 *     the feed is in time order (what sortPosts produces) the 24h candidate
 *     window is a contiguous index range tracked by two monotone pointers;
 *   - each pair is checked against a length-derived upper bound before the
 *     full similarity is computed.
 * None of these change the result — see jaroWinklerUpperBound.
 */
export function detectCrossposts(posts: UnifiedPost[], identityPairs?: Set<string>): FeedItem[] {
  const DEFAULT_THRESHOLD = 0.9;
  const IDENTITY_THRESHOLD = 0.7;
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  const feedItems: FeedItem[] = [];
  const processedUris = new Set<string>();
  const n = posts.length;

  if (n === 0) return feedItems;

  // A crosspost is by definition cross-platform, so a single-platform feed
  // needs no comparisons at all — just the de-duplication pass.
  let multiPlatform = false;
  for (let i = 1; i < n; i++) {
    if (posts[i].platform !== posts[0].platform) {
      multiPlatform = true;
      break;
    }
  }
  if (!multiPlatform) {
    for (const post of posts) {
      if (processedUris.has(post.uri)) continue;
      processedUris.add(post.uri);
      feedItems.push(post);
    }
    return feedItems;
  }

  // Parse each createdAt once. timeOrdered tracks whether the feed is already
  // newest-first, which lets the candidate window below be a sliding range.
  const ts = new Float64Array(n);
  let timeOrdered = true;
  for (let i = 0; i < n; i++) {
    const t = new Date(posts[i].createdAt).getTime();
    ts[i] = t;
    if (Number.isNaN(t)) timeOrdered = false;
    else if (i > 0 && t > ts[i - 1]) timeOrdered = false;
  }

  // Both pointers only ever move forward, so maintaining them costs O(n) total.
  let lo = 0, hi = 0;

  for (let i = 0; i < n; i++) {
    const post1 = posts[i];
    if (processedUris.has(post1.uri)) continue;

    let from = 0, to = n - 1;
    if (timeOrdered) {
      while (lo < i && !(ts[lo] - ts[i] < TIME_WINDOW_MS)) lo++;
      while (hi + 1 < n && ts[i] - ts[hi + 1] < TIME_WINDOW_MS) hi++;
      from = lo;
      to = hi;
    }

    const platform1 = post1.platform;
    const text1 = post1.text;
    const len1 = text1.length;
    const t1 = ts[i];

    let bestMatch: UnifiedPost | null = null;
    let bestScore = 0;
    let bestIsIdentityMatch = false;

    for (let j = from; j <= to; j++) {
      if (j === i) continue;
      const post2 = posts[j];
      if (post2.platform === platform1) continue;
      if (post2.uri === post1.uri) continue;
      if (processedUris.has(post2.uri)) continue;
      if (!(Math.abs(t1 - ts[j]) < TIME_WINDOW_MS)) continue;
      if (jaroWinklerUpperBound(len1, post2.text.length) <= bestScore) continue;

      const score = jaroWinkler(text1, post2.text);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post2;
        bestIsIdentityMatch = identityPairs
          ? areIdentityMatched(post1.author.handle, post2.author.handle, identityPairs)
          : false;
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

  return feedItems;
}

/** Sort posts by the given criteria */
export function sortPosts(
  posts: UnifiedPost[],
  sortBy: string
): UnifiedPost[] {
  return [...posts].sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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

/** Apply filters to a post array */
export function filterPosts(
  posts: UnifiedPost[],
  filters: {
    searchTerm: string;
    hasMedia: boolean;
    hideReplies: boolean;
    hideReposts: boolean;
    minLikes: number;
  }
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

/**
 * Incremental wrapper around detectCrossposts for infinite scroll.
 *
 * The feed page appends older posts to the end of a time-ordered array and
 * re-derives crosspost groups. Re-running detection over the whole accumulated
 * array each time is what makes scrolling expensive: the work grows
 * quadratically while the answer for the top of the feed never changes.
 *
 * A newly appended post is always older than everything before it, so it can
 * only ever match posts within the 24h window above it. Everything above that
 * window keeps the grouping it already had, and only the tail is recomputed.
 *
 * Returns exactly what detectCrossposts(posts) would return; falls back to a
 * full recomputation whenever the preconditions don't hold (the array is not an
 * append of the previous one, is not time-ordered, or has unparseable dates).
 */
/** Narrow a FeedItem to a crosspost group. */
export function isCrosspostGroup(item: FeedItem): item is CrosspostGroup {
  return (item as CrosspostGroup).type === 'crosspost';
}

export interface CrosspostCache {
  posts: UnifiedPost[];
  items: FeedItem[];
}

export function detectCrosspostsIncremental(
  posts: UnifiedPost[],
  identityPairs: Set<string> | undefined,
  cache: CrosspostCache | null
): { items: FeedItem[]; cache: CrosspostCache; reused: number } {
  const full = () => {
    const items = detectCrossposts(posts, identityPairs);
    return { items, cache: { posts, items }, reused: 0 };
  };

  const n = posts.length;
  if (!cache || cache.posts.length === 0 || cache.posts.length >= n) return full();

  const k = cache.posts.length;
  // The new array must extend the old one unchanged.
  for (let i = 0; i < k; i++) {
    if (cache.posts[i].uri !== posts[i].uri) return full();
  }

  // Detection only slides its window when the feed is newest-first.
  const ts = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = new Date(posts[i].createdAt).getTime();
    if (Number.isNaN(t)) return full();
    if (i > 0 && t > ts[i - 1]) return full();
    ts[i] = t;
  }

  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  // First index that the newly appended posts can possibly reach.
  let cutoff = 0;
  while (cutoff < k && !(ts[cutoff] - ts[k] < TIME_WINDOW_MS)) cutoff++;
  if (cutoff === 0) return full(); // nothing above the window to keep

  const indexOfUri = new Map<string, number>();
  for (let i = 0; i < n; i++) if (!indexOfUri.has(posts[i].uri)) indexOfUri.set(posts[i].uri, i);

  // Keep leading items whose ANCHOR sits above the reachable window.
  //
  // The anchor is the post the outer loop was on when it emitted the item, and
  // it alone decides the grouping: its candidates are the unprocessed
  // cross-platform posts within 24h of it, none of which can be one of the
  // newly appended posts. A group's partner may well sit below the cutoff —
  // the 24h window spans a lot of indices on a busy feed — but that partner is
  // consumed by the anchor either way, so it does not invalidate the decision.
  // Stopping at the first such partner instead (the obvious reading) makes one
  // long-range group near the top throw away all the reusable work behind it.
  const kept: FeedItem[] = [];
  const consumed = new Set<string>();
  let resumeFrom = 0;
  for (const item of cache.items) {
    const anchorUri = isCrosspostGroup(item) ? item.id : (item as UnifiedPost).uri;
    const anchorIdx = indexOfUri.get(anchorUri);
    if (anchorIdx === undefined || anchorIdx >= cutoff) break;
    kept.push(item);
    for (const m of isCrosspostGroup(item) ? item.posts : [item as UnifiedPost]) {
      consumed.add(m.uri);
    }
    // Everything up to and including the anchor is consumed; resume after it.
    if (anchorIdx + 1 > resumeFrom) resumeFrom = anchorIdx + 1;
  }

  if (kept.length === 0) return full();

  // Recompute the tail, treating already-grouped posts as taken.
  const tail = posts.slice(resumeFrom).filter((p) => !consumed.has(p.uri));
  const tailItems = detectCrossposts(tail, identityPairs);
  const items = kept.concat(tailItems);
  return { items, cache: { posts, items }, reused: kept.length };
}
