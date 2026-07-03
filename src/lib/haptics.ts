/**
 * Haptic feedback for native-feeling interactions.
 * Web: navigator.vibrate(); Tauri: native haptics via __TAURI_INTERNALS__.
 * Respects prefers-reduced-motion.
 */

const DURATIONS = { light: 10, medium: 20, heavy: 40, selection: 5 } as const;

let _reducedMotion: boolean | null = null;

function prefersReducedMotion(): boolean {
  if (_reducedMotion === null) {
    _reducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return _reducedMotion;
}

export function haptic(style: 'light' | 'medium' | 'heavy' | 'selection'): void {
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate?.(DURATIONS[style]);
  } catch {
    // Vibration API not available
  }
}
