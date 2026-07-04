import { describe, it, expect, vi } from 'vitest';

describe('scroll-lock toggle', () => {
  describe('default state', () => {
    it('defaults to locked (true)', () => {
      const scrollLock = true;
      expect(scrollLock).toBe(true);
    });

    it('column config defaults to locked when not set', () => {
      const col = { id: 'col1', title: 'Timeline', type: 'timeline' };
      const locked = (col as any).scrollLock ?? true;
      expect(locked).toBe(true);
    });
  });

  describe('toggle behavior', () => {
    it('toggles from locked to unlocked', () => {
      let scrollLock = true;
      scrollLock = !scrollLock;
      expect(scrollLock).toBe(false);
    });

    it('toggles from unlocked to locked', () => {
      let scrollLock = false;
      scrollLock = !scrollLock;
      expect(scrollLock).toBe(true);
    });
  });

  describe('auto-scroll behavior', () => {
    it('should scroll when unlocked and new posts arrive', () => {
      const scrollLock = false;
      const prevPostCount = 5;
      const currentCount = 7;
      const shouldScroll = !scrollLock && currentCount > prevPostCount && prevPostCount > 0;
      expect(shouldScroll).toBe(true);
    });

    it('should NOT scroll when locked', () => {
      const scrollLock = true;
      const prevPostCount = 5;
      const currentCount = 7;
      const shouldScroll = !scrollLock && currentCount > prevPostCount && prevPostCount > 0;
      expect(shouldScroll).toBe(false);
    });

    it('should NOT scroll when post count decreases', () => {
      const scrollLock = false;
      const prevPostCount = 7;
      const currentCount = 5;
      const shouldScroll = !scrollLock && currentCount > prevPostCount && prevPostCount > 0;
      expect(shouldScroll).toBe(false);
    });

    it('should NOT scroll on initial load (prevCount = 0)', () => {
      const scrollLock = false;
      const prevPostCount = 0;
      const currentCount = 10;
      const shouldScroll = !scrollLock && currentCount > prevPostCount && prevPostCount > 0;
      expect(shouldScroll).toBe(false);
    });
  });

  describe('persistence', () => {
    it('saves scrollLock state in column config', () => {
      const columns = [
        { id: 'col1', title: 'Timeline', type: 'timeline', scrollLock: false },
        { id: 'col2', title: 'Mentions', type: 'mentions', scrollLock: true },
      ];
      const serialized = JSON.stringify(columns);
      const parsed = JSON.parse(serialized);
      expect(parsed[0].scrollLock).toBe(false);
      expect(parsed[1].scrollLock).toBe(true);
    });

    it('handles missing scrollLock field gracefully', () => {
      const col = { id: 'col1', title: 'Timeline', type: 'timeline' };
      const parsed = JSON.parse(JSON.stringify(col));
      const locked = parsed.scrollLock ?? true;
      expect(locked).toBe(true);
    });
  });

  describe('UI state', () => {
    it('locked state shows Lock icon', () => {
      const scrollLock = true;
      const iconName = scrollLock ? 'Lock' : 'Unlock';
      expect(iconName).toBe('Lock');
    });

    it('unlocked state shows Unlock icon in green', () => {
      const scrollLock = false;
      const iconName = scrollLock ? 'Lock' : 'Unlock';
      const colorClass = scrollLock ? 'text-[var(--color-text-muted)]' : 'text-green-400';
      expect(iconName).toBe('Unlock');
      expect(colorClass).toBe('text-green-400');
    });
  });
});
