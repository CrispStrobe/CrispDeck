import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PROVIDER_PRESETS,
  getPreset,
  listPresetIds,
  fetchAvailableModels,
  getCachedModels,
  setCachedModels,
  fetchModelsWithCache,
  type DiscoveredModel,
} from './byok-providers';

// Mock sessionStorage
const sessionStore: Record<string, string> = {};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => sessionStore[key] ?? null,
    setItem: (key: string, value: string) => { sessionStore[key] = value; },
    removeItem: (key: string) => { delete sessionStore[key]; },
  },
});

beforeEach(() => {
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  vi.restoreAllMocks();
});

describe('provider presets', () => {
  it('has all required providers', () => {
    const ids = listPresetIds();
    expect(ids).toContain('openrouter');
    expect(ids).toContain('scaleway');
    expect(ids).toContain('nebius');
    expect(ids).toContain('mistral');
    expect(ids).toContain('poe');
    expect(ids).toContain('groq');
    expect(ids).toContain('ollama');
    expect(ids).toContain('llamacpp');
    expect(ids).toContain('openai');
    expect(ids).toContain('custom');
  });

  it('each preset has required fields', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.modelsEndpoint).toBeTruthy();
      expect(preset.modelsPath).toBeTruthy();
      expect(preset.modelIdField).toBeTruthy();
      expect(preset.authHeader).toBeTruthy();
      expect(typeof preset.requiresApiKey).toBe('boolean');
    }
  });

  it('local providers do not require API key', () => {
    const ollama = getPreset('ollama');
    const llamacpp = getPreset('llamacpp');
    expect(ollama?.requiresApiKey).toBe(false);
    expect(llamacpp?.requiresApiKey).toBe(false);
  });

  it('cloud providers require API key', () => {
    for (const id of ['openrouter', 'scaleway', 'nebius', 'mistral', 'poe', 'groq', 'openai']) {
      expect(getPreset(id)?.requiresApiKey).toBe(true);
    }
  });

  it('each cloud preset has a docsUrl', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.requiresApiKey && preset.id !== 'custom') {
        expect(preset.docsUrl).toBeTruthy();
      }
    }
  });

  it('each preset has vision model for alt-text', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id !== 'custom') {
        expect(preset.defaultVisionModel).toBeTruthy();
      }
    }
  });

  it('getPreset returns undefined for non-existent', () => {
    expect(getPreset('nonexistent')).toBeUndefined();
  });

  it('getPreset finds by id', () => {
    const preset = getPreset('openrouter');
    expect(preset?.name).toBe('OpenRouter');
    expect(preset?.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('OpenRouter preset has correct base URL', () => {
    const p = getPreset('openrouter')!;
    expect(p.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(p.defaultModel).toContain('claude');
  });

  it('Scaleway preset has correct base URL', () => {
    const p = getPreset('scaleway')!;
    expect(p.baseUrl).toBe('https://api.scaleway.ai/v1');
  });

  it('Nebius preset has correct base URL', () => {
    const p = getPreset('nebius')!;
    expect(p.baseUrl).toBe('https://api.studio.nebius.ai/v1');
  });

  it('Mistral preset has correct base URL', () => {
    const p = getPreset('mistral')!;
    expect(p.baseUrl).toBe('https://api.mistral.ai/v1');
  });

  it('Groq preset has correct base URL', () => {
    const p = getPreset('groq')!;
    expect(p.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('all presets use /models endpoint', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.modelsEndpoint).toBe('/models');
    }
  });
});

describe('fetchAvailableModels', () => {
  it('fetches and parses OpenAI-format models response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: 'gpt-4o', owned_by: 'openai' },
          { id: 'gpt-4o-mini', owned_by: 'openai' },
          { id: 'gpt-3.5-turbo', owned_by: 'openai' },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await fetchAvailableModels(
      'https://api.openai.com/v1',
      'sk-test',
      getPreset('openai'),
    );

    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('gpt-3.5-turbo'); // sorted
    expect(models[1].id).toBe('gpt-4o');
    expect(models[2].id).toBe('gpt-4o-mini');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test');

    vi.unstubAllGlobals();
  });

  it('strips trailing slash from base URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchAvailableModels('https://api.example.com/v1/', 'key');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/v1/models');

    vi.unstubAllGlobals();
  });

  it('sends no auth when no API key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'llama3' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchAvailableModels('http://localhost:11434/v1', '', getPreset('ollama'));
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
    }));

    await expect(fetchAvailableModels('https://api.example.com/v1', 'bad'))
      .rejects.toThrow('401 Unauthorized');

    vi.unstubAllGlobals();
  });

  it('throws on unexpected format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'nope' }),
    }));

    await expect(fetchAvailableModels('https://api.example.com/v1', 'key'))
      .rejects.toThrow('Unexpected models response');

    vi.unstubAllGlobals();
  });

  it('sorts models alphabetically by id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: 'c-model' },
          { id: 'a-model' },
          { id: 'b-model' },
        ],
      }),
    }));

    const models = await fetchAvailableModels('https://api.example.com/v1', 'key');
    expect(models.map(m => m.id)).toEqual(['a-model', 'b-model', 'c-model']);

    vi.unstubAllGlobals();
  });
});

