import { createRestAPIClient, type mastodon } from 'masto';

export type MastodonPost = mastodon.v1.Status;

export class MastodonClient {
  private instanceUrl: string;
  private accessToken: string | null;
  private client: mastodon.rest.Client | null = null;

  constructor(instanceUrl: string, accessToken?: string) {
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    this.accessToken = accessToken ?? null;
    if (this.accessToken) {
      this.client = createRestAPIClient({
        url: this.instanceUrl,
        accessToken: this.accessToken,
      });
    }
  }

  private async fetchPublic<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.instanceUrl}${endpoint}`);
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Not found at ${this.instanceUrl}`);
      throw new Error(`Mastodon API error (${response.status}): ${response.statusText}`);
    }
    return response.json();
  }

  async getAccountByHandle(handle: string): Promise<mastodon.v1.Account> {
    const acct = handle.trim().replace(/^@/, '');
    return this.fetchPublic<mastodon.v1.Account>(`/api/v1/accounts/lookup?acct=${acct}`);
  }

  async getAccountStatuses(
    accountId: string,
    cursor?: string,
    excludeReplies?: boolean,
    excludeReposts?: boolean,
  ): Promise<MastodonPost[]> {
    const params = new URLSearchParams({ limit: '40' });
    if (cursor) params.set('max_id', cursor);
    if (excludeReplies) params.set('exclude_replies', 'true');
    if (excludeReposts) params.set('exclude_reblogs', 'true');
    return this.fetchPublic<MastodonPost[]>(
      `/api/v1/accounts/${accountId}/statuses?${params.toString()}`
    );
  }

  async verifyCredentials(): Promise<mastodon.v1.Account> {
    if (!this.client) throw new Error('Not authenticated');
    return this.client.v1.accounts.verifyCredentials();
  }

  async getFavourites(cursor?: string): Promise<MastodonPost[]> {
    if (!this.client) throw new Error('Not authenticated');
    const params: Record<string, unknown> = { limit: 40 };
    if (cursor) params.maxId = cursor;
    return this.client.v1.favourites.list(params as Parameters<typeof this.client.v1.favourites.list>[0]);
  }

  async getBookmarks(cursor?: string): Promise<MastodonPost[]> {
    if (!this.client) throw new Error('Not authenticated');
    const params: Record<string, unknown> = { limit: 40 };
    if (cursor) params.maxId = cursor;
    return this.client.v1.bookmarks.list(params as Parameters<typeof this.client.v1.bookmarks.list>[0]);
  }

  async getFollowing(accountId: string, cursor?: string) {
    const params = new URLSearchParams({ limit: '80' });
    if (cursor) params.set('max_id', cursor);
    return this.fetchPublic<mastodon.v1.Account[]>(
      `/api/v1/accounts/${accountId}/following?${params.toString()}`
    );
  }

  getInstanceUrl() { return this.instanceUrl; }
  isAuthenticated() { return !!this.client; }
}

/** Create a MastodonClient from a full handle like "user@mastodon.social" */
export function mastodonClientFromHandle(handle: string, accessToken?: string): MastodonClient {
  const clean = handle.trim().replace(/^@/, '');
  const parts = clean.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid Mastodon handle. Use format: user@instance.tld');
  }
  return new MastodonClient(`https://${parts[1]}`, accessToken);
}
