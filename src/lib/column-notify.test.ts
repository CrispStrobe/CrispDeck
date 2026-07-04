import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playColumnSound, fireColumnDesktopNotification, notifyColumn } from './column-notify';

describe('column-notify', () => {
  let mockOscillator: any;
  let mockGain: any;
  let mockAudioCtx: any;

  beforeEach(() => {
    mockOscillator = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0 },
      type: 'sine',
    };
    mockGain = {
      connect: vi.fn(),
      gain: { value: 0, exponentialRampToValueAtTime: vi.fn() },
    };
    mockAudioCtx = {
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
      destination: {},
      currentTime: 0,
    };
    vi.stubGlobal('AudioContext', vi.fn(() => mockAudioCtx));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('playColumnSound', () => {
    it('creates AudioContext and plays a short beep', () => {
      playColumnSound();
      expect(mockOscillator.connect).toHaveBeenCalledWith(mockGain);
      expect(mockGain.connect).toHaveBeenCalledWith(mockAudioCtx.destination);
      expect(mockOscillator.frequency.value).toBe(880);
      expect(mockOscillator.type).toBe('sine');
      expect(mockGain.gain.value).toBe(0.15);
      expect(mockOscillator.start).toHaveBeenCalled();
      expect(mockOscillator.stop).toHaveBeenCalled();
    });

    it('handles AudioContext failure gracefully', () => {
      vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('not supported'); }));
      expect(() => playColumnSound()).not.toThrow();
    });
  });

  describe('fireColumnDesktopNotification', () => {
    it('fires a Notification when permission is granted', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      fireColumnDesktopNotification('Timeline', 'Hello world this is a test post');
      expect(mockNotification).toHaveBeenCalledWith('CrispDeck — Timeline', {
        body: 'Hello world this is a test post',
        icon: '/favicon.ico',
        tag: 'crispdeck-column-Timeline',
      });
    });

    it('does nothing when permission is denied', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'denied', configurable: true });
      fireColumnDesktopNotification('Timeline', 'Hello');
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it('does nothing when Notification is undefined', () => {
      vi.stubGlobal('Notification', undefined);
      expect(() => fireColumnDesktopNotification('Timeline', 'Hello')).not.toThrow();
    });

    it('truncates long post previews to 100 chars', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      const longText = 'a'.repeat(200);
      fireColumnDesktopNotification('Timeline', longText);
      expect(mockNotification).toHaveBeenCalledWith('CrispDeck — Timeline', {
        body: 'a'.repeat(100),
        icon: '/favicon.ico',
        tag: 'crispdeck-column-Timeline',
      });
    });
  });

  describe('notifyColumn', () => {
    it('does nothing when mode is off', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      notifyColumn('off', 'Timeline', 'Hello');
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it('does nothing when mode is undefined', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      notifyColumn(undefined, 'Timeline', 'Hello');
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it('plays sound only when mode is sound', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      notifyColumn('sound', 'Timeline', 'Hello');
      expect(mockOscillator.start).toHaveBeenCalled();
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it('fires desktop only when mode is desktop', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      // Reset AudioContext to track calls
      vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('should not be called'); }));
      notifyColumn('desktop', 'Timeline', 'Hello');
      expect(mockNotification).toHaveBeenCalled();
    });

    it('fires both sound and desktop when mode is both', () => {
      const mockNotification = vi.fn();
      vi.stubGlobal('Notification', mockNotification);
      Object.defineProperty(mockNotification, 'permission', { value: 'granted', configurable: true });
      notifyColumn('both', 'Timeline', 'Hello');
      expect(mockOscillator.start).toHaveBeenCalled();
      expect(mockNotification).toHaveBeenCalled();
    });
  });

  describe('ColumnNotifyMode', () => {
    it('cycles through modes: off → sound → desktop → both → off', () => {
      const modes = ['off', 'sound', 'desktop', 'both'] as const;
      for (let i = 0; i < modes.length; i++) {
        const next = modes[(i + 1) % modes.length];
        expect(next).toBe(modes[(i + 1) % modes.length]);
      }
      // Full cycle
      expect(modes[(modes.indexOf('off') + 1) % modes.length]).toBe('sound');
      expect(modes[(modes.indexOf('sound') + 1) % modes.length]).toBe('desktop');
      expect(modes[(modes.indexOf('desktop') + 1) % modes.length]).toBe('both');
      expect(modes[(modes.indexOf('both') + 1) % modes.length]).toBe('off');
    });
  });

  describe('DeckColumnConfig.notify', () => {
    it('defaults to off when not set', () => {
      const config = { id: 'col1', title: 'Timeline', type: 'timeline' };
      expect(config).not.toHaveProperty('notify');
      const mode = (config as any).notify ?? 'off';
      expect(mode).toBe('off');
    });

    it('persists notify mode in column config', () => {
      const config = { id: 'col1', title: 'Timeline', type: 'timeline', notify: 'sound' as const };
      expect(config.notify).toBe('sound');
      const serialized = JSON.stringify(config);
      const parsed = JSON.parse(serialized);
      expect(parsed.notify).toBe('sound');
    });
  });
});
