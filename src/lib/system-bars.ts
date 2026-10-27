import { isTauri } from './platform';
import { swallow } from './debug-log';
import type { Theme } from './settings';

/** The Android OS theme can differ from CrispDeck's saved theme. */
export async function syncSystemBars(theme: Theme): Promise<void> {
  if (!isTauri() || !/Android/i.test(navigator.userAgent)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_system_bar_theme', { light: theme === 'light' });
  } catch (error) {
    swallow('Android system bar theme', error);
  }
}
