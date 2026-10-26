/** Durable local outbox. Blobs are structured-cloned, never object URLs. */
let connection: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('crispdeck-publishing', 1);
    request.onupgradeneeded = () => {
      for (const name of ['jobs', 'snapshots', 'leases']) {
        request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
  });
}

export async function read<T>(store: string, id: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store);
    const request = tx.objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all<T>(store: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function write(store: string, value: { id: string }): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    // Success means committed, not just that the put request succeeded.
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Storage write failed'));
  });
}

export async function remove(store: string, id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Storage delete failed'));
  });
}

/** Web Locks coordinate tabs. The IDB lease also covers older webviews. */
export async function exclusive<T>(name: string, work: (guard: () => Promise<void>) => Promise<T>): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`crispdeck-${name}`, { ifAvailable: true }, lock => lock ? work(async () => {}) : undefined);
  }
  const db = await open();
  const owner = crypto.randomUUID();
  const leaseMs = 120_000;
  const acquired = await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('leases', 'readwrite');
    const store = tx.objectStore('leases');
    const request = store.get(name);
    let ok = false;
    request.onsuccess = () => {
      if (!request.result || request.result.until < Date.now()) {
        store.put({ id: name, owner, until: Date.now() + leaseMs });
        ok = true;
      }
    };
    tx.oncomplete = () => resolve(ok);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  if (!acquired) return undefined;
  async function ownLease(release = false): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('leases', 'readwrite');
      const store = tx.objectStore('leases');
      const request = store.get(name);
      let owned = false;
      request.onsuccess = () => {
        if (request.result?.owner === owner) {
          owned = true;
          if (release) store.delete(name);
          else store.put({ id: name, owner, until: Date.now() + leaseMs });
        }
      };
      tx.oncomplete = () => resolve(owned);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async function guard() {
    if (!await ownLease()) throw new Error('Another window took over this delivery. Refresh its status before continuing.');
  }
  const heartbeat = setInterval(() => { void ownLease().catch(() => {}); }, 15_000);
  try { return await work(guard); }
  finally { clearInterval(heartbeat); await ownLease(true); }
}
