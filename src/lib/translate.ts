/**
 * Post translation with multiple backends:
 *
 * 1. Local ONNX (Transformers.js) — Helsinki-NLP opus-mt models, runs in
 *    browser/WebView. Model downloaded on first use, cached in IndexedDB.
 *    Free, offline, no API key, commercially licensed (CC-BY-4.0 / MIT).
 *
 * 2. BYOK OpenAI-compatible — user provides their own API base URL + key.
 *    Works with OpenAI, Mistral, Groq, local llama.cpp, Ollama, etc.
 *
 * 3. MyMemory API — free tier fallback, no key, 5000 chars/day.
 *
 * All results cached in IndexedDB.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type TranslateProvider = 'crispasr' | 'openai' | 'mymemory';

export interface TranslationResult {
  translated: string;
  sourceLang: string;
  provider: string;
}

export interface TranslateConfig {
  provider: TranslateProvider;
  targetLang: string;
  // BYOK OpenAI-compatible
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  // CrispASR local model
  crispasrModel?: string;
}

interface CachedTranslation {
  key: string;
  text: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  cachedAt: string;
}

// ── Config persistence ────────────────────────────────────────────────────

const CONFIG_KEY = 'crispdeck-translate-config';

const DEFAULT_CONFIG: TranslateConfig = {
  provider: 'mymemory',
  targetLang: 'en',
};

export function getTranslateConfig(): TranslateConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setTranslateConfig(config: Partial<TranslateConfig>): void {
  const current = getTranslateConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...config }));
}

/** Convenience — kept for backward compat with settings page */
export function getTargetLanguage(): string {
  return getTranslateConfig().targetLang;
}

export function setTargetLanguage(lang: string): void {
  setTranslateConfig({ targetLang: lang });
}

// ── IndexedDB cache ───────────────────────────────────────────────────────

const DB_NAME = 'crispdeck-translations';
const STORE_NAME = 'cache';
const DB_VERSION = 1;

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

// ── Provider: CrispASR (Tauri desktop — local M2M-100 GGUF) ──────────────

/**
 * Local translation via CrispASR FFI (same approach as CrisperWeaver).
 * Uses M2M-100 GGUF models downloaded on demand by the user.
 * Runs natively on CPU/GPU — no API key, fully offline, commercially free.
 *
 * Requires CrispASR to be bundled as a native library in the Tauri build.
 * Not yet integrated — will land when CrispASR is added as a dependency.
 */

async function translateWithCrispASR(
  text: string,
  _srcLang: string,
  tgtLang: string,
): Promise<TranslationResult> {
  const w = globalThis as any;
  if (!w.__TAURI_INTERNALS__) {
    throw new Error(
      'Local translation requires the desktop app with CrispASR. ' +
      'Use "OpenAI / BYOK" with Ollama or any OpenAI-compatible endpoint, ' +
      'or "MyMemory" as a free fallback.'
    );
  }

  const config = getTranslateConfig();
  const { invoke } = await import('@tauri-apps/api/core');

  // Check if CrispASR feature is compiled in
  const available = await invoke('asr_available') as boolean;
  if (!available) {
    throw new Error(
      'CrispASR not compiled in this build. Rebuild with --features crispasr-metal (macOS), ' +
      'crispasr-vulkan (Windows/Linux), or crispasr-cuda (NVIDIA).'
    );
  }

  const result = await invoke('translate_text', {
    backend: config.crispasrModel?.replace(/-q\d.*$/, '') || 'm2m100',
    modelPath: null, // auto-download from registry
    text,
    srcLang: _srcLang || 'auto',
    tgtLang,
    maxTokens: 200,
  });
  const r = result as { translated: string; srcLang: string; backend: string };
  return {
    translated: r.translated,
    sourceLang: r.srcLang,
    provider: `CrispASR (${r.backend})`,
  };
}

// ── Provider: BYOK OpenAI-compatible ──────────────────────────────────────

async function translateWithOpenAI(
  text: string,
  srcLang: string,
  tgtLang: string,
  config: TranslateConfig,
): Promise<TranslationResult> {
  const baseUrl = (config.openaiBaseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = config.openaiApiKey;
  const model = config.openaiModel ?? 'gpt-4o-mini';

  if (!apiKey) throw new Error('OpenAI API key not configured. Set it in Settings → Translation.');

  const srcHint = srcLang && srcLang !== 'auto' ? ` from ${srcLang}` : '';
  const systemPrompt = `You are a translator. Translate the following text${srcHint} to ${tgtLang}. Output ONLY the translation, nothing else.`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error: ${resp.status}`);
  }

  const data = await resp.json();
  const translated = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!translated) throw new Error('No translation returned from API');

  return {
    translated,
    sourceLang: srcLang || 'auto',
    provider: `${model} (${new URL(baseUrl).hostname})`,
  };
}

// ── Provider: MyMemory (free fallback) ────────────────────────────────────

async function translateWithMyMemory(
  text: string,
  tgtLang: string,
): Promise<TranslationResult> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.substring(0, 500))}&langpair=autodetect|${tgtLang}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MyMemory API error: ${resp.statusText}`);

  const data = await resp.json();
  const translated = data.responseData?.translatedText ?? '';
  const detectedLang = data.responseData?.detectedLanguage ?? 'auto';

  if (!translated) throw new Error('No translation returned from MyMemory');

  return {
    translated,
    sourceLang: detectedLang,
    provider: 'MyMemory',
  };
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Translate text using the configured provider.
 * Results are cached in IndexedDB regardless of provider.
 */
export async function translateText(
  text: string,
  targetLang?: string,
): Promise<TranslationResult> {
  const config = getTranslateConfig();
  const target = targetLang ?? config.targetLang;

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

  let result: TranslationResult;

  switch (config.provider) {
    case 'crispasr':
      result = await translateWithCrispASR(cleanText, 'auto', target);
      break;

    case 'openai':
      result = await translateWithOpenAI(cleanText, 'auto', target, config);
      break;

    case 'mymemory':
    default:
      result = await translateWithMyMemory(cleanText, target);
      break;
  }

  // Cache the result
  await putCache({
    key: `${hashText(text)}:${target}`,
    text,
    translated: result.translated,
    sourceLang: result.sourceLang,
    targetLang: target,
    provider: result.provider,
    cachedAt: new Date().toISOString(),
  });

  return result;
}
