import { BskyAgent, type AppBskyFeedDefs } from '@atproto/api';

export class BlueskyClient {
  private agent: BskyAgent;
  private loggedIn = false;
  private handle: string;
  private appPassword: string;

  constructor(handle: string, appPassword: string) {
    this.handle = handle;
    this.appPassword = appPassword;
    this.agent = new BskyAgent({ service: 'https://bsky.social' });
  }

  async login(): Promise<void> {
    if (this.loggedIn) return;
    await this.agent.login({ identifier: this.handle, password: this.appPassword });
    this.loggedIn = true;
  }

  async getProfile(actor?: string) {
    await this.login();
    const resp = await this.agent.api.app.bsky.actor.getProfile({ actor: actor ?? this.handle });
    return resp.data;
  }

  async getAuthorFeed(actor: string, cursor?: string, filter: string = 'posts_with_replies') {
    await this.login();
    const resp = await this.agent.api.app.bsky.feed.getAuthorFeed({
      actor, limit: 50, cursor, filter,
    });
    return { feed: resp.data.feed, cursor: resp.data.cursor };
  }

  async getActorLikes(actor: string, cursor?: string) {
    await this.login();
    const resp = await this.agent.api.app.bsky.feed.getActorLikes({
      actor, limit: 50, cursor,
    });
    return { feed: resp.data.feed, cursor: resp.data.cursor };
  }

  async getFollows(actor: string, cursor?: string) {
    await this.login();
    const resp = await this.agent.api.app.bsky.graph.getFollows({
      actor, cursor, limit: 100,
    });
    return { follows: resp.data.follows, cursor: resp.data.cursor };
  }

  async searchPosts(query: string, cursor?: string) {
    await this.login();
    const resp = await this.agent.api.app.bsky.feed.searchPosts({
      q: query, limit: 50, cursor,
    });
    return { posts: resp.data.posts, cursor: resp.data.cursor };
  }

  async searchActors(term: string) {
    await this.login();
    const resp = await this.agent.api.app.bsky.actor.searchActors({
      term, limit: 8,
    });
    return resp.data.actors;
  }

  getHandle() { return this.handle; }
  getAgent() { return this.agent; }
}
