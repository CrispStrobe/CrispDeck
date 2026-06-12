/**
 * Threads API client — wraps Meta's official Threads API (Graph API).
 *
 * Auth: OAuth 2.0 via threads.net
 * Posting: Container-then-publish flow (create → poll → publish)
 * Reading: Own posts only (no home timeline endpoint exists)
 * Analytics: Per-post insights (views, likes, replies, reposts, quotes)
 *
 * Reference: https://developers.facebook.com/docs/threads
 */

import type { UnifiedPost } from '$lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThreadsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  user_id?: string;
}

export interface ThreadsProfile {
  id: string;
  username: string;
  name?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

export interface ThreadsPost {
  id: string;
  media_product_type?: string;
  media_type?: 'TEXT_POST' | 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REPOST_FACADE';
  media_url?: string;
  permalink?: string;
  owner?: { id: string };
  username?: string;
  text?: string;
  timestamp?: string;
  shortcode?: string;
  thumbnail_url?: string;
  children?: { data: Array<{ id: string }> };
  is_quote_post?: boolean;
  reposted_post?: ThreadsPost;
  quoted_post?: ThreadsPost;
}

export interface ThreadsInsight {
  name: string;
  title: string;
  description: string;
  period: string;
  values: Array<{ value: number }>;
  id: string;
}

export interface ThreadsContainerStatus {
  id: string;
  status: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  error_message?: string;
}

export type ThreadsMediaType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL';

// ── OAuth helpers ────────────────────────────────────────────────────────────

const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';
const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Build the OAuth authorization URL.
 * The user is redirected here to grant access.
 */
export function getThreadsAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_manage_insights',
    response_type: 'code',
    state,
  });
  return `${THREADS_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for a short-lived access token.
 */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<ThreadsTokenResponse> {
  const resp = await fetch(THREADS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_message || `Token exchange failed: ${resp.statusText}`);
  }

  // Parse as text first to preserve large user_id precision (exceeds Number.MAX_SAFE_INTEGER)
  const text = await resp.text();
  const parsed = JSON.parse(text);
  const userIdMatch = text.match(/"user_id"\s*:\s*(\d+)/);
  if (userIdMatch) parsed.user_id = userIdMatch[1];
  return parsed;
}

/**
 * Exchange a short-lived token for a long-lived token (58 days).
 * Must be done immediately after getting the short-lived token.
 */
export async function exchangeForLongLivedToken(
  clientSecret: string,
  shortLivedToken: string,
): Promise<ThreadsTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: clientSecret,
    access_token: shortLivedToken,
  });

  const resp = await fetch(`${THREADS_API_BASE}/access_token?${params.toString()}`);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_message || `Long-lived token exchange failed: ${resp.statusText}`);
  }

  return resp.json();
}

/**
 * Refresh a long-lived token (must be at least 24h old, not older than 58 days).
 */
export async function refreshLongLivedToken(token: string): Promise<ThreadsTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'th_refresh_token',
    access_token: token,
  });

  const resp = await fetch(`${THREADS_API_BASE}/access_token?${params.toString()}`);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_message || `Token refresh failed: ${resp.statusText}`);
  }

  return resp.json();
}

// ── Client ───────────────────────────────────────────────────────────────────

export class ThreadsClient {
  private accessToken: string;
  private userId: string;

  constructor(accessToken: string, userId: string) {
    this.accessToken = accessToken;
    this.userId = userId;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  getUserId(): string {
    return this.userId;
  }

  private async apiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${THREADS_API_BASE}${endpoint}`);
    url.searchParams.set('access_token', this.accessToken);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `Threads API error: ${resp.statusText}`);
    }
    return resp.json();
  }

  private async apiPost<T>(endpoint: string, body: Record<string, string>): Promise<T> {
    const resp = await fetch(`${THREADS_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: this.accessToken, ...body }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const code = err.error?.code;
      // Re-throw with error code for caller to handle retries
      const error = new Error(err.error?.message || `Threads API error: ${resp.statusText}`);
      (error as any).code = code;
      throw error;
    }
    return resp.json();
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async getProfile(): Promise<ThreadsProfile> {
    return this.apiGet<ThreadsProfile>(`/${this.userId}`, {
      fields: 'id,username,name,threads_profile_picture_url,threads_biography',
    });
  }

  // ── Reading own posts ────────────────────────────────────────────────────

  async getOwnPosts(limit = 25): Promise<ThreadsPost[]> {
    const resp = await this.apiGet<{ data: ThreadsPost[] }>(`/${this.userId}/threads`, {
      fields: 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,reposted_post,quoted_post',
      limit: String(limit),
    });
    return resp.data ?? [];
  }

  async getPost(postId: string): Promise<ThreadsPost> {
    return this.apiGet<ThreadsPost>(`/${postId}`, {
      fields: 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,reposted_post,quoted_post',
    });
  }

  async getReplies(postId: string): Promise<ThreadsPost[]> {
    const resp = await this.apiGet<{ data: ThreadsPost[] }>(`/${postId}/replies`, {
      fields: 'id,media_type,text,timestamp,username,permalink',
    });
    return resp.data ?? [];
  }

  async getMentions(limit = 25): Promise<ThreadsPost[]> {
    const resp = await this.apiGet<{ data: ThreadsPost[] }>(`/${this.userId}/mentions`, {
      fields: 'id,media_type,media_url,permalink,username,text,timestamp,thumbnail_url,is_quote_post',
      limit: String(limit),
    });
    return resp.data ?? [];
  }

  async keywordSearch(query: string, options: { searchType?: 'TOP' | 'RECENT'; mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO'; limit?: number } = {}): Promise<ThreadsPost[]> {
    const params: Record<string, string> = {
      q: query,
      fields: 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,thumbnail_url,is_quote_post',
    };
    if (options.searchType) params.search_type = options.searchType;
    if (options.mediaType) params.media_type = options.mediaType;
    if (options.limit) params.limit = String(options.limit);
    const resp = await this.apiGet<{ data: ThreadsPost[] }>('/keyword_search', params);
    return resp.data ?? [];
  }

  async getUserPosts(username: string, limit = 25): Promise<ThreadsPost[]> {
    // Use keyword search filtered by author to get a specific user's posts
    const params: Record<string, string> = {
      q: '*',
      author_username: username.replace(/^@/, ''),
      fields: 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,thumbnail_url,is_quote_post',
      limit: String(limit),
    };
    const resp = await this.apiGet<{ data: ThreadsPost[] }>('/keyword_search', params);
    return resp.data ?? [];
  }

  // ── Publishing (container-then-publish) ──────────────────────────────────

  /**
   * Create a text-only post container.
   */
  async createTextContainer(text: string, replyToId?: string): Promise<string> {
    const body: Record<string, string> = {
      media_type: 'TEXT',
      text,
    };
    if (replyToId) body.reply_to_id = replyToId;

    const resp = await this.apiPost<{ id: string }>(`/${this.userId}/threads`, body);
    return resp.id;
  }

  /**
   * Create an image post container.
   * imageUrl must be a publicly accessible HTTPS URL.
   */
  async createImageContainer(imageUrl: string, text?: string, replyToId?: string): Promise<string> {
    const body: Record<string, string> = {
      media_type: 'IMAGE',
      image_url: imageUrl,
    };
    if (text) body.text = text;
    if (replyToId) body.reply_to_id = replyToId;

    const resp = await this.apiPost<{ id: string }>(`/${this.userId}/threads`, body);
    return resp.id;
  }

  /**
   * Create a video post container.
   * videoUrl must be a publicly accessible HTTPS URL (MP4/MOV only).
   */
  async createVideoContainer(videoUrl: string, text?: string, replyToId?: string): Promise<string> {
    const body: Record<string, string> = {
      media_type: 'VIDEO',
      video_url: videoUrl,
    };
    if (text) body.text = text;
    if (replyToId) body.reply_to_id = replyToId;

    const resp = await this.apiPost<{ id: string }>(`/${this.userId}/threads`, body);
    return resp.id;
  }

  /**
   * Create a carousel item container (for multi-image posts).
   * Each item must be IMAGE or VIDEO with is_carousel_item=true.
   */
  async createCarouselItemContainer(
    mediaType: 'IMAGE' | 'VIDEO',
    mediaUrl: string,
  ): Promise<string> {
    const body: Record<string, string> = {
      media_type: mediaType,
      is_carousel_item: 'true',
    };
    if (mediaType === 'IMAGE') body.image_url = mediaUrl;
    else body.video_url = mediaUrl;

    const resp = await this.apiPost<{ id: string }>(`/${this.userId}/threads`, body);
    return resp.id;
  }

  /**
   * Create a carousel container referencing child item IDs.
   */
  async createCarouselContainer(childIds: string[], text?: string): Promise<string> {
    const body: Record<string, string> = {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
    };
    if (text) body.text = text;

    const resp = await this.apiPost<{ id: string }>(`/${this.userId}/threads`, body);
    return resp.id;
  }

  /**
   * Poll a container's status until it's ready for publishing.
   * Retries with exponential backoff for API error code 24 (propagation delay).
   */
  async waitForContainer(containerId: string, maxAttempts = 30): Promise<ThreadsContainerStatus> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.apiGet<ThreadsContainerStatus>(`/${containerId}`, {
        fields: 'id,status,error_message',
      });

      if (status.status === 'FINISHED') return status;
      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        throw new Error(`Container ${containerId} failed: ${status.error_message || status.status}`);
      }

      // IN_PROGRESS — wait and retry (2s base with slight backoff)
      await new Promise(r => setTimeout(r, Math.min(2000 + attempt * 500, 10000)));
    }

    throw new Error(`Container ${containerId} timed out after ${maxAttempts} attempts`);
  }

  /**
   * Publish a container. Must be FINISHED status first.
   */
  async publishContainer(containerId: string): Promise<{ id: string }> {
    return this.apiPost<{ id: string }>(`/${this.userId}/threads_publish`, {
      creation_id: containerId,
    });
  }

  /**
   * Full publish flow: create container → wait → publish.
   * Handles retry for Meta error code 24 (propagation delay).
   */
  async publishText(text: string, replyToId?: string): Promise<{ id: string; permalink?: string }> {
    const containerId = await this.createTextContainer(text, replyToId);
    await this.waitForContainer(containerId);

    let retries = 3;
    while (retries > 0) {
      try {
        const result = await this.publishContainer(containerId);
        return result;
      } catch (e: any) {
        if (e.code === 24 && retries > 1) {
          retries--;
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw e;
      }
    }
    throw new Error('Failed to publish after retries');
  }

  // ── Analytics / Insights ─────────────────────────────────────────────────

  /**
   * Get insights for a specific post.
   * Available metrics: views, likes, replies, reposts, quotes
   */
  async getPostInsights(postId: string): Promise<ThreadsInsight[]> {
    const resp = await this.apiGet<{ data: ThreadsInsight[] }>(`/${postId}/insights`, {
      metric: 'views,likes,replies,reposts,quotes',
    });
    return resp.data ?? [];
  }

  /**
   * Get account-level insights over a time period.
   * Available metrics: views, likes, replies, reposts, quotes, followers_count, follower_demographics
   */
  async getAccountInsights(since: number, until: number): Promise<ThreadsInsight[]> {
    const resp = await this.apiGet<{ data: ThreadsInsight[] }>(`/${this.userId}/threads_insights`, {
      metric: 'views,likes,replies,reposts,quotes',
      since: String(since),
      until: String(until),
    });
    return resp.data ?? [];
  }

  // ── Post normalization ───────────────────────────────────────────────────

  /**
   * Convert a Threads post to a UnifiedPost.
   */
  normalizePost(post: ThreadsPost): UnifiedPost {
    return {
      uri: post.permalink ?? `threads://${post.id}`,
      text: post.text ?? '',
      author: {
        handle: post.username ? `@${post.username}` : 'unknown',
        displayName: post.username,
        avatar: undefined,
      },
      createdAt: post.timestamp ?? new Date().toISOString(),
      platform: 'threads',
      isRepost: post.media_type === 'REPOST_FACADE',
      embeds: post.media_url ? { type: post.media_type, url: post.media_url, thumbnail: post.thumbnail_url } : undefined,
      raw: post,
    };
  }
}

