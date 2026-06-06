/**
 * Export/import CrispDeck settings as JSON.
 * Includes all localStorage config except account credentials.
 */

export interface SettingsExport {
  version: number;
  exported_at: string;
  settings: Record<string, string>;
}

/** localStorage keys to export (all crispdeck-* keys except credentials) */
const EXCLUDE_PATTERNS = [
  'crispdeck-oauth',     // OAuth state (transient)
  'crispdeck-threads-oauth', // Threads OAuth state (transient)
];

/** Keys that contain encrypted credentials — never export */
const CREDENTIAL_KEYS = [
  'crispdeck-encrypt-seed',
];

function shouldExport(key: string): boolean {
  if (!key.startsWith('crispdeck-')) return false;
  if (CREDENTIAL_KEYS.includes(key)) return false;
  if (EXCLUDE_PATTERNS.some(p => key.startsWith(p))) return false;
  return true;
}

/**
 * Export all CrispDeck settings from localStorage.
 * Excludes account credentials and transient OAuth state.
 */
export function exportSettings(): SettingsExport {
  const settings: Record<string, string> = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && shouldExport(key)) {
      const val = localStorage.getItem(key);
      if (val !== null) settings[key] = val;
    }
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    settings,
  };
}

/**
 * Import settings from a previously exported JSON.
 * Merges into current localStorage (overwrites matching keys).
 * Returns the number of settings imported.
 */
export function importSettings(data: SettingsExport): number {
  if (!data || data.version !== 1 || !data.settings) {
    throw new Error('Invalid settings file format');
  }

  let count = 0;
  for (const [key, value] of Object.entries(data.settings)) {
    if (shouldExport(key) && typeof value === 'string') {
      localStorage.setItem(key, value);
      count++;
    }
  }

  return count;
}

/**
 * List all exportable setting keys and their sizes.
 */
export function listExportableKeys(): { key: string; size: number }[] {
  const keys: { key: string; size: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && shouldExport(key)) {
      const val = localStorage.getItem(key);
      keys.push({ key, size: val?.length ?? 0 });
    }
  }
  return keys.sort((a, b) => a.key.localeCompare(b.key));
}
