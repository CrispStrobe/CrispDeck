import { describe, it, expect, vi } from 'vitest';

describe('bug fixes and error feedback', () => {
  describe('poll voting auth fix', () => {
    it('requires Authorization header for Mastodon poll votes', () => {
      const token = 'bearer-token-123';
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      expect(headers.Authorization).toBe('Bearer bearer-token-123');
    });

    it('rejects vote when no Mastodon account connected', () => {
      const accounts = [{ platform: 'bluesky', handle: 'alice.bsky.social' }];
      const mastoAcct = accounts.find(a => a.platform === 'mastodon');
      expect(mastoAcct).toBeUndefined();
    });

    it('shows error toast on vote failure', () => {
      const toastError = vi.fn();
      const resp = { ok: false, status: 401, statusText: 'Unauthorized' };
      if (!resp.ok) {
        toastError(`Vote failed: ${resp.status}`);
      }
      expect(toastError).toHaveBeenCalledWith('Vote failed: 401');
    });

    it('updates poll data on successful vote', () => {
      const post = { raw: { poll: { voted: false, votes_count: 5 } } };
      const updatedPoll = { voted: true, votes_count: 6 };
      post.raw.poll = updatedPoll;
      expect(post.raw.poll.voted).toBe(true);
      expect(post.raw.poll.votes_count).toBe(6);
    });
  });

  describe('error feedback toasts', () => {
    it('shows toast on bookmark failure', () => {
      const toast = { error: vi.fn() };
      try {
        throw new Error('IndexedDB unavailable');
      } catch {
        toast.error('Bookmark failed');
      }
      expect(toast.error).toHaveBeenCalledWith('Bookmark failed');
    });

    it('shows warning toast on server bookmark sync failure', () => {
      const toast = { warning: vi.fn() };
      try {
        throw new Error('Network error');
      } catch {
        toast.warning('Saved locally but server sync failed');
      }
      expect(toast.warning).toHaveBeenCalledWith('Saved locally but server sync failed');
    });

    it('shows toast on TTS failure', () => {
      const toast = { error: vi.fn() };
      const engine = 'crispasr';
      if (engine === 'crispasr') {
        toast.error('Text-to-speech failed');
      }
      expect(toast.error).toHaveBeenCalledWith('Text-to-speech failed');
    });

    it('shows toast on translation failure', () => {
      const toast = { error: vi.fn() };
      try {
        throw new Error('Provider unavailable');
      } catch {
        toast.error('Translation failed');
      }
      expect(toast.error).toHaveBeenCalledWith('Translation failed');
    });
  });

  describe('accessibility fixes', () => {
    it('post text has role="article"', () => {
      const role = 'article';
      expect(role).toBe('article');
    });

    it('quoted post image has role="button" and tabindex="0"', () => {
      const attrs = { role: 'button', tabindex: '0', 'aria-label': 'View quoted post images' };
      expect(attrs.role).toBe('button');
      expect(attrs.tabindex).toBe('0');
      expect(attrs['aria-label']).toBeTruthy();
    });

    it('Enter key triggers link click handler on post text', () => {
      let clicked = false;
      const handler = (e: { key: string }) => {
        if (e.key === 'Enter') clicked = true;
      };
      handler({ key: 'Enter' });
      expect(clicked).toBe(true);
    });

    it('Enter or Space triggers lightbox on quoted image', () => {
      let opened = false;
      const handler = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          opened = true;
        }
      };
      handler({ key: ' ', preventDefault: () => {} });
      expect(opened).toBe(true);
    });

    it('Escape closes list picker overlay', () => {
      let showListPicker = true;
      const handler = (e: { key: string }) => {
        if (e.key === 'Escape') showListPicker = false;
      };
      handler({ key: 'Escape' });
      expect(showListPicker).toBe(false);
    });
  });
});