// ── OAuth config storage (localStorage) ──────────────────────────────────────

const THREADS_CONFIG_KEY = 'crispdeck-threads-config';

export interface ThreadsConfig {
  /** Custom app credentials (advanced users). Omit to use server proxy. */
  client_id?: string;
  client_secret?: string;
  redirect_uri: string;
  /** Whether to use the server proxy (default: true if no client_id) */
  useProxy?: boolean;
}

export function getThreadsConfig(): ThreadsConfig | null {
  const raw = localStorage.getItem(THREADS_CONFIG_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setThreadsConfig(config: ThreadsConfig): void {
  localStorage.setItem(THREADS_CONFIG_KEY, JSON.stringify(config));
}

// ── Server proxy helpers ────────────────────────────────────────────────────

/**
 * Check if the server-side Threads proxy is available and configured.
 * Returns the auth URL if configured, null otherwise.
 */
export async function getProxyAuthUrl(redirectUri: string, state: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `/api/threads/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.configured) return null;
    return data.auth_url;
  } catch {
    return null;
  }
}

/**
 * Exchange an authorization code for tokens via the server proxy.
 * The client_secret never leaves the server.
 */
export async function proxyExchangeToken(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; user_id: string; long_lived: boolean }> {
  const resp = await fetch('/api/threads/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri, action: 'exchange' }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Token exchange failed: ${resp.statusText}`);
  }

  return resp.json();
}

/**
 * Refresh a long-lived token via the server proxy.
 */
export async function proxyRefreshToken(
  accessToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const resp = await fetch('/api/threads/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, action: 'refresh' }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Token refresh failed: ${resp.statusText}`);
  }

  return resp.json();
}

/**
 * Check if Threads connection is available (either via proxy or custom credentials).
 */
export async function isThreadsAvailable(): Promise<boolean> {
  const config = getThreadsConfig();
  if (config?.client_id && config?.client_secret) return true;
  // Check if proxy is configured
  try {
    const resp = await fetch('/api/threads/auth-url?redirect_uri=check&state=check');
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.configured === true;
  } catch {
    return false;
  }
}
