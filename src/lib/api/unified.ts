import { AppBskyFeedDefs } from '@atproto/api';
import type { mastodon } from 'masto';
import type { UnifiedPost, FeedItem, CrosspostGroup } from '$lib/types';

type PlatformPost = AppBskyFeedDefs.FeedViewPost | mastodon.v1.Status;

export function normalizePost(post: PlatformPost, platform: 'bluesky' | 'mastodon'): UnifiedPost {
  if (platform === 'bluesky') {
    const item = post as AppBskyFeedDefs.FeedViewPost;
    const p = item.post;
    const record = p.record as {
      text: string;
      createdAt: string;
      reply?: { parent: { uri: string } };
    };
    // For reposts: use the repost time (when it appeared in feed), not original post time
    const feedDate = AppBskyFeedDefs.isReasonRepost(item.reason)
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
      isRepost: AppBskyFeedDefs.isReasonRepost(item.reason),
      repostAuthor: AppBskyFeedDefs.isReasonRepost(item.reason)
        ? { handle: item.reason.by.handle, displayName: item.reason.by.displayName }
        : undefined,
      embeds: p.embed,
      raw: item,
    };
  } else {
    const item = post as mastodon.v1.Status;
    const target = item.reblog ?? item;
    // For reblogs: use the reblog time (item.createdAt), not original post time (target.createdAt)
    const feedDate = item.reblog ? item.createdAt : target.createdAt;
    return {
      uri: target.uri,
      text: target.content.replace(/<[^>]*>?/gm, ''),
      author: {
        handle: target.account.acct.includes('@')
          ? `@${target.account.acct}`
          : `@${target.account.acct}@${new URL(target.account.url).hostname}`,
        displayName: target.account.displayName,
        avatar: target.account.avatar,
      },
      createdAt: feedDate,
      platform: 'mastodon',
      replyCount: target.repliesCount,
      repostCount: target.reblogsCount,
      likeCount: target.favouritesCount,
      replyParentUri: target.inReplyToId ?? undefined,
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

/** Jaro-Winkler similarity (pure JS, no dependency needed for this) */
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Detect crossposted content between platforms */
export function detectCrossposts(posts: UnifiedPost[]): FeedItem[] {
  const SIMILARITY_THRESHOLD = 0.9;
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  const feedItems: FeedItem[] = [];
  const processedUris = new Set<string>();

  for (const post1 of posts) {
    if (processedUris.has(post1.uri)) continue;

    const potentialMatches = posts.filter(
      (post2) =>
        !processedUris.has(post2.uri) &&
        post1.uri !== post2.uri &&
        post1.platform !== post2.platform &&
        Math.abs(
          new Date(post1.createdAt).getTime() - new Date(post2.createdAt).getTime()
        ) < TIME_WINDOW_MS
    );

    let bestMatch: UnifiedPost | null = null;
    let bestScore = 0;

    for (const post2 of potentialMatches) {
      const score = jaroWinkler(post1.text, post2.text);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post2;
      }
    }

    if (bestMatch && bestScore >= SIMILARITY_THRESHOLD) {
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
      if (!hasBskyMedia && !hasMastoMedia) return false;
    }
    if (filters.minLikes > 0 && (post.likeCount ?? 0) < filters.minLikes)
      return false;
    return true;
  });
}
