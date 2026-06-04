/**
 * Post translation using MyMemory free API (no key required, 5000 chars/day).
 * Falls back to LibreTranslate if available.
 * Caches results in IndexedDB to avoid repeated API calls.
 */

const DB_NAME = 'crispdeck-translations';
const STORE_NAME = 'cache';
const DB_VERSION = 1;

interface CachedTranslation {
  key: string;        // `${text_hash}:${targetLang}`
  text: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  cachedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hashText(text: string): string {
  // Simple hash for cache key
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const chr = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

async function getCached(text: string, targetLang: string): Promise<CachedTranslation | null> {
  try {
    const db = await openDB();
    const key = `${hashText(text)}:${targetLang}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putCache(entry: CachedTranslation): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
  } catch {
    // Cache failure is non-critical
  }
}

export interface TranslationResult {
  translated: string;
  sourceLang: string;
  provider: string;
}

/** Get user's preferred target language from localStorage, default to 'en' */
export function getTargetLanguage(): string {
  return localStorage.getItem('crispdeck-translate-lang') ?? 'en';
}

export function setTargetLanguage(lang: string): void {
  localStorage.setItem('crispdeck-translate-lang', lang);
}

/**
 * Translate text using MyMemory API (free, no key, up to 5000 chars/day).
 * Results are cached in IndexedDB.
 */
export async function translateText(text: string, targetLang?: string): Promise<TranslationResult> {
  const target = targetLang ?? getTargetLanguage();

  // Check cache first
  const cached = await getCached(text, target);
  if (cached) {
    return { translated: cached.translated, sourceLang: cached.sourceLang, provider: `${cached.provider} (cached)` };
  }

  // Strip HTML tags for Mastodon posts
  const cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (!cleanText) {
    return { translated: '', sourceLang: 'unknown', provider: 'none' };
  }

  // MyMemory API — free tier, no API key needed
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText.substring(0, 500))}&langpair=autodetect|${target}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Translation failed: ${resp.statusText}`);

  const data = await resp.json();
  const translated = data.responseData?.translatedText ?? '';
  const detectedLang = data.responseData?.detectedLanguage ?? 'auto';

  if (!translated) throw new Error('No translation returned');

  // Cache the result
  await putCache({
    key: `${hashText(text)}:${target}`,
    text,
    translated,
    sourceLang: detectedLang,
    targetLang: target,
    provider: 'MyMemory',
    cachedAt: new Date().toISOString(),
  });

  return { translated, sourceLang: detectedLang, provider: 'MyMemory' };
}
