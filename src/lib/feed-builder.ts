/**
 * Visual Bluesky feed builder — rule engine and query compiler.
 *
 * Users define filter rules visually; we compile them into Bluesky
 * searchPosts queries for live preview. Feed definitions are saved
 * to localStorage and can be added as deck columns.
 *
 * Bluesky searchPosts supports Lucene-like query syntax:
 * - Keywords: word1 word2 (AND), "exact phrase"
 * - Language: lang:en
 * - Author: from:handle.bsky.social
 * - Domain: domain:example.com
 * - Mentions: mentions:handle
 * - Since/Until: since:2026-01-01, until:2026-12-31
 * - Negation: -word, -from:handle
 * - Has media: has:images, has:video, has:link
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type RuleType =
  | 'keyword'       // Include posts containing these words
  | 'phrase'        // Include posts with this exact phrase
  | 'exclude'       // Exclude posts containing these words
  | 'language'      // Filter by language code
  | 'author'        // Only from specific authors
  | 'exclude-author'// Exclude specific authors
  | 'has-media'     // Must have images/video/link
  | 'domain'        // Contains links from this domain
  | 'mentions'      // Mentions a specific user
  | 'since'         // Posts after this date
  | 'until';        // Posts before this date

export interface FeedRule {
  id: string;
  type: RuleType;
  value: string;
  enabled: boolean;
}

export interface FeedDefinition {
  id: string;
  name: string;
  description: string;
  rules: FeedRule[];
  created_at: string;
  updated_at: string;
  /** AT URI if published to Bluesky network */
  atUri?: string;
  /** Record key used for publishing */
  rkey?: string;
  /** DID of the user who published it */
  publishedBy?: string;
}

// ── Feed generator constants ────────────────────────────────────────────────

export const GENERATOR_DID = 'did:web:crispdeck.vercel.app';
const FEED_COLLECTION = 'app.bsky.feed.generator';

// ── Rule helpers ─────────────────────────────────────────────────────────────

let ruleCounter = 0;

export function createRule(type: RuleType, value = ''): FeedRule {
  return {
    id: `rule-${Date.now()}-${ruleCounter++}`,
    type,
    value,
    enabled: true,
  };
}

let feedCounter = 0;

export function createFeedDefinition(name = 'New Feed'): FeedDefinition {
  return {
    id: `feed-${Date.now()}-${feedCounter++}`,
    name,
    description: '',
    rules: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Query compiler ───────────────────────────────────────────────────────────

/**
 * Compile feed rules into a Bluesky searchPosts query string.
 *
 * Examples:
 *   keyword("typescript") + language("en") → "typescript lang:en"
 *   keyword("svelte") + exclude("react") → "svelte -react"
 *   author("alice.bsky.social") + has-media("images") → "from:alice.bsky.social has:images"
 */
export function compileQuery(rules: FeedRule[]): string {
  const parts: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled || !rule.value.trim()) continue;

    const val = rule.value.trim();

    switch (rule.type) {
      case 'keyword':
        // Split on spaces — each word is ANDed by default
        parts.push(val);
        break;

      case 'phrase':
        // Exact phrase match
        parts.push(`"${val}"`);
        break;

      case 'exclude':
        // Negate each word
        for (const word of val.split(/\s+/).filter(Boolean)) {
          parts.push(`-${word}`);
        }
        break;

      case 'language':
        parts.push(`lang:${val}`);
        break;

      case 'author':
        // Support multiple authors separated by commas
        for (const author of val.split(',').map(a => a.trim()).filter(Boolean)) {
          parts.push(`from:${author.replace(/^@/, '')}`);
        }
        break;

      case 'exclude-author':
        for (const author of val.split(',').map(a => a.trim()).filter(Boolean)) {
          parts.push(`-from:${author.replace(/^@/, '')}`);
        }
        break;

      case 'has-media':
        // values: images, video, link
        parts.push(`has:${val}`);
        break;

      case 'domain':
        parts.push(`domain:${val}`);
        break;

      case 'mentions':
        parts.push(`mentions:${val.replace(/^@/, '')}`);
        break;

      case 'since':
        parts.push(`since:${val}`);
        break;

      case 'until':
        parts.push(`until:${val}`);
        break;
    }
  }

  return parts.join(' ');
}

/**
 * Get a human-readable summary of the feed rules.
 */
export function describeFeed(rules: FeedRule[]): string {
  const active = rules.filter(r => r.enabled && r.value.trim());
  if (active.length === 0) return 'No filters — shows all posts';

  const descriptions: string[] = [];
  for (const rule of active) {
    switch (rule.type) {
      case 'keyword': descriptions.push(`contains "${rule.value}"`); break;
      case 'phrase': descriptions.push(`exact phrase "${rule.value}"`); break;
      case 'exclude': descriptions.push(`excludes "${rule.value}"`); break;
      case 'language': descriptions.push(`language: ${rule.value}`); break;
      case 'author': descriptions.push(`from: ${rule.value}`); break;
      case 'exclude-author': descriptions.push(`not from: ${rule.value}`); break;
      case 'has-media': descriptions.push(`has ${rule.value}`); break;
      case 'domain': descriptions.push(`links to ${rule.value}`); break;
      case 'mentions': descriptions.push(`mentions ${rule.value}`); break;
      case 'since': descriptions.push(`after ${rule.value}`); break;
      case 'until': descriptions.push(`before ${rule.value}`); break;
    }
  }

  return descriptions.join(' + ');
}

/**
 * Get the label for a rule type.
 */
