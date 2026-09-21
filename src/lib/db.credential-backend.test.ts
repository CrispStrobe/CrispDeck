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
      // An empty list is how a non-macOS build says there is no keychain
      // choice to make; the settings screen renders nothing on the strength
      // of it, so it is part of the contract rather than incidental.
      macosKeychainChoices: [],
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

describe('the macOS keychain choice', () => {
  it('is empty in the browser build, so the settings screen shows nothing', async () => {
    // macosKeychainChoices drives whether the control renders at all. An
    // empty list is how a non-macOS build says "no choice to make here".
    isTauri.mockReturnValue(false);
    const { getCredentialBackend } = await subject();

    const info = await getCredentialBackend();
    expect(info.macosKeychainChoices).toEqual([]);
  });

  it('passes a reserved name straight through', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(undefined);
    const { setMacosKeychain } = await subject();

    await setMacosKeychain('data-protection');
    expect(invoke.mock.calls[0][0]).toBe('macos_keychain_set');
    expect(invoke.mock.calls[0][1]).toEqual({ keychain: 'data-protection' });
  });

  it('passes a path through unchanged', async () => {
    // The case this exists for: someone keeping app secrets out of their
    // login keychain on purpose. The path is the user's, not ours to rewrite.
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(undefined);
    const { setMacosKeychain } = await subject();

    const path = '/Users/someone/Library/Keychains/Work.keychain-db';
    await setMacosKeychain(path);
    expect(invoke.mock.calls[0][1]).toEqual({ keychain: path });
  });

  it('does nothing in the browser build rather than throwing', async () => {
    isTauri.mockReturnValue(false);
    const { setMacosKeychain } = await subject();

    await expect(setMacosKeychain('login')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports which keychains a macOS build offers', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({
      backend: 'keychain',
      osStoreAvailable: true,
      macosKeychain: 'login',
      macosKeychainChoices: ['login', 'data-protection', 'path'],
    });
    const { getCredentialBackend } = await subject();

    const info = await getCredentialBackend();
    expect(info.macosKeychainChoices).toContain('path');
    expect(info.macosKeychain).toBe('login');
  });
});
