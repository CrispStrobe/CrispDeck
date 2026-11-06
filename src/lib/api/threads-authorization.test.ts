// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { threadsAuthorizationCode } from './threads-authorization';
import { threadsRedirectUri, isThreadsAvailable } from './threads';
import { apiUrl } from '$lib/api-origin';
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).__TAURI_INTERNALS__; });
describe('Threads native authorization', () => {
  it('uses the hosted API and HTTPS callback in the native app', () => {
    (window as any).__TAURI_INTERNALS__ = {};
    expect(threadsRedirectUri()).toBe('https://crispdeck.vercel.app/oauth/threads-callback');
    expect(apiUrl('/api/threads/token')).toBe('https://crispdeck.vercel.app/api/threads/token');
  });
  it('checks the proxy using an actual valid callback', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({configured:true,auth_url:'https://threads.net/oauth/authorize'})});
    vi.stubGlobal('fetch',fetcher);
    expect(await isThreadsAvailable()).toBe(true);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('redirect_uri')).toBe(threadsRedirectUri());
    expect(url.searchParams.get('state')).toBe('availability-check');
  });
  it('accepts only matching state and a returned authorization code', () => {
    expect(threadsAuthorizationCode('code=test&state=expected','expected')).toBe('test');
    expect(()=>threadsAuthorizationCode('code=test','')).toThrow(/state/i);
    expect(()=>threadsAuthorizationCode('code=test&state=wrong','expected')).toThrow(/state/i);
    expect(()=>threadsAuthorizationCode('error=access_denied&state=expected','expected')).toThrow(/denied/i);
    expect(()=>threadsAuthorizationCode('state=expected','expected')).toThrow(/code/i);
  });
});