export function getRuleLabel(type: RuleType): string {
  const labels: Record<RuleType, string> = {
    keyword: 'Keywords',
    phrase: 'Exact Phrase',
    exclude: 'Exclude Words',
    language: 'Language',
    author: 'From Author',
    'exclude-author': 'Exclude Author',
    'has-media': 'Has Media',
    domain: 'From Domain',
    mentions: 'Mentions User',
    since: 'Since Date',
    until: 'Until Date',
  };
  return labels[type];
}

/**
 * Get a placeholder hint for a rule type.
 */
export function getRulePlaceholder(type: RuleType): string {
  const placeholders: Record<RuleType, string> = {
    keyword: 'typescript svelte rust',
    phrase: 'machine learning',
    exclude: 'politics drama',
    language: 'en',
    author: 'alice.bsky.social',
    'exclude-author': 'spammer.bsky.social',
    'has-media': 'images',
    domain: 'github.com',
    mentions: 'user.bsky.social',
    since: '2026-01-01',
    until: '2026-12-31',
  };
  return placeholders[type];
}

/**
 * Available rule types for the "add rule" menu.
 */
export const RULE_TYPES: { type: RuleType; label: string; icon: string }[] = [
  { type: 'keyword', label: 'Keywords', icon: 'search' },
  { type: 'phrase', label: 'Exact Phrase', icon: 'quote' },
  { type: 'exclude', label: 'Exclude Words', icon: 'x' },
  { type: 'language', label: 'Language', icon: 'globe' },
  { type: 'author', label: 'From Author', icon: 'user' },
  { type: 'exclude-author', label: 'Exclude Author', icon: 'user-x' },
  { type: 'has-media', label: 'Has Media', icon: 'image' },
  { type: 'domain', label: 'From Domain', icon: 'link' },
  { type: 'mentions', label: 'Mentions User', icon: 'at-sign' },
  { type: 'since', label: 'Since Date', icon: 'calendar' },
  { type: 'until', label: 'Until Date', icon: 'calendar' },
];

// ── Persistence (localStorage) ───────────────────────────────────────────────

const STORAGE_KEY = 'crispdeck-custom-feeds';

export function listSavedFeeds(): FeedDefinition[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function saveFeedDefinition(feed: FeedDefinition): void {
  const feeds = listSavedFeeds();
  const idx = feeds.findIndex(f => f.id === feed.id);
  feed.updated_at = new Date().toISOString();
  if (idx >= 0) {
    feeds[idx] = feed;
  } else {
    feeds.push(feed);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
}

export function deleteFeedDefinition(id: string): void {
  const feeds = listSavedFeeds().filter(f => f.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
}

export function getFeedDefinition(id: string): FeedDefinition | null {
  return listSavedFeeds().find(f => f.id === id) ?? null;
}

// ── Network publishing ──────────────────────────────────────────────────────

/** The API base for the feed storage server (same origin on Vercel) */
const FEED_API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}/api/feed`
  : '/api/feed';

let rkeyCounter = 0;

/**
 * Generate a human-readable, AT Protocol-safe rkey from a feed name.
 * rkeys must match [a-zA-Z0-9._:~-]{1,512}.
 */
export function generateRkey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const suffix = `${Date.now().toString(36)}${(rkeyCounter++).toString(36)}`;
  return `${slug || 'feed'}-${suffix}`;
}

/**
 * Publish a feed definition to the Bluesky network.
 *
 * 1. Stores the feed definition (query + metadata) in Vercel Blob via /api/feed/publish
 * 2. Creates an `app.bsky.feed.generator` record on the user's PDS
 *
 * @returns The AT URI of the published feed
 */
export async function publishFeedGenerator(
  agent: any,
  userDid: string,
  feed: FeedDefinition,
): Promise<{ atUri: string; rkey: string }> {
  const query = compileQuery(feed.rules);
  if (!query.trim()) throw new Error('Cannot publish a feed with no filter rules');

  const rkey = generateRkey(feed.name);

  // 1. Store feed definition on the server (Vercel Blob)
  const storeResp = await fetch(`${FEED_API_BASE}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rkey,
      query,
      name: feed.name || 'CrispDeck Feed',
      description: feed.description || '',
      userDid,
    }),
  });

  if (!storeResp.ok) {
    const err = await storeResp.json().catch(() => ({ error: 'Server error' }));
    throw new Error(`Failed to store feed: ${err.error}`);
  }

  // 2. Create the feed generator record on the user's PDS
  const record = {
    $type: FEED_COLLECTION,
    did: GENERATOR_DID,
    displayName: feed.name || 'CrispDeck Feed',
    description: feed.description || `Custom feed: ${query}`,
    createdAt: new Date().toISOString(),
  };

  await agent.api.com.atproto.repo.putRecord({
    repo: userDid,
    collection: FEED_COLLECTION,
    rkey,
    record,
  });

  const atUri = `at://${userDid}/${FEED_COLLECTION}/${rkey}`;
  return { atUri, rkey };
}

/**
 * Unpublish a feed from the Bluesky network.
 * 1. Deletes the feed definition from Vercel Blob
 * 2. Deletes the `app.bsky.feed.generator` record from the user's PDS
 */
export async function unpublishFeedGenerator(
  agent: any,
  userDid: string,
  rkey: string,
): Promise<void> {
  // 1. Remove from server storage
  await fetch(`${FEED_API_BASE}/unpublish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rkey }),
  }).catch(() => {}); // Best-effort — PDS record deletion is the critical path

  // 2. Delete from user's PDS
  await agent.api.com.atproto.repo.deleteRecord({
    repo: userDid,
    collection: FEED_COLLECTION,
    rkey,
  });
}