describe('model cache', () => {
  it('returns null when cache is empty', () => {
    expect(getCachedModels('https://api.example.com/v1')).toBeNull();
  });

  it('stores and retrieves cached models', () => {
    const models: DiscoveredModel[] = [{ id: 'test-model' }];
    setCachedModels('https://api.example.com/v1', models);
    const cached = getCachedModels('https://api.example.com/v1');
    expect(cached).toHaveLength(1);
    expect(cached![0].id).toBe('test-model');
  });

  it('returns null for different base URL', () => {
    setCachedModels('https://api.a.com/v1', [{ id: 'm1' }]);
    expect(getCachedModels('https://api.b.com/v1')).toBeNull();
  });

  it('returns null when cache is expired (>5 min)', () => {
    // Manually write an expired entry
    const cache = {
      'https://api.example.com/v1': {
        models: [{ id: 'old' }],
        fetchedAt: Date.now() - 6 * 60 * 1000, // 6 min ago
      },
    };
    sessionStore['crispdeck-models-cache'] = JSON.stringify(cache);
    expect(getCachedModels('https://api.example.com/v1')).toBeNull();
  });

  it('returns cached when within 5 min', () => {
    const cache = {
      'https://api.example.com/v1': {
        models: [{ id: 'fresh' }],
        fetchedAt: Date.now() - 2 * 60 * 1000, // 2 min ago
      },
    };
    sessionStore['crispdeck-models-cache'] = JSON.stringify(cache);
    const cached = getCachedModels('https://api.example.com/v1');
    expect(cached).toHaveLength(1);
    expect(cached![0].id).toBe('fresh');
  });

  it('stores multiple base URLs independently', () => {
    setCachedModels('https://api.a.com/v1', [{ id: 'a1' }]);
    setCachedModels('https://api.b.com/v1', [{ id: 'b1' }, { id: 'b2' }]);
    expect(getCachedModels('https://api.a.com/v1')).toHaveLength(1);
    expect(getCachedModels('https://api.b.com/v1')).toHaveLength(2);
  });
});

describe('fetchModelsWithCache', () => {
  it('returns cached models without fetching', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    setCachedModels('https://api.example.com/v1', [{ id: 'cached-model' }]);
    const models = await fetchModelsWithCache('https://api.example.com/v1', 'key');

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('cached-model');
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('fetches and caches when no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'new-model' }] }),
    }));

    const models = await fetchModelsWithCache('https://api.example.com/v1', 'key');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('new-model');

    // Verify it was cached
    expect(getCachedModels('https://api.example.com/v1')).toHaveLength(1);

    vi.unstubAllGlobals();
  });
});
