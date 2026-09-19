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
    message: message.slice(0, 500), // cap message length
    timestamp: new Date().toISOString(),
    source,
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

  const fmt = (a: any) => typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a);

  console.error = (...args: any[]) => {
    addLog('error', args.map(fmt).join(' '));
    origError.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    addLog('warn', args.map(fmt).join(' '));
    origWarn.apply(console, args);
  };

  console.info = (...args: any[]) => {
    addLog('info', args.map(fmt).join(' '));
    origInfo.apply(console, args);
  };

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
