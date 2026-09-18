/**
 * Typed access to the preferences kept in localStorage.
 *
 * These were read and written inline wherever they were needed —
 * `localStorage.getItem('crispdeck-tts-engine') ?? 'auto'` in one file, the
 * matching setItem in another — so the key string was the only thing holding
 * them together, and a default could disagree between two readers of the same
 * key. Centralising them also gives the settings tests something to import:
 * they previously asserted against localStorage and the ?? operator, which
 * passes whatever the app does.
 *
 * Every accessor tolerates storage being unavailable (private windows, blocked
 * site data) by falling back to the default rather than throwing.
 */

export type Theme = 'dark' | 'oled' | 'light';
export type SpeechEngine = 'auto' | 'crispasr' | 'browser';

const THEME_KEY = 'crispdeck-theme';
const TTS_ENGINE_KEY = 'crispdeck-tts-engine';
const STT_ENGINE_KEY = 'crispdeck-stt-engine';

export const THEMES: Theme[] = ['dark', 'oled', 'light'];
export const SPEECH_ENGINES: SpeechEngine[] = ['auto', 'crispasr', 'browser'];

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage?.setItem(key, value);
  } catch {
    // Storage unavailable; the in-memory value still applies for this session.
  }
}

/** Stored theme, or the dark default. An unrecognised value is ignored. */
export function getTheme(): Theme {
  const saved = read(THEME_KEY) as Theme | null;
  return saved && THEMES.includes(saved) ? saved : 'dark';
}

export function setTheme(theme: Theme): void {
  write(THEME_KEY, theme);
}

/** dark -> oled -> light -> dark, the order the toggle cycles. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'oled' : current === 'oled' ? 'light' : 'dark';
}

export function getTtsEngine(): SpeechEngine {
  const saved = read(TTS_ENGINE_KEY) as SpeechEngine | null;
  return saved && SPEECH_ENGINES.includes(saved) ? saved : 'auto';
}

export function setTtsEngine(engine: SpeechEngine): void {
  write(TTS_ENGINE_KEY, engine);
}

export function getSttEngine(): SpeechEngine {
  const saved = read(STT_ENGINE_KEY) as SpeechEngine | null;
  return saved && SPEECH_ENGINES.includes(saved) ? saved : 'auto';
}

export function setSttEngine(engine: SpeechEngine): void {
  write(STT_ENGINE_KEY, engine);
}
