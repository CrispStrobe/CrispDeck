/**
 * The feed's offline banner survived the connection coming back, because
 * nothing was listening for it on that page. These pin the wiring and the
 * rule about when a banner is warranted at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { watchConnection, cachedDataBanner } from './offline-status';

afterEach(() => vi.restoreAllMocks());

const goOnline = () => window.dispatchEvent(new Event('online'));
const goOffline = () => window.dispatchEvent(new Event('offline'));

describe('watchConnection', () => {
  it('calls back when the connection returns', () => {
    const onOnline = vi.fn();
    const stop = watchConnection({ onOnline });

    goOnline();

    expect(onOnline).toHaveBeenCalledTimes(1);
    stop();
  });

  it('calls back when the connection goes away', () => {
    const onOffline = vi.fn();
    const stop = watchConnection({ onOffline });

    goOffline();

    expect(onOffline).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops listening once torn down, so a page that left does not refresh', () => {
    // Without this the feed would keep reloading in the background after the
    // user navigated away, once per reconnection, forever.
    const onOnline = vi.fn();
    const stop = watchConnection({ onOnline });
    stop();

    goOnline();

    expect(onOnline).not.toHaveBeenCalled();
  });

  it('does not require both handlers', () => {
    const stop = watchConnection({});
    expect(() => { goOnline(); goOffline(); }).not.toThrow();
    stop();
  });

  it('keeps two watchers independent', () => {
    // The layout and the feed both watch. Tearing one down must not deafen
    // the other.
    const a = vi.fn();
    const b = vi.fn();
    const stopA = watchConnection({ onOnline: a });
    const stopB = watchConnection({ onOnline: b });

    stopA();
    goOnline();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    stopB();
  });
});

describe('cachedDataBanner', () => {
  const fmt = () => '5 min ago';
  const template = 'Offline — showing cached data from {time}';

  it('says when the data came from a cache and the connection is gone', () => {
    expect(cachedDataBanner(true, '2026-09-21T09:00:00.000Z', template, fmt)).toBe(
      'Offline — showing cached data from 5 min ago'
    );
  });

  it('says nothing while online, even if the data came from a cache', () => {
    // Stale-while-revalidate shows cached data on every load. A banner there
    // would be permanent furniture and would stop meaning anything.
    expect(cachedDataBanner(false, '2026-09-21T09:00:00.000Z', template, fmt)).toBe('');
  });

  it('says nothing when offline with no cache to speak of', () => {
    expect(cachedDataBanner(true, null, template, fmt)).toBe('');
  });

  it('accepts a timestamp in either shape', () => {
    // view-cache stores epoch milliseconds; offline-cache stores an ISO
    // string. Both feed this.
    expect(cachedDataBanner(true, Date.parse('2026-09-21T09:00:00.000Z'), template, fmt)).toBe(
      'Offline — showing cached data from 5 min ago'
    );
  });

  it('says nothing rather than "Invalid Date" for a timestamp it cannot read', () => {
    expect(cachedDataBanner(true, 'not a date', template, fmt)).toBe('');
  });
});
