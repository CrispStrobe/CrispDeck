import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLog, clearLogs, getLogs } from './debug-log';

afterEach(() => { vi.restoreAllMocks(); clearLogs(); });

describe('downloadable diagnostic privacy', () => {
  it('redacts credential fields, authorization and OAuth callback parameters', () => {
    addLog('error', JSON.stringify({ access_token: 'access-secret', app_password: 'app-secret', openaiApiKey: 'provider-secret' }));
    addLog('error', JSON.stringify({ session: { accessJwt: 'access-jwt-secret', refreshJwt: 'refresh-jwt-secret' }, token: 'service-secret' }));
    addLog('warn', 'request failed: Bearer bearer-secret https://app.example/oauth/callback?code=oauth-secret&state=state-secret');
    const output = JSON.stringify(getLogs());
    expect(output).not.toContain('-secret');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts before truncation and also covers source context', () => {
    addLog('warn', `{"client_secret":"${'s'.repeat(600)}"}`, 'https://api.example?access_token=source-secret');
    expect(getLogs()[0].message).toBe('{"client_secret":"[REDACTED]"}');
    expect(getLogs()[0].source).not.toContain('source-secret');
  });
});

describe('console interception reliability', () => {
  it('logs circular objects, bigint values, errors and hostile getters without throwing', async () => {
    vi.resetModules();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logs = await import('./debug-log');
    logs.installLogInterceptors();
    const circular: Record<string, unknown> = { count: 2n };
    circular.self = circular;
    const hostile = { get bad() { throw new Error('getter failed'); } };
    expect(() => console.error(circular, new Error('useful failure'))).not.toThrow();
    expect(() => console.warn(hostile)).not.toThrow();
    expect(error).toHaveBeenCalledWith(circular, expect.any(Error));
    expect(warn.mock.calls[0][0]).toBe(hostile);
    const output = JSON.stringify(logs.getLogs());
    expect(output).toContain('[Circular]');
    expect(output).toContain('useful failure');
    expect(output).toContain('Unserializable');
  });
});
