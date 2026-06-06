import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAlertSettings, setAlertSettings } from './notification-alerts';

describe('notification alerts', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('returns defaults when nothing stored', () => {
    const settings = getAlertSettings();
    expect(settings.soundEnabled).toBe(false);
    expect(settings.desktopEnabled).toBe(false);
    expect(settings.soundVolume).toBe(0.5);
  });

  it('saves and retrieves settings', () => {
    setAlertSettings({ soundEnabled: true });
    const settings = getAlertSettings();
    expect(settings.soundEnabled).toBe(true);
    expect(settings.desktopEnabled).toBe(false); // default preserved
  });

  it('merges partial updates', () => {
    setAlertSettings({ soundEnabled: true });
    setAlertSettings({ desktopEnabled: true });
    const settings = getAlertSettings();
    expect(settings.soundEnabled).toBe(true);
    expect(settings.desktopEnabled).toBe(true);
  });

  it('handles volume setting', () => {
    setAlertSettings({ soundVolume: 0.8 });
    expect(getAlertSettings().soundVolume).toBe(0.8);
  });
});
