/**
 * BYOK provider presets and model discovery.
 *
 * All providers use the OpenAI-compatible /chat/completions API.
 * Each preset knows its base URL, how to fetch available models,
 * and sensible defaults for model selection.
 *
 * Model discovery polls the /models endpoint (or provider-specific
 * equivalent) and returns available model IDs for the settings UI.
 */

// ── Provider presets ────────────────────────────────────────────────────────

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  modelsEndpoint: string; // relative to baseUrl, or absolute
  modelsPath: string; // JSON path to model list in response (dot-notation)
  modelIdField: string; // field name for model ID in each model object
  defaultModel: string;
  defaultVisionModel: string; // for alt-text
  authHeader: 'Authorization' | 'X-API-Key'; // most use Bearer, Poe uses X-API-Key
  authPrefix: string; // 'Bearer ' or '' for X-API-Key
  requiresApiKey: boolean;
  docsUrl: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'anthropic/claude-sonnet-4',
    defaultVisionModel: 'anthropic/claude-sonnet-4',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    baseUrl: 'https://api.scaleway.ai/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'llama-3.3-70b-instruct',
    defaultVisionModel: 'pixtral-large-latest',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://console.scaleway.com/iam/api-keys',
  },
  {
    id: 'nebius',
    name: 'Nebius AI',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'Qwen/Qwen3-30B-A3B',
    defaultVisionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://studio.nebius.ai/',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'mistral-small-latest',
    defaultVisionModel: 'pixtral-large-latest',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'poe',
    name: 'Poe',
    baseUrl: 'https://api.poe.com/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'Claude-3.5-Sonnet',
    defaultVisionModel: 'Claude-3.5-Sonnet',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://poe.com/api_key',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultVisionModel: 'llama-4-scout-17b-16e-instruct',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'llama3.2',
    defaultVisionModel: 'llava',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: false,
    docsUrl: 'https://ollama.com/',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server (local)',
    baseUrl: 'http://localhost:8080/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'default',
    defaultVisionModel: 'default',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: false,
    docsUrl: 'https://github.com/ggerganov/llama.cpp',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: 'gpt-4o-mini',
    defaultVisionModel: 'gpt-4o',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    baseUrl: '',
    modelsEndpoint: '/models',
    modelsPath: 'data',
    modelIdField: 'id',
    defaultModel: '',
    defaultVisionModel: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    requiresApiKey: true,
    docsUrl: '',
  },
];

// ── Model discovery ─────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  name?: string;
  owned_by?: string;
  created?: number;
}

/**
 * Fetch available models from a provider's /models endpoint.
 * Works with any OpenAI-compatible API.
 */
export async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
  preset?: ProviderPreset,
): Promise<DiscoveredModel[]> {
  const url = baseUrl.replace(/\/$/, '');
  const endpoint = preset?.modelsEndpoint ?? '/models';
  const authHeader = preset?.authHeader ?? 'Authorization';
  const authPrefix = preset?.authPrefix ?? 'Bearer ';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers[authHeader] = `${authPrefix}${apiKey}`;
  }

  const resp = await fetch(`${url}${endpoint}`, { headers });

  if (!resp.ok) {
    throw new Error(`Failed to fetch models: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();

  // Navigate the response using the modelsPath
  const path = preset?.modelsPath ?? 'data';
  let modelList: any[] = json;
  for (const key of path.split('.')) {
    modelList = modelList?.[key];
  }

  if (!Array.isArray(modelList)) {
    throw new Error('Unexpected models response format');
  }

  const idField = preset?.modelIdField ?? 'id';

  return modelList
    .map((m: any) => ({
      id: m[idField] ?? m.id,
      name: m.name ?? m[idField] ?? m.id,
      owned_by: m.owned_by,
      created: m.created,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Look up a preset by ID */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

/** Get all preset IDs */
export function listPresetIds(): string[] {
  return PROVIDER_PRESETS.map(p => p.id);
}

/**
 * Cache fetched models per base URL in sessionStorage.
 * Avoids re-fetching on every settings page visit.
 */
const MODEL_CACHE_KEY = 'crispdeck-models-cache';

interface ModelCacheEntry {
  models: DiscoveredModel[];
  fetchedAt: number;
}

export function getCachedModels(baseUrl: string): DiscoveredModel[] | null {
  try {
    const raw = sessionStorage.getItem(MODEL_CACHE_KEY);
    if (!raw) return null;
    const cache: Record<string, ModelCacheEntry> = JSON.parse(raw);
    const entry = cache[baseUrl];
    if (!entry) return null;
    // Cache valid for 5 minutes
    if (Date.now() - entry.fetchedAt > 5 * 60 * 1000) return null;
    return entry.models;
  } catch {
    return null;
  }
}

export function setCachedModels(baseUrl: string, models: DiscoveredModel[]): void {
  try {
    const raw = sessionStorage.getItem(MODEL_CACHE_KEY);
    const cache: Record<string, ModelCacheEntry> = raw ? JSON.parse(raw) : {};
    cache[baseUrl] = { models, fetchedAt: Date.now() };
    sessionStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage not available or full
  }
}

/**
 * Fetch models with caching. Uses sessionStorage cache if fresh,
 * otherwise fetches from API and caches the result.
 */
export async function fetchModelsWithCache(
  baseUrl: string,
  apiKey: string,
  preset?: ProviderPreset,
): Promise<DiscoveredModel[]> {
  const cached = getCachedModels(baseUrl);
  if (cached) return cached;

  const models = await fetchAvailableModels(baseUrl, apiKey, preset);
  setCachedModels(baseUrl, models);
  return models;
}
