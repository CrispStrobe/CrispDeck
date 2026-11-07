/**
 * Debug log collector — captures errors and warnings for display in Settings.
 * Wraps console.error/warn to store recent entries in memory.
 * Kept in a ring buffer to avoid memory growth.
 */

export interface LogEntry {
  level: 'error' | 'warn' | 'info';
  message: string;
  timestamp: string;
  source?: string;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];
let installed = false;

/** Keep credentials out of downloadable diagnostics, before truncating them. */
function redactSecrets(message: string): string {
  return message
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/([?&#](?:access_token|refresh_token|id_token|client_secret|api_key|apikey|code|state|password)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/("(?:access[_-]?(?:token|jwt)|refresh[_-]?(?:token|jwt)|id[_-]?(?:token|jwt)|client[_-]?secret|api[_-]?key|openaiApiKey|libreTranslateApiKey|app[_-]?password|password|token|authorization)"\s*:\s*")(?:\\.|[^"\\])*(")/gi, '$1[REDACTED]$2');
}

function formatLogValue(value: unknown): string {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (value === null || typeof value !== 'object') return String(value);
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return String(item);
      if (item !== null && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    }) ?? String(value);
  } catch {
    return '[Unserializable log value]';
  }
}

/**
 * Record a non-fatal error that the caller is deliberately swallowing.
 *
 * A lot of this app's work is per-account or per-column, and partial failure is
 * normal: one instance is down, one token expired, one column 404s. Catching
 * those is right — the UI should not collapse because one of eight columns
 * failed — but discarding them entirely left nothing to look at when something
 * was wrong. These now land in the same ring buffer the log viewer in Settings
 * reads, so a user can see why a column is empty.
 *
 * Never throws: logging must not become the thing that breaks the caller.
 */
export function swallow(context: string, error: unknown): void {
  try {
    const message = error instanceof Error
      ? (error.message || error.name)
      : String(error);
    addLog('warn', message, context);
    // The ring buffer keeps only the message, so a developer would lose the
    // stack that a plain console.error used to give them. Mirror the original
    // error to the console as well — except under test, where the mirrored
    // output is pure noise.
    if (import.meta.env?.MODE !== 'test') {
      console.warn(`[${context}]`, error);
    }
  } catch {
    // Log buffer unavailable; there is nothing useful left to do.
  }
}

/**
 * Add a log entry manually.
 */
export function addLog(level: LogEntry['level'], message: string, source?: string): void {
  entries.push({
    level,
    message: redactSecrets(message).slice(0, 500), // cap message length after redaction
    timestamp: new Date().toISOString(),
    source: source === undefined ? undefined : redactSecrets(source).slice(0, 200),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/**
 * Get all log entries (newest first).
 */
export function getLogs(): LogEntry[] {
  return [...entries].reverse();
}

/**
 * Get entries filtered by level.
 */
export function getLogsByLevel(level: LogEntry['level']): LogEntry[] {
  return entries.filter(e => e.level === level).reverse();
}

/**
 * Clear all log entries.
 */
export function clearLogs(): void {
  entries.length = 0;
}

/**
 * Get entry count.
 */
export function getLogCount(): number {
  return entries.length;
}

/**
 * Install console interceptors. Call once at app startup.
 * Captures console.error and console.warn into the log buffer.
 */
export function installLogInterceptors(): void {
  if (installed || typeof console === 'undefined') return;
  installed = true;

  const origError = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;

  const intercept = (level: LogEntry['level'], original: (...args: unknown[]) => void) => (...args: unknown[]) => {
    try { addLog(level, args.map(formatLogValue).join(' ')); }
    catch { /* Diagnostics must never turn a handled error into an app failure. */ }
    original.apply(console, args);
  };
  console.error = intercept('error', origError);
  console.warn = intercept('warn', origWarn);
  console.info = intercept('info', origInfo);

  // Capture unhandled errors
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      addLog('error', `${e.message} (${e.filename}:${e.lineno})`, 'window.onerror');
    });
    window.addEventListener('unhandledrejection', (e) => {
      addLog('error', `Unhandled rejection: ${e.reason}`, 'promise');
    });
  }
}
