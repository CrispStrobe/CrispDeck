/**
 * Global test setup.
 *
 * Node 22+ ships its own `localStorage` / `sessionStorage` globals that stay
 * `undefined` unless the process was started with `--localstorage-file`. Those
 * definitions already sit on `globalThis` by the time vitest's jsdom
 * environment copies the window across, so jsdom's own Storage never lands and
 * every browser-storage test sees `undefined`. Install an in-memory Storage
 * instead — per-worker, synchronous, and trivially resettable, which is what
 * these tests want anyway.
 *
 * jsdom also has no `URL.createObjectURL`; the media helpers only need it to
 * hand back an opaque, revocable string.
 */

class MemoryStorage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.has(String(key)) ? this.data.get(String(key))! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.data.delete(String(key));
  }

  clear(): void {
    this.data.clear();
  }
}

for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (!(globalThis as any)[key]) {
    Object.defineProperty(globalThis, key, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
}

if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  const objectUrls = new Set<string>();
  URL.createObjectURL = (_obj: Blob | MediaSource): string => {
    const url = `blob:http://localhost/${crypto.randomUUID()}`;
    objectUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    objectUrls.delete(url);
  };
}
