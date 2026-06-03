import { BskyAgent, type AppBskyFeedDefs } from '@atproto/api';

const PUBLIC_API = 'https://public.api.bsky.app';
const AUTH_API = 'https://bsky.social';

/**
 * Bluesky client with two modes:
 * - Public (no auth): reading profiles, feeds, searching — uses public.api.bsky.app
 * - Authenticated: posting, likes, follows — uses bsky.social with app password
 */
export class BlueskyClient {
  private publicAgent: BskyAgent;
  private authAgent: BskyAgent | null = null;
  private loggedIn = false;
  private handle: string;
  private appPassword: string | null;

  constructor(handle: string, appPassword?: string) {
    this.handle = handle;
    this.appPassword = appPassword ?? null;
    this.publicAgent = new BskyAgent({ service: PUBLIC_API });
    if (this.appPassword) {
      this.authAgent = new BskyAgent({ service: AUTH_API });
    }
  }

  /** Create a read-only client (no app password needed) */
  static readOnly(handle: string): BlueskyClient {
    return new BlueskyClient(handle);
  }

  async login(): Promise<void> {
    if (this.loggedIn || !this.authAgent || !this.appPassword) return;
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

  getHandle() { return this.handle; }
}
