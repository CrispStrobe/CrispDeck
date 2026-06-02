// ── Platform types ──────────────────────────────────────────────────────────

export type Platform = 'bluesky' | 'mastodon';

// ── Account (mirrors SQLite `accounts` table) ──────────────────────────────

export interface Account {
  id: number;
  platform: Platform;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  did: string | null;
  mastodon_id: string | null;
  instance_url: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

// ── Identity (cross-platform person grouping) ──────────────────────────────

export interface IdentityLink {
  id: number;
  identity_id: number;
  account_id: number | null;
  platform: Platform;
  handle: string;
  did: string | null;
  mastodon_id: string | null;
  instance_url: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface Identity {
  id: number;
  display_name: string | null;
  notes: string | null;
  auto_detected: boolean;
  confirmed: boolean;
  confidence: number | null;
  tags: string[];
  links: IdentityLink[];
  created_at: string;
  updated_at: string;
}

export interface IdentityCandidate {
  bluesky_handle: string;
  bluesky_display_name: string | null;
  bluesky_avatar: string | null;
  bluesky_bio: string | null;
  bluesky_did: string | null;
  mastodon_handle: string;
  mastodon_display_name: string | null;
  mastodon_avatar: string | null;
  mastodon_bio: string | null;
  mastodon_id: string | null;
  mastodon_instance: string | null;
  confidence: number;
  match_reasons: string[];
}

// ── Unified post (cross-platform post normalization) ───────────────────────

export interface PostAuthor {
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface UnifiedPost {
  uri: string;
  text: string;
  author: PostAuthor;
  createdAt: string;
  platform: Platform;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  replyParentUri?: string;
  isRepost: boolean;
  repostAuthor?: PostAuthor;
  embeds?: unknown;
  raw?: unknown;
}

export interface CrosspostGroup {
  type: 'crosspost';
  id: string;
  posts: UnifiedPost[];
  similarity: number;
}

export type FeedItem = UnifiedPost | CrosspostGroup;

// ── Filters ────────────────────────────────────────────────────────────────

export interface Filters {
  searchTerm: string;
  sortBy: 'newest' | 'oldest' | 'likes' | 'reposts' | 'engagement';
  hasMedia: boolean;
  hideReplies: boolean;
  hideReposts: boolean;
  minLikes: number;
}

// ── Crosspost history ──────────────────────────────────────────────────────

export interface CrosspostEntry {
  id: number;
  draft_id: number | null;
  bluesky_uri: string | null;
  bluesky_cid: string | null;
  mastodon_uri: string | null;
  mastodon_id: string | null;
  text_preview: string | null;
  media_count: number;
  posted_at: string;
  status: 'success' | 'partial' | 'failed';
}

// ── Drafts ─────────────────────────────────────────────────────────────────

export interface Draft {
  id: number;
  text: string;
  target_accounts: number[];
  media_paths: string[];
  visibility: string;
  content_warning: string | null;
  is_sent: boolean;
  created_at: string;
  updated_at: string;
}

// ── Follows cache ──────────────────────────────────────────────────────────

export interface FollowEntry {
  platform: Platform;
  handle: string;
  did: string | null;
  mastodon_id: string | null;
  instance_url: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}
