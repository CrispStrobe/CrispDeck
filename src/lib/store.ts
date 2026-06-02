import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';

export async function getStore() {
  return await load(STORE_PATH, { defaults: {}, autoSave: true });
}

export async function saveSetting(key: string, value: unknown) {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const store = await getStore();
  const val = await store.get<T>(key);
  return val !== undefined && val !== null ? val : defaultValue;
}
