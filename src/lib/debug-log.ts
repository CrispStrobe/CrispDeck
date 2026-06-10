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
