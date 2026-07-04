import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/toast.svelte', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { tryLoad, tryAction, tryWrite } from './page-error';
import { toast } from '$lib/toast.svelte';

describe('page-error utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tryLoad', () => {
    it('returns result on success', async () => {
      const result = await tryLoad(() => Promise.resolve(['post1', 'post2']), []);
      expect(result).toEqual(['post1', 'post2']);
    });

    it('returns fallback on failure', async () => {
      const result = await tryLoad(() => Promise.reject(new Error('network')), []);
      expect(result).toEqual([]);
    });

    it('shows toast with context on failure', async () => {
      await tryLoad(() => Promise.reject(new Error('fail')), null, 'notifications');
      expect(toast.error).toHaveBeenCalledWith('Failed to load notifications');
    });

    it('shows generic toast when no context', async () => {
      await tryLoad(() => Promise.reject(new Error('fail')), null);
      expect(toast.error).toHaveBeenCalledWith('Loading failed');
    });

    it('does not show toast on success', async () => {
      await tryLoad(() => Promise.resolve('ok'), '');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('supports any return type', async () => {
      const num = await tryLoad(() => Promise.resolve(42), 0);
      expect(num).toBe(42);
      const obj = await tryLoad(() => Promise.resolve({ id: 1 }), { id: 0 });
      expect(obj.id).toBe(1);
    });
  });

  describe('tryAction', () => {
    it('returns true on success', async () => {
      const ok = await tryAction(() => Promise.resolve(), 'Like');
      expect(ok).toBe(true);
    });

    it('returns false on failure', async () => {
      const ok = await tryAction(() => Promise.reject(new Error('auth')), 'Like');
      expect(ok).toBe(false);
    });

    it('shows toast with action name on failure', async () => {
      await tryAction(() => Promise.reject(new Error('401')), 'Follow');
      expect(toast.error).toHaveBeenCalledWith('Follow failed');
    });
  });

  describe('tryWrite', () => {
    it('returns true and shows success toast', async () => {
      const ok = await tryWrite(() => Promise.resolve(), 'Draft saved', 'save draft');
      expect(ok).toBe(true);
      expect(toast.success).toHaveBeenCalledWith('Draft saved');
    });

    it('returns false and shows error toast on failure', async () => {
      const ok = await tryWrite(() => Promise.reject(new Error('disk')), 'Saved', 'save');
      expect(ok).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to save');
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
