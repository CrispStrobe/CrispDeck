/**
 * Export/import CrispDeck settings as JSON.
 * Includes all localStorage config except account credentials.
 */

import { writeString } from './safe-storage';

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
  'crispdeck-key',
  'crispdeck-salt-v2',
  'crispdeck-crypto-v2',
  'crispdeck-mastodon-apps',
  'crispdeck-threads-config',
  'crispdeck-wallabag-session',
];

// Export provider preferences, but never their API keys. Use an allowlist so
// adding another secret to either config cannot silently put it in a backup.
const PROVIDER_FIELDS: Record<string, readonly string[]> = {
  'crispdeck-ai-compose-config': ['provider', 'presetId', 'baseUrl', 'model', 'visionModel', 'crispasrModel', 'mistralrsModel'],
  'crispdeck-translate-config': ['provider', 'targetLang', 'openaiBaseUrl', 'openaiModel', 'crispasrModel', 'lingvaInstance', 'libreTranslateInstance'],
};

function exportableValue(key: string, value: string): string | null {
  const fields = PROVIDER_FIELDS[key];
  if (!fields) return value;
  try {
    const config: unknown = JSON.parse(value);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    const clean: Record<string, string> = {};
    for (const field of fields) {
      const item = (config as Record<string, unknown>)[field];
      if (typeof item === 'string') clean[field] = item;
    }
    return JSON.stringify(clean);
  } catch {
    // A malformed credential-bearing config must never be exported verbatim.
    return null;
  }
}

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
      const safe = val === null ? null : exportableValue(key, val);
      if (safe !== null) settings[key] = safe;
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
 * Imported provider configs require API keys to be entered again. Do not merge
 * an existing key with an imported endpoint: that could send it to a new host.
 * Returns the number of settings imported, or throws on a storage failure.
 */
export function importSettings(data: SettingsExport): number {
  if (!data || data.version !== 1 || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    throw new Error('Invalid settings file format');
  }

  let count = 0;
  for (const [key, value] of Object.entries(data.settings)) {
    if (shouldExport(key) && typeof value === 'string') {
      const safe = exportableValue(key, value);
      if (safe === null) continue;
      if (!writeString(key, safe)) {
        throw new Error(`Could not import settings: storage failed after ${count} saved settings.`);
      }
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
      const safe = val === null ? null : exportableValue(key, val);
      if (safe !== null) keys.push({ key, size: safe.length });
    }
  }
  return keys.sort((a, b) => a.key.localeCompare(b.key));
}
