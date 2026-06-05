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
});

describe('isAIConfigured', () => {
  it('returns false when no API key', () => {
    expect(isAIConfigured()).toBe(false);
  });

  it('returns true when API key is set', () => {
    setAIComposeConfig({ apiKey: 'sk-test' });
    expect(isAIConfigured()).toBe(true);
  });

  it('returns false for empty string API key', () => {
    setAIComposeConfig({ apiKey: '' });
    expect(isAIConfigured()).toBe(false);
  });
});

describe('runAIAction', () => {
  it('throws when no API key configured', async () => {
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

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' };
    const result = await runAIAction('correct', 'Hello wrold', config);

    expect(result.text).toBe('Hello world');
    expect(result.action).toBe('correct');
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

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
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

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
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

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'bad', model: 'model' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('Invalid API key');

    vi.unstubAllGlobals();
  });

  it('throws on empty response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    await expect(runAIAction('correct', 'text', config)).rejects.toThrow('empty response');

    vi.unstubAllGlobals();
  });

  it('strips trailing slash from base URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { baseUrl: 'https://api.example.com/v1/', apiKey: 'key', model: 'model' };
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

    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' };
    for (const action of ['correct', 'shorten', 'hashtags', 'alt-text'] as const) {
      const result = await runAIAction(action, 'input text', config);
      expect(result.action).toBe(action);
      expect(result.text).toBe('result');
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  });
});
