/**
 * Per-column notification system.
 *
 * Plays a short beep sound and/or fires a desktop notification
 * when a deck column receives new posts, based on the column's notify mode.
 */

import type { ColumnNotifyMode } from '$lib/deck-layouts';

let audioCtx: AudioContext | null = null;

/** Play a short notification beep via Web Audio API. */
export function playColumnSound(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch {
    // Audio not available — silently skip
  }
}

/** Fire a desktop notification for a column. */
export function fireColumnDesktopNotification(columnTitle: string, postPreview: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(`CrispDeck — ${columnTitle}`, {
      body: postPreview.substring(0, 100),
      icon: '/favicon.ico',
      tag: `crispdeck-column-${columnTitle}`, // Replaces previous notification for same column
    });
  } catch {
    // Desktop notifications not available
  }
}

/**
 * Notify for a column based on its notification mode.
 * Call this when new posts arrive in a column.
 */
export function notifyColumn(
  mode: ColumnNotifyMode | undefined,
  columnTitle: string,
  postPreview: string,
): void {
  if (!mode || mode === 'off') return;
  if (mode === 'sound' || mode === 'both') {
    playColumnSound();
  }
  if (mode === 'desktop' || mode === 'both') {
    fireColumnDesktopNotification(columnTitle, postPreview);
  }
}
