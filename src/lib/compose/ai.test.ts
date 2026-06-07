import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAIComposeConfig, setAIComposeConfig, isAIConfigured, runAIAction } from './ai';

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('AI compose config', () => {
  it('returns defaults when no config saved', () => {
    const config = getAIComposeConfig();
    expect(config.provider).toBe('openai');
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.apiKey).toBe('');
    expect(config.model).toBe('gpt-4o-mini');
  });

  it('saves and loads config', () => {
    setAIComposeConfig({ apiKey: 'sk-test', model: 'gpt-4o' });
    const config = getAIComposeConfig();
    expect(config.apiKey).toBe('sk-test');
    expect(config.model).toBe('gpt-4o');
    expect(config.baseUrl).toBe('https://api.openai.com/v1'); // default preserved
  });

  it('merges partial updates', () => {
    setAIComposeConfig({ apiKey: 'key1' });
    setAIComposeConfig({ model: 'claude-3' });
    const config = getAIComposeConfig();
    expect(config.apiKey).toBe('key1');
    expect(config.model).toBe('claude-3');
  });

  it('handles custom base URL', () => {
    setAIComposeConfig({ baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama' });
    const config = getAIComposeConfig();
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('saves provider selection', () => {
    setAIComposeConfig({ provider: 'crispasr' });
    expect(getAIComposeConfig().provider).toBe('crispasr');
  });

  it('saves mistral.rs provider', () => {
    setAIComposeConfig({ provider: 'mistral-rs', mistralrsModel: 'mistral-7b-instruct' });
    const config = getAIComposeConfig();
    expect(config.provider).toBe('mistral-rs');
    expect(config.mistralrsModel).toBe('mistral-7b-instruct');
  });

  it('saves CrispASR model config', () => {
    setAIComposeConfig({ provider: 'crispasr', crispasrModel: 'llava-v1.6' });
    const config = getAIComposeConfig();
    expect(config.crispasrModel).toBe('llava-v1.6');
  });
});

describe('isAIConfigured', () => {
  it('returns false when no API key for openai provider', () => {
    expect(isAIConfigured()).toBe(false);
  });

  it('returns true when API key is set for openai', () => {
    setAIComposeConfig({ apiKey: 'sk-test' });
    expect(isAIConfigured()).toBe(true);
  });

  it('returns false for empty string API key', () => {
    setAIComposeConfig({ apiKey: '' });
    expect(isAIConfigured()).toBe(false);
  });

  it('returns true for crispasr provider without API key', () => {
    setAIComposeConfig({ provider: 'crispasr' });
    expect(isAIConfigured()).toBe(true);
  });

  it('returns true for mistral-rs provider without API key', () => {
    setAIComposeConfig({ provider: 'mistral-rs' });
    expect(isAIConfigured()).toBe(true);
  });
});

describe('runAIAction', () => {
  it('throws when no API key configured for openai', async () => {
    await expect(runAIAction('correct', 'Hello wrold')).rejects.toThrow('API key not configured');
  });

  it('calls the correct endpoint with proper headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello world' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' };
    const result = await runAIAction('correct', 'Hello wrold', config);

    expect(result.text).toBe('Hello world');
    expect(result.action).toBe('correct');
    expect(result.provider).toBe('openai');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('test-model');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toBe('Hello wrold');

    vi.unstubAllGlobals();
  });

  it('uses low temperature for corrections', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'fixed' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    await runAIAction('correct', 'text', config);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.1);

    vi.unstubAllGlobals();
  });

  it('uses higher temperature for hashtags', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '#test' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    await runAIAction('hashtags', 'text', config);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.5);

    vi.unstubAllGlobals();
  });

  it('throws on API error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'bad', model: 'model' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('Invalid API key');

    vi.unstubAllGlobals();
  });

  it('throws on empty response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('empty response');

    vi.unstubAllGlobals();
  });

  it('strips trailing slash from base URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1/', apiKey: 'key', model: 'model' };
    await runAIAction('correct', 'text', config);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');

    vi.unstubAllGlobals();
  });

  it('handles each action type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'result' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    for (const action of ['correct', 'shorten', 'hashtags', 'alt-text'] as const) {
      const result = await runAIAction(action, 'input text', config);
      expect(result.action).toBe(action);
      expect(result.text).toBe('result');
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  });

  it('sends image as vision content for alt-text with imageDataUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'A cat sitting on a desk' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'gpt-4o' };
    const result = await runAIAction('alt-text', '', config, 'data:image/png;base64,iVBORw0KGgo=');

    expect(result.text).toBe('A cat sitting on a desk');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userContent = body.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent).toHaveLength(2);
    expect(userContent[0].type).toBe('text');
    expect(userContent[1].type).toBe('image_url');
    expect(userContent[1].image_url.url).toBe('data:image/png;base64,iVBORw0KGgo=');

    vi.unstubAllGlobals();
  });

  it('CrispASR provider throws when not in Tauri', async () => {
    const config = { provider: 'crispasr' as const, baseUrl: '', apiKey: '', model: '' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('desktop app');
  });

  it('mistral.rs provider throws when not in Tauri', async () => {
    const config = { provider: 'mistral-rs' as const, baseUrl: '', apiKey: '', model: '' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('desktop app');
  });
});
