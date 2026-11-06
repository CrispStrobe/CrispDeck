import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ backend: 'local' as 'local' | 'keychain', create: vi.fn(async () => ({})) }));
vi.mock('$lib/platform', () => ({ isTauri: () => true }));
vi.mock('$lib/db', () => ({ getCredentialBackend: async () => ({ backend: mocks.backend, macosKeychainChoices: ['login', 'path'] }) }));
vi.mock('./macos-oauth', () => ({ createMacOAuthClient: mocks.create }));

import { getOAuthClient } from './bluesky-oauth';

it('uses the selected Mac storage mode and recreates the client after a setting change', async () => {
  await getOAuthClient();
  expect(mocks.create).toHaveBeenLastCalledWith(expect.anything(), 'local', 'login');
  mocks.backend = 'keychain';
  window.dispatchEvent(new Event('crispdeck:credential-storage-changed'));
  await getOAuthClient();
  expect(mocks.create).toHaveBeenLastCalledWith(expect.anything(), 'keychain', 'login');
});
