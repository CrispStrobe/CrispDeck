/**
 * Haptic feedback for native-feeling interactions.
 * Web: navigator.vibrate(); Tauri: native haptics via __TAURI_INTERNALS__.
 * Respects prefers-reduced-motion.
 */

const DURATIONS = { light: 10, medium: 20, heavy: 40, selection: 5 } as const;

let _reducedMotion: boolean | null = null;

function prefersReducedMotion(): boolean {
  if (_reducedMotion === null) {
    try {
      // matchMedia is not guaranteed: it is absent in jsdom and in some older
      // webviews, and reading it unguarded threw out of haptic() and aborted
      // whatever action had called it.
      _reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      _reducedMotion = false;
    }
  }
  return _reducedMotion;
}

/**
 * Buzz, if the platform can and the user wants it.
 *
 * Never throws. This is an accessory to an action — a like, a column change —
 * and failing to vibrate must not take the action down with it.
 */
export function haptic(style: 'light' | 'medium' | 'heavy' | 'selection'): void {
  try {
    if (prefersReducedMotion()) return;
    navigator.vibrate?.(DURATIONS[style]);
  } catch {
    // No vibration API, or it refused. Nothing to do and nothing to report.
  }
}
