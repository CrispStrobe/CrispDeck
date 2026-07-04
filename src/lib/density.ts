/**
 * Display density modes for the entire CrispDeck UI.
 *
 * Three modes:
 * - compact: tighter spacing, smaller avatars, condensed cards
 * - comfortable: default balanced layout
 * - spacious: more breathing room, larger avatars
 *
 * Sets CSS custom properties on :root so all components adapt automatically.
 */

export type DensityMode = 'compact' | 'comfortable' | 'spacious';

const STORAGE_KEY = 'crispdeck-density';

const DENSITY_VARS: Record<DensityMode, Record<string, string>> = {
  compact: {
    '--density-avatar': '28px',
    '--density-avatar-sm': '20px',
    '--density-padding': '8px',
    '--density-gap': '6px',
    '--density-card-padding': '10px',
    '--density-font-scale': '0.9',
    '--density-line-clamp': '3',
  },
  comfortable: {
    '--density-avatar': '40px',
    '--density-avatar-sm': '28px',
    '--density-padding': '16px',
    '--density-gap': '12px',
    '--density-card-padding': '16px',
    '--density-font-scale': '1',
    '--density-line-clamp': '6',
  },
  spacious: {
    '--density-avatar': '48px',
    '--density-avatar-sm': '36px',
    '--density-padding': '20px',
    '--density-gap': '16px',
    '--density-card-padding': '20px',
    '--density-font-scale': '1.05',
    '--density-line-clamp': '8',
  },
};

/** Get the saved density mode, defaulting to 'comfortable'. */
export function getDensity(): DensityMode {
  if (typeof localStorage === 'undefined') return 'comfortable';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'compact' || saved === 'comfortable' || saved === 'spacious') return saved;
  return 'comfortable';
}

/** Save density mode to localStorage. */
export function saveDensity(mode: DensityMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}

/** Apply density CSS custom properties to the document root. */
export function applyDensity(mode: DensityMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = DENSITY_VARS[mode];
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.dataset.density = mode;
}

/** Apply the saved density mode on app startup. */
export function initDensity(): void {
  applyDensity(getDensity());
}

/** Get all available density modes with labels. */
export function getDensityOptions(): { mode: DensityMode; label: string }[] {
  return [
    { mode: 'compact', label: 'Compact' },
    { mode: 'comfortable', label: 'Comfortable' },
    { mode: 'spacious', label: 'Spacious' },
  ];
}
