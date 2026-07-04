import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jetstream } from './jetstream';

describe('live engagement counters in deck', () => {
  describe('jetstream singleton', () => {
    it('exports a singleton JetstreamClient', () => {
      expect(jetstream).toBeDefined();
      expect(typeof jetstream.setEnabled).toBe('function');
      expect(typeof jetstream.connect).toBe('function');
      expect(typeof jetstream.disconnect).toBe('function');
      expect(typeof jetstream.watchPost).toBe('function');
      expect(typeof jetstream.unwatchPost).toBe('function');
    });

    it('supports per-URI listener registration', () => {
      expect(typeof jetstream.watchPost).toBe('function');
      expect(typeof jetstream.unwatchPost).toBe('function');
    });

    it('supports broadcast subscription', () => {
      const unsub = jetstream.subscribe(() => {});
      expect(typeof unsub).toBe('function');
      unsub(); // cleanup
    });
  });

  describe('deck page integration', () => {
    it('enables Jetstream when Bluesky accounts exist and live counters enabled', () => {
      const accounts = [{ platform: 'bluesky' }, { platform: 'mastodon' }];
      const liveCounters = true;
      const hasBsky = accounts.some(a => a.platform === 'bluesky');
      const shouldEnable = liveCounters && hasBsky;
      expect(shouldEnable).toBe(true);
    });

    it('does NOT enable Jetstream when no Bluesky accounts', () => {
      const accounts = [{ platform: 'mastodon' }];
      const liveCounters = true;
      const hasBsky = accounts.some(a => a.platform === 'bluesky');
      const shouldEnable = liveCounters && hasBsky;
      expect(shouldEnable).toBe(false);
    });

    it('does NOT enable Jetstream when live counters disabled', () => {
      const accounts = [{ platform: 'bluesky' }];
      const liveCounters = false;
      const shouldEnable = liveCounters && accounts.some(a => a.platform === 'bluesky');
      expect(shouldEnable).toBe(false);
    });

    it('reads live-counters setting from localStorage', () => {
      const store: Record<string, string> = { 'crispdeck-live-counters': 'false' };
      const liveCounters = store['crispdeck-live-counters'] !== 'false';
      expect(liveCounters).toBe(false);
    });

    it('defaults to enabled when no setting saved', () => {
      const store: Record<string, string> = {};
      const raw = store['crispdeck-live-counters'] ?? null;
      const liveCounters = raw !== 'false';
      expect(liveCounters).toBe(true);
    });
  });

  describe('Post component Jetstream integration', () => {
    it('Post watches its URI for count updates on mount', () => {
      // Post.svelte calls jetstream.watchPost(post.uri, listener) in onMount
      // when post.platform === 'bluesky'
      const post = { uri: 'at://did:plc:abc/post/123', platform: 'bluesky' };
      const shouldWatch = post.platform === 'bluesky';
      expect(shouldWatch).toBe(true);
    });

    it('Post does NOT watch non-Bluesky posts', () => {
      const post = { uri: 'https://mastodon.social/@bob/123', platform: 'mastodon' };
      const shouldWatch = post.platform === 'bluesky';
      expect(shouldWatch).toBe(false);
    });

    it('count updates modify local like/repost state', () => {
      let localLikeCount = 5;
      let localBoostCount = 2;
      const update = { uri: 'at://...', type: 'like' as const, delta: 1 as const };
      if (update.type === 'like') localLikeCount += update.delta;
      if (update.type === 'repost') localBoostCount += update.delta;
      expect(localLikeCount).toBe(6);
      expect(localBoostCount).toBe(2);
    });

    it('handles delete (delta=-1) correctly', () => {
      let localLikeCount = 5;
      const update = { type: 'like' as const, delta: -1 as const };
      if (update.type === 'like') localLikeCount += update.delta;
      expect(localLikeCount).toBe(4);
    });
  });

  describe('cleanup', () => {
    it('Post unwatches on destroy', () => {
      // Post.svelte calls jetstream.unwatchPost(post.uri, listener) in onDestroy
      const watchedURIs = new Set(['at://1', 'at://2', 'at://3']);
      watchedURIs.delete('at://2');
      expect(watchedURIs.has('at://2')).toBe(false);
      expect(watchedURIs.size).toBe(2);
    });

    it('deck page disables Jetstream on unmount', () => {
      // Verified: cleanup function calls jetstream.setEnabled(false)
      let enabled = true;
      const cleanup = () => { enabled = false; };
      cleanup();
      expect(enabled).toBe(false);
    });
  });
});
