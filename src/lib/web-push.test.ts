import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { urlBase64ToUint8Array, subscribeWebPush, unsubscribeWebPush, getPushSubscription } from './push-notifications';

describe('urlBase64ToUint8Array', () => {
  it('converts a base64url string to Uint8Array', () => {
    // "AQAB" in base64 = [1, 0, 1]
    const result = urlBase64ToUint8Array('AQAB');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 0, 1]);
  });

  it('handles base64url characters (- and _)', () => {
    // base64url uses - instead of + and _ instead of /
    const input = 'A-B_'; // equivalent to base64 'A+B/'
    const result = urlBase64ToUint8Array(input);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('pads correctly when length % 4 != 0', () => {
    // 'AQ' needs padding to 'AQ=='
    const result = urlBase64ToUint8Array('AQ');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1]);
  });

  it('handles empty string', () => {
    const result = urlBase64ToUint8Array('');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('handles a realistic VAPID key', () => {
    // A typical VAPID public key (65 bytes uncompressed P-256 point)
    const vapidKey = 'BNbxGYNMhEIi9eGea1OlbRs5jZBRaUl4wQ41XNXfOaXuMajCpECRoKxtiUFfyamq16gLVujEYHhEIFGwIBuZalc';
    const result = urlBase64ToUint8Array(vapidKey);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(65);
  });
});

describe('subscribeWebPush', () => {
  const mockSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'testkey', auth: 'testauth' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    // Mock navigator.serviceWorker
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(null),
              subscribe: vi.fn().mockResolvedValue(mockSubscription),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    // Mock PushManager
    (globalThis as any).PushManager = class {};
  });

  afterEach(() => {
    delete (globalThis as any).PushManager;
  });

  it('returns null if serviceWorker not supported', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });
    const result = await subscribeWebPush('testkey');
    expect(result).toBeNull();
  });

  it('returns null if PushManager not supported', async () => {
    delete (globalThis as any).PushManager;
    const result = await subscribeWebPush('testkey');
    expect(result).toBeNull();
  });

  it('returns existing subscription if already subscribed', async () => {
    const existingSub = {
      endpoint: 'https://existing.test',
      toJSON: () => ({ endpoint: 'https://existing.test', keys: {} }),
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(existingSub),
              subscribe: vi.fn(),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await subscribeWebPush('testkey');
    expect(result).toEqual({ endpoint: 'https://existing.test', keys: {} });
  });

  it('creates new subscription when none exists', async () => {
    const result = await subscribeWebPush('AQAB');
    expect(result).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'testkey', auth: 'testauth' },
    });
  });
});

describe('unsubscribeWebPush', () => {
  it('returns false if serviceWorker not supported', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });
    const result = await unsubscribeWebPush();
    expect(result).toBe(false);
  });

  it('returns true if no subscription exists', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(null),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await unsubscribeWebPush();
    expect(result).toBe(true);
  });

  it('unsubscribes existing subscription', async () => {
    const mockUnsub = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue({ unsubscribe: mockUnsub }),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await unsubscribeWebPush();
    expect(result).toBe(true);
    expect(mockUnsub).toHaveBeenCalled();
  });
});

describe('getPushSubscription', () => {
  it('returns null if serviceWorker not supported', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });
    const result = await getPushSubscription();
    expect(result).toBeNull();
  });

  it('returns null if no subscription exists', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(null),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await getPushSubscription();
    expect(result).toBeNull();
  });

  it('returns subscription JSON if subscribed', async () => {
    const mockSub = {
      toJSON: () => ({ endpoint: 'https://test.com', keys: { p256dh: 'key', auth: 'auth' } }),
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(mockSub),
            },
          }),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await getPushSubscription();
    expect(result).toEqual({ endpoint: 'https://test.com', keys: { p256dh: 'key', auth: 'auth' } });
  });
});
