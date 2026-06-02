/** Detect whether we're running inside Tauri or in a plain browser */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}
