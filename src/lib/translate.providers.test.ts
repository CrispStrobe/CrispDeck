/**
 * Tests for translation provider switching and config validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('translate provider config', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('switches between all 3 providers', async () => {
    const { setTranslateConfig, getTranslateConfig } = await import('./translate');

    setTranslateConfig({ provider: 'mymemory' });
    expect(getTranslateConfig().provider).toBe('mymemory');

    setTranslateConfig({ provider: 'openai' });
    expect(getTranslateConfig().provider).toBe('openai');

    setTranslateConfig({ provider: 'crispasr' });
    expect(getTranslateConfig().provider).toBe('crispasr');
  });

  it('OpenAI config preserves all fields', async () => {
    const { setTranslateConfig, getTranslateConfig } = await import('./translate');
    setTranslateConfig({
      provider: 'openai',
      openaiBaseUrl: 'http://localhost:11434/v1',
      openaiApiKey: 'test-key-123',
      openaiModel: 'llama3.2',
    });
    const cfg = getTranslateConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.openaiBaseUrl).toBe('http://localhost:11434/v1');
    expect(cfg.openaiApiKey).toBe('test-key-123');
    expect(cfg.openaiModel).toBe('llama3.2');
  });

  it('CrispASR config preserves model', async () => {
    const { setTranslateConfig, getTranslateConfig } = await import('./translate');
    setTranslateConfig({ provider: 'crispasr', crispasrModel: 'madlad' });
    expect(getTranslateConfig().crispasrModel).toBe('madlad');
  });

  it('switching provider does not lose other provider config', async () => {
    const { setTranslateConfig, getTranslateConfig } = await import('./translate');
    setTranslateConfig({ provider: 'openai', openaiModel: 'gpt-4o' });
    setTranslateConfig({ provider: 'crispasr', crispasrModel: 'm2m100' });
    // Switch back — openai config should still be there
    setTranslateConfig({ provider: 'openai' });
    const cfg = getTranslateConfig();
    expect(cfg.openaiModel).toBe('gpt-4o');
    expect(cfg.crispasrModel).toBe('m2m100');
  });

  it('target language persists across provider switches', async () => {
    const { setTranslateConfig, getTranslateConfig } = await import('./translate');
    setTranslateConfig({ targetLang: 'ja' });
    setTranslateConfig({ provider: 'openai' });
    expect(getTranslateConfig().targetLang).toBe('ja');
  });

  it('invalid JSON in localStorage returns defaults', async () => {
    localStorage.setItem('crispdeck-translate-config', 'not-json');
    const { getTranslateConfig } = await import('./translate');
    const cfg = getTranslateConfig();
    expect(cfg.provider).toBe('mymemory');
    expect(cfg.targetLang).toBe('en');
  });

  it('empty localStorage returns defaults', async () => {
    const { getTranslateConfig } = await import('./translate');
    const cfg = getTranslateConfig();
    expect(cfg.provider).toBe('mymemory');
    expect(cfg.targetLang).toBe('en');
  });
});
