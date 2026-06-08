/**
 * Tests for debug log collector — ring buffer, levels, interceptors.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { addLog, getLogs, getLogsByLevel, clearLogs, getLogCount, type LogEntry } from './debug-log';

beforeEach(() => {
  clearLogs();
});

describe('addLog and getLogs', () => {
  it('adds and retrieves log entries', () => {
    addLog('error', 'Something broke');
    addLog('warn', 'Heads up');
    const logs = getLogs();
    expect(logs).toHaveLength(2);
    // Newest first
    expect(logs[0].level).toBe('warn');
    expect(logs[1].level).toBe('error');
  });

  it('entries have timestamp', () => {
    addLog('info', 'test');
    const entry = getLogs()[0];
    expect(entry.timestamp).toBeTruthy();
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
  });

  it('entries have optional source', () => {
    addLog('error', 'test', 'my-module');
    expect(getLogs()[0].source).toBe('my-module');
  });

  it('caps message length at 500 chars', () => {
    const long = 'x'.repeat(1000);
    addLog('error', long);
    expect(getLogs()[0].message.length).toBe(500);
  });
});

describe('getLogsByLevel', () => {
  it('filters by level', () => {
    addLog('error', 'err1');
    addLog('warn', 'warn1');
    addLog('error', 'err2');
    addLog('info', 'info1');

    expect(getLogsByLevel('error')).toHaveLength(2);
    expect(getLogsByLevel('warn')).toHaveLength(1);
    expect(getLogsByLevel('info')).toHaveLength(1);
  });
});

describe('clearLogs', () => {
  it('removes all entries', () => {
    addLog('error', 'a');
    addLog('warn', 'b');
    clearLogs();
    expect(getLogs()).toHaveLength(0);
    expect(getLogCount()).toBe(0);
  });
});

describe('getLogCount', () => {
  it('returns current count', () => {
    expect(getLogCount()).toBe(0);
    addLog('error', 'a');
    expect(getLogCount()).toBe(1);
    addLog('warn', 'b');
    expect(getLogCount()).toBe(2);
  });
});

describe('ring buffer', () => {
  it('caps at MAX_ENTRIES (200)', () => {
    for (let i = 0; i < 250; i++) {
      addLog('info', `msg-${i}`);
    }
    expect(getLogCount()).toBe(200);
    // Oldest entries should be trimmed
    const logs = getLogs();
    expect(logs[0].message).toBe('msg-249'); // newest
    expect(logs[199].message).toBe('msg-50'); // oldest surviving
  });
});

describe('LogEntry type', () => {
  it('has correct shape', () => {
    const entry: LogEntry = {
      level: 'error',
      message: 'test',
      timestamp: new Date().toISOString(),
      source: 'test-suite',
    };
    expect(entry.level).toBe('error');
    expect(entry.source).toBe('test-suite');
  });
});
