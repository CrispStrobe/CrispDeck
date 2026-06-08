/**
 * Tests for db.ts — platform dispatch layer.
 * Verifies that the browser (non-Tauri) path delegates to browser-db.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock browser-db and platform
vi.mock('./browser-db', () => ({
  listAccounts: vi.fn().mockResolvedValue([]),
  addAccount: vi.fn().mockResolvedValue({ id: 1, platform: 'bluesky', handle: 'test' }),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
  updateAccount: vi.fn().mockResolvedValue(undefined),
  getDecryptedCredentials: vi.fn().mockResolvedValue('{}'),
  listIdentities: vi.fn().mockResolvedValue([]),
  createIdentity: vi.fn().mockResolvedValue({ id: 1, display_name: null, links: [], tags: [] }),
  updateIdentity: vi.fn().mockResolvedValue(undefined),
  deleteIdentity: vi.fn().mockResolvedValue(undefined),
  linkToIdentity: vi.fn().mockResolvedValue(undefined),
  unlinkFromIdentity: vi.fn().mockResolvedValue(undefined),
  confirmIdentity: vi.fn().mockResolvedValue(undefined),
  resolveHandle: vi.fn().mockResolvedValue(null),
  addTag: vi.fn().mockResolvedValue(undefined),
  removeTag: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./platform', () => ({
  isTauri: () => false,
}));

describe('db dispatch (browser mode)', () => {
  it('listAccounts delegates to browser-db', async () => {
    const { listAccounts } = await import('./db');
    const result = await listAccounts();
    expect(Array.isArray(result)).toBe(true);
  });

  it('addAccount delegates to browser-db', async () => {
    const { addAccount } = await import('./db');
    const result = await addAccount({
      platform: 'bluesky',
      handle: 'test.bsky.social',
      credentials: '{}',
    });
    expect(result).toHaveProperty('id');
  });

  it('deleteAccount delegates to browser-db', async () => {
    const { deleteAccount } = await import('./db');
    await expect(deleteAccount(1)).resolves.toBeUndefined();
  });

  it('listIdentities delegates to browser-db', async () => {
    const { listIdentities } = await import('./db');
    const result = await listIdentities();
    expect(Array.isArray(result)).toBe(true);
  });

  it('resolveHandle delegates to browser-db', async () => {
    const { resolveHandle } = await import('./db');
    const result = await resolveHandle('@alice', 'bluesky');
    expect(result).toBeNull();
  });

  it('createIdentity delegates to browser-db', async () => {
    const { createIdentity } = await import('./db');
    const result = await createIdentity({ display_name: 'Test' });
    expect(result).toHaveProperty('id');
  });
});

describe('db function signatures', () => {
  it('exports all expected account functions', async () => {
    const db = await import('./db');
    expect(typeof db.listAccounts).toBe('function');
    expect(typeof db.addAccount).toBe('function');
    expect(typeof db.updateAccount).toBe('function');
    expect(typeof db.deleteAccount).toBe('function');
    expect(typeof db.getDecryptedCredentials).toBe('function');
  });

  it('exports all expected identity functions', async () => {
    const db = await import('./db');
    expect(typeof db.listIdentities).toBe('function');
    expect(typeof db.createIdentity).toBe('function');
    expect(typeof db.updateIdentity).toBe('function');
    expect(typeof db.deleteIdentity).toBe('function');
    expect(typeof db.linkToIdentity).toBe('function');
    expect(typeof db.unlinkFromIdentity).toBe('function');
    expect(typeof db.confirmIdentity).toBe('function');
    expect(typeof db.resolveHandle).toBe('function');
  });
});
