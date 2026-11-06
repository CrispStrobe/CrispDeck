import { isTauri } from '@tauri-apps/api/core';
import { safeExternalUrl } from '$lib/safe-url';

/** Open external links through the OS in a native app; leave browser clicks alone. */
export function openExternalLink(event: MouseEvent, input: unknown, onError: () => void): void {
  if (!isTauri() || event.defaultPrevented || event.button !== 0) return;
  const url = safeExternalUrl(input);
  if (!url || !/^(https?:|mailto:)/i.test(url)) return;
  event.preventDefault();
  void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(onError);
}
