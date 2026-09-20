import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The credential-storage setting, from the web side.
 *
 * The browser build has no choice to make — IndexedDB is the only store — so
 * it must not call invoke() at all, and the settings screen must not offer a
 * control that cannot do anything. That is the part worth pinning: a build
 * that reached invoke() outside Tauri would throw where nobody is looking.
 */

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const isTauri = vi.fn();
vi.mock('$lib/platform', () => ({ isTauri }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function subject() {
  return await import('./db');
}

describe('in the browser build', () => {
  it('reports the local backend with nothing on offer', async () => {
    isTauri.mockReturnValue(false);
    const { getCredentialBackend } = await subject();

    await expect(getCredentialBackend()).resolves.toEqual({
      backend: 'local',
      osStoreAvailable: false,
    });
  });

  it('never reaches invoke', async () => {
    // invoke() outside Tauri throws, and this path runs on page load.
    isTauri.mockReturnValue(false);
    const { getCredentialBackend, setCredentialBackend } = await subject();

    await getCredentialBackend();
    await setCredentialBackend('keychain');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('accepts a set call and does nothing, rather than throwing', async () => {
    isTauri.mockReturnValue(false);
    const { setCredentialBackend } = await subject();
    await expect(setCredentialBackend('local')).resolves.toBeUndefined();
  });
});

describe('in the desktop build', () => {
  it('asks the backend what is in use', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({ backend: 'keychain', osStoreAvailable: true });
    const { getCredentialBackend } = await subject();

    await expect(getCredentialBackend()).resolves.toEqual({
      backend: 'keychain',
      osStoreAvailable: true,
    });
    // db.ts's wrapper always passes a second argument (toCamelArgs of the
    // args, which is undefined here), so assert the command rather than the
    // exact arity.
    expect(invoke.mock.calls[0][0]).toBe('credential_backend_get');
  });

  it('passes the choice through under the name the command expects', async () => {
    // Tauri v2 renames arguments to camelCase; `backend` is already camel,
    // but the assertion pins the shape rather than trusting that.
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(undefined);
    const { setCredentialBackend } = await subject();

    await setCredentialBackend('keychain');
    expect(invoke.mock.calls[0][0]).toBe('credential_backend_set');
    expect(invoke.mock.calls[0][1]).toEqual({ backend: 'keychain' });
  });

  it('reports a macOS build as having no OS store', async () => {
    // os_store_compiled_in() is false there, so the control hides rather
    // than offering a switch that silently does nothing.
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({ backend: 'local', osStoreAvailable: false });
    const { getCredentialBackend } = await subject();

    const info = await getCredentialBackend();
    expect(info.osStoreAvailable).toBe(false);
  });
});
