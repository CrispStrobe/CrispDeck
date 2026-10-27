import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncSystemBars } from './system-bars';
import { isTauri } from './platform';
import { invoke } from '@tauri-apps/api/core';
import { swallow } from './debug-log';

vi.mock('./platform', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./debug-log', () => ({ swallow: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('Android system bar theme', () => {
  it.each(['dark', 'oled', 'light'] as const)('applies the %s app theme independently of the OS', async theme => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    await syncSystemBars(theme);
    expect(invoke).toHaveBeenCalledWith('set_system_bar_theme', { light: theme === 'light' });
  });

  it('does not invoke native commands in a mobile browser', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    await syncSystemBars('dark');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not invoke Android commands on other native platforms', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' });
    await syncSystemBars('light');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('records native failures without breaking the app theme', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    vi.mocked(invoke).mockRejectedValue(new Error('Native theme failed'));
    await expect(syncSystemBars('dark')).resolves.toBeUndefined();
    expect(swallow).toHaveBeenCalledWith('Android system bar theme', expect.any(Error));
  });
});
