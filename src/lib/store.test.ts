/**
 * Tests for store.ts — Tauri plugin-store wrapper.
 * Since this is Tauri-only, we test the API contract and defaults.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the Tauri store plugin
vi.mock('@tauri-apps/plugin-store', () => {
  const store: Record<string, unknown> = {};
  return {
    load: vi.fn().mockResolvedValue({
      get: vi.fn((key: string) => Promise.resolve(store[key])),
      set: vi.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve(); }),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

import { getStore, saveSetting, getSetting } from './store';

describe('store', () => {
  it('getStore returns a store object', async () => {
    const store = await getStore();
    expect(store).toBeTruthy();
    expect(typeof store.get).toBe('function');
    expect(typeof store.set).toBe('function');
    expect(typeof store.save).toBe('function');
  });

  it('saveSetting stores and persists a value', async () => {
    await saveSetting('test-key', 'test-value');
    const store = await getStore();
    expect(store.set).toHaveBeenCalledWith('test-key', 'test-value');
    expect(store.save).toHaveBeenCalled();
  });

  it('getSetting returns default when key not set', async () => {
    const result = await getSetting('nonexistent-key', 'default');
    expect(result).toBe('default');
  });

  it('getSetting returns stored value', async () => {
    // Store a value first
    const store = await getStore();
    await store.set('existing', 42);
    vi.mocked(store.get).mockResolvedValueOnce(42);

    const result = await getSetting('existing', 0);
    expect(result).toBe(42);
  });

  it('getSetting handles null as missing', async () => {
    const store = await getStore();
    vi.mocked(store.get).mockResolvedValueOnce(null);

    const result = await getSetting('null-key', 'fallback');
    expect(result).toBe('fallback');
  });
});
