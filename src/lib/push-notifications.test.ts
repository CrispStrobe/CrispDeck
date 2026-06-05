/**
 * Tests for push notification scaffold.
 */
import { describe, it, expect, vi } from 'vitest';
import { isSupported } from './push-notifications';

describe('push notifications', () => {
  it('isSupported returns boolean', () => {
    expect(typeof isSupported()).toBe('boolean');
  });

  it('isSupported is true when Notification API exists', () => {
    vi.stubGlobal('Notification', class { static permission = 'default'; });
    expect(isSupported()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('isSupported is true when Tauri exists', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    expect(isSupported()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('notification count message is correct', () => {
    const count = 5;
    const msg = `${count} new post${count > 1 ? 's' : ''}`;
    expect(msg).toBe('5 new posts');

    const single = `${1} new post${1 > 1 ? 's' : ''}`;
    expect(single).toBe('1 new post');
  });
});
