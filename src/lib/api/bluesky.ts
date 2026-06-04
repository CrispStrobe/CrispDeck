import { BskyAgent, type AppBskyFeedDefs } from '@atproto/api';

const PUBLIC_API = 'https://public.api.bsky.app';
const AUTH_API = 'https://bsky.social';

/**
 * Resolve a user's actual PDS endpoint from their DID document.
 * - did:plc → query plc.directory
 * - did:web → fetch .well-known/did.json
 * Falls back to bsky.social if resolution fails.
 */
export async function resolvePdsEndpoint(handleOrDid: string): Promise<string> {
  try {
    let did = handleOrDid;

    // If it's a handle, resolve to DID first via public API
    if (!did.startsWith('did:')) {
      const resp = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`);
      if (!resp.ok) return AUTH_API;
      const data = await resp.json();
      did = data.did;
    }

    // Fetch DID document
    let didDoc: any;
    if (did.startsWith('did:plc:')) {
      const resp = await fetch(`https://plc.directory/${did}`);
      if (!resp.ok) return AUTH_API;
      didDoc = await resp.json();
    } else if (did.startsWith('did:web:')) {
      const domain = did.replace('did:web:', '');
      const resp = await fetch(`https://${domain}/.well-known/did.json`);
      if (!resp.ok) return AUTH_API;
      didDoc = await resp.json();
    } else {
      return AUTH_API;
    }

    // Extract PDS endpoint from service array
    const services = didDoc.service ?? [];
    const pdsSvc = services.find((s: any) =>
      s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
    );
    if (pdsSvc?.serviceEndpoint) {
      return pdsSvc.serviceEndpoint;
    }
  } catch {
    // Resolution failed — fall back
  }
  return AUTH_API;
}

/**
 * Bluesky client with two modes:
 * - Public (no auth): reading profiles, feeds, searching — uses public.api.bsky.app
 * - Authenticated: posting, likes, follows — uses user's resolved PDS (or bsky.social)
 */
export class BlueskyClient {
  private publicAgent: BskyAgent;
  private authAgent: BskyAgent | null = null;
  private loggedIn = false;
  private handle: string;
  private appPassword: string | null;
  private pdsUrl: string | null = null;

  constructor(handle: string, appPassword?: string, pdsUrl?: string) {
    this.handle = handle;
    this.appPassword = appPassword ?? null;
    this.pdsUrl = pdsUrl ?? null;
    this.publicAgent = new BskyAgent({ service: PUBLIC_API });
    if (this.appPassword) {
      // Auth agent created lazily in login() after PDS resolution
      this.authAgent = new BskyAgent({ service: pdsUrl ?? AUTH_API });
    }
  }

  /** Create a read-only client (no app password needed) */
  static readOnly(handle: string): BlueskyClient {
    return new BlueskyClient(handle);
  }

  async login(): Promise<void> {
    if (this.loggedIn || !this.authAgent || !this.appPassword) return;

    // Resolve PDS if not already known
    if (!this.pdsUrl) {
      this.pdsUrl = await resolvePdsEndpoint(this.handle);
      // Re-create auth agent with resolved PDS
      this.authAgent = new BskyAgent({ service: this.pdsUrl });
    }

    await this.authAgent.login({ identifier: this.handle, password: this.appPassword });
    this.loggedIn = true;
  }

  /** Get the authenticated agent (for writing). Throws if not configured. */
  getAgent(): BskyAgent {
    if (!this.authAgent) throw new Error('No app password configured — read-only client');
    return this.authAgent;
  }

  isAuthenticated(): boolean {
    return this.loggedIn;
  }

  // ── Read operations (public API, no auth needed) ───────────────────────

  async getProfile(actor?: string) {
    const resp = await this.publicAgent.api.app.bsky.actor.getProfile({
      actor: actor ?? this.handle,
    });
    return resp.data;
  }

  async getAuthorFeed(actor: string, cursor?: string, filter: string = 'posts_with_replies') {
    const resp = await this.publicAgent.api.app.bsky.feed.getAuthorFeed({
      actor, limit: 50, cursor, filter,
    });
    return { feed: resp.data.feed, cursor: resp.data.cursor };
  }

  /** Get followers of an actor (public API) */
  async getFollowers(actor: string, cursor?: string) {
    const resp = await this.publicAgent.api.app.bsky.graph.getFollowers({
      actor, cursor, limit: 50,
    });
    return { followers: resp.data.followers, cursor: resp.data.cursor };
  }

  /** Get a post thread (parent chain + replies) */
  async getPostThread(uri: string, depth: number = 6) {
    const resp = await this.publicAgent.api.app.bsky.feed.getPostThread({
      uri, depth, parentHeight: 10,
    });
    return resp.data.thread;
  }

  /** Get the home timeline (posts from people you follow). Requires auth. */
  async getTimeline(cursor?: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required for timeline');
    const resp = await this.authAgent.api.app.bsky.feed.getTimeline({
      limit: 50, cursor,
    });
    return { feed: resp.data.feed, cursor: resp.data.cursor };
  }

  async searchPosts(query: string, cursor?: string) {
    // Search requires auth on some endpoints
    await this.login();
    const agent = this.authAgent ?? this.publicAgent;
    const resp = await agent.api.app.bsky.feed.searchPosts({
      q: query, limit: 50, cursor,
    });
    return { posts: resp.data.posts, cursor: resp.data.cursor };
  }

  async searchActors(term: string) {
    const resp = await this.publicAgent.api.app.bsky.actor.searchActors({
      term, limit: 8,
    });
    return resp.data.actors;
  }

  // ── Authenticated operations (require login) ──────────────────────────

  async getActorLikes(actor: string, cursor?: string) {
    await this.login();
    const agent = this.authAgent ?? this.publicAgent;
    const resp = await agent.api.app.bsky.feed.getActorLikes({
      actor, limit: 50, cursor,
    });
    return { feed: resp.data.feed, cursor: resp.data.cursor };
  }

  async getFollows(actor: string, cursor?: string) {
    await this.login();
    const agent = this.authAgent ?? this.publicAgent;
    const resp = await agent.api.app.bsky.graph.getFollows({
      actor, cursor, limit: 100,
    });
    return { follows: resp.data.follows, cursor: resp.data.cursor };
  }

  // ── Write operations (like, repost, reply) ─────────────────────────────

  async like(uri: string, cid: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required');
    return this.authAgent.like(uri, cid);
  }

  async unlike(likeUri: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required');
    return this.authAgent.deleteLike(likeUri);
  }

  async repost(uri: string, cid: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required');
    return this.authAgent.repost(uri, cid);
  }

  async unrepost(repostUri: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required');
    return this.authAgent.deleteRepost(repostUri);
  }

  async getNotifications(cursor?: string) {
    await this.login();
    if (!this.authAgent) throw new Error('Auth required');
    const resp = await this.authAgent.api.app.bsky.notification.listNotifications({
      limit: 50, cursor,
    });
    return { notifications: resp.data.notifications, cursor: resp.data.cursor };
  }

  getHandle() { return this.handle; }
}
