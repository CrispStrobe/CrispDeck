import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('$lib/platform', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mock.fetch }));
import { ThreadsClient } from './threads';

describe('Threads native transport', () => {
  it('loads the account feed through native HTTP rather than WKWebView fetch', async () => {
    mock.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: '1' }] }) });
    const posts = await new ThreadsClient('test-token', '123').getOwnPosts(10);
    expect(posts.map(post => post.id)).toEqual(['1']);
    const url = new URL(mock.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1.0/123/threads');
    expect(url.searchParams.get('access_token')).toBe('test-token');
  });
});
