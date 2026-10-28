import { describe, it, expect, vi, beforeEach } from 'vitest';

const restore = vi.fn();
vi.mock('./bluesky-oauth', () => ({
  initBlueskyOAuth: async () => null,
  restoreBlueskyOAuthSession: (...args: unknown[]) => restore(...args),
}));
vi.mock('$lib/db', () => ({
  listAccounts: async () => [{ id: 1, platform: 'bluesky', did: 'did:plc:alice', handle: 'alice.bsky.social' }],
  getDecryptedCredentials: async () => JSON.stringify({ auth_method: 'oauth', did: 'did:plc:alice' }),
}));
vi.mock('./bluesky', () => ({
  BlueskyClient: class { static readOnly(handle: string) { return { handle }; } },
}));
import { initAllClients, invalidateClientCache } from './client-factory';
import { clearLogs, getLogs } from '$lib/debug-log';

beforeEach(() => {
  invalidateClientCache();
  clearLogs();
  restore.mockReset().mockResolvedValue({ status: 'expired' });
});

describe('an expired OAuth account', () => {
  it('keeps the account read-only and asks for explicit reconnection', async () => {
    const { accounts, clients } = await initAllClients();
    expect(accounts).toHaveLength(1);
    expect(clients.get(1)).toMatchObject({ accountId: 1, platform: 'bluesky', degraded: true });
    expect(clients.get(1)?.oauthAgent).toBeUndefined();
    expect(restore).toHaveBeenCalledWith('did:plc:alice');
    expect(getLogs().some((item) => item.message.includes('Reconnect in Settings'))).toBe(true);
  });
});
