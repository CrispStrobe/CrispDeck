/**
 * Trimming the raw payload kept in the archive.
 *
 * Each archived record stored the entire original API response. That is by far
 * the largest part of a record — a Mastodon Status carries the author's whole
 * profile, emoji and tag arrays, viewer state and more; a Bluesky FeedViewPost
 * carries the full record, author profile, embed views and thread context —
 * while the UI reads only a handful of fields back out.
 *
 * The fields kept here are exactly those the app reads from `post.raw`,
 * enumerated from every call site (Post.svelte, feed, deck, catchup). Anything
 * the archive itself needs already lives in ArchivedPost's own columns; Bluesky
 * embeds come from UnifiedPost.embeds, which the archive has never stored.
 *
 * archive-raw.test.ts pins the projection against realistic payloads and asserts
 * every consumer path still resolves, so a new `raw` access that this doesn't
 * cover shows up as a failing test rather than a blank post.
 */
import type { Platform } from './types';

/** Copy only these keys, when present. */
function pick<T extends object>(source: any, keys: string[]): T | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const out: any = {};
  let kept = false;
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key] = source[key];
      kept = true;
    }
  }
  return kept ? out : undefined;
}

const ACCOUNT_KEYS = ['url', 'acct', 'username', 'displayName', 'display_name', 'avatar'];
const ATTACHMENT_KEYS = [
  'type', 'url', 'previewUrl', 'preview_url', 'remoteUrl', 'remote_url', 'description', 'blurhash',
];
const CARD_KEYS = ['url', 'title', 'description', 'image', 'provider_name', 'providerName'];

function trimAttachments(list: unknown): any[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((item) => pick(item, ATTACHMENT_KEYS) ?? {});
}

/**
 * One Mastodon status. `reblog` is the same shape nested, so it recurses once —
 * a boost of a boost isn't a thing the API produces.
 */
function trimMastodonStatus(status: any, depth = 0): any {
  if (!status || typeof status !== 'object') return status;
  const out: any = {};

  for (const key of ['id', 'uri', 'url', 'content', 'createdAt', 'created_at', 'labels']) {
    if (status[key] !== undefined) out[key] = status[key];
  }

  const account = pick(status.account, ACCOUNT_KEYS);
  if (account) out.account = account;

  // Polls are read AND written back (voting updates them in place), so the
  // whole object is kept rather than a projection of it.
  if (status.poll !== undefined) out.poll = status.poll;

  const media = trimAttachments(status.mediaAttachments ?? status.media_attachments);
  if (media) {
    if (status.mediaAttachments !== undefined) out.mediaAttachments = media;
    else out.media_attachments = media;
  }

  const card = pick(status.card ?? status.preview_card, CARD_KEYS);
  if (card) {
    if (status.card !== undefined) out.card = card;
    else out.preview_card = card;
  }

  if (status.reblog && depth === 0) out.reblog = trimMastodonStatus(status.reblog, depth + 1);

  return out;
}

/** One Bluesky FeedViewPost — only the identifiers and labels are read back. */
function trimBlueskyFeedItem(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const out: any = {};

  const post = pick(item.post, ['uri', 'cid', 'labels']);
  if (post) out.post = post;

  // Some call sites fall back to the top level when there is no nested post.
  for (const key of ['uri', 'cid', 'labels']) {
    if (item[key] !== undefined) out[key] = item[key];
  }

  return out;
}

/**
 * Reduce a raw payload to what the app reads back.
 *
 * Unknown platforms are passed through untouched rather than silently emptied —
 * losing data is worse than storing too much.
 */
export function trimRawForArchive(raw: unknown, platform: Platform): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  if (platform === 'mastodon') return trimMastodonStatus(raw);
  if (platform === 'bluesky') return trimBlueskyFeedItem(raw);
  return raw;
}
