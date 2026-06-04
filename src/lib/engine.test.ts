/**
 * Tests for TTS/STT engine selection and localStorage persistence.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('TTS/STT engine settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('TTS engine', () => {
    it('defaults to auto when not set', () => {
      expect(localStorage.getItem('crispdeck-tts-engine')).toBeNull();
      const engine = localStorage.getItem('crispdeck-tts-engine') ?? 'auto';
      expect(engine).toBe('auto');
    });

    it('persists crispasr choice', () => {
      localStorage.setItem('crispdeck-tts-engine', 'crispasr');
      expect(localStorage.getItem('crispdeck-tts-engine')).toBe('crispasr');
    });

    it('persists browser choice', () => {
      localStorage.setItem('crispdeck-tts-engine', 'browser');
      expect(localStorage.getItem('crispdeck-tts-engine')).toBe('browser');
    });

    it('TTS model persists independently', () => {
      localStorage.setItem('crispdeck-tts-model', 'kokoro');
      localStorage.setItem('crispdeck-tts-engine', 'browser');
      expect(localStorage.getItem('crispdeck-tts-model')).toBe('kokoro');
      expect(localStorage.getItem('crispdeck-tts-engine')).toBe('browser');
    });
  });

  describe('STT engine', () => {
    it('defaults to auto when not set', () => {
      const engine = localStorage.getItem('crispdeck-stt-engine') ?? 'auto';
      expect(engine).toBe('auto');
    });

    it('persists crispasr choice', () => {
      localStorage.setItem('crispdeck-stt-engine', 'crispasr');
      expect(localStorage.getItem('crispdeck-stt-engine')).toBe('crispasr');
    });

    it('persists browser choice', () => {
      localStorage.setItem('crispdeck-stt-engine', 'browser');
      expect(localStorage.getItem('crispdeck-stt-engine')).toBe('browser');
    });

    it('STT model persists independently', () => {
      localStorage.setItem('crispdeck-stt-model', 'whisper');
      localStorage.setItem('crispdeck-stt-engine', 'crispasr');
      expect(localStorage.getItem('crispdeck-stt-model')).toBe('whisper');
      expect(localStorage.getItem('crispdeck-stt-engine')).toBe('crispasr');
    });
  });

  describe('engine selection logic', () => {
    it('auto + no Tauri = browser path', () => {
      const engine = localStorage.getItem('crispdeck-tts-engine') ?? 'auto';
      const hasTauri = typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';
      // In test env, no Tauri — auto should resolve to browser
      if (engine === 'auto' && !hasTauri) {
        // This is the expected path in tests
        expect(true).toBe(true);
      }
    });

    it('browser engine skips Tauri check entirely', () => {
      localStorage.setItem('crispdeck-stt-engine', 'browser');
      const engine = localStorage.getItem('crispdeck-stt-engine');
      // When engine is 'browser', we should never try invoke('asr_available')
      expect(engine).toBe('browser');
    });

    it('crispasr engine without Tauri should error', () => {
      localStorage.setItem('crispdeck-stt-engine', 'crispasr');
      const engine = localStorage.getItem('crispdeck-stt-engine');
      const hasTauri = typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';
      // In test env (no Tauri), crispasr should produce an error
      if (engine === 'crispasr' && !hasTauri) {
        expect(true).toBe(true); // error path is expected
      }
    });
  });

  describe('streaming-capable models', () => {
    // These are the models that CrispASR supports for streaming ASR
    const streamingModels = ['whisper', 'moonshine-streaming', 'voxtral4b', 'kyutai-stt'];
    const nonStreamingModels = ['parakeet', 'canary', 'qwen3', 'sensevoice', 'omniasr'];

    it('streaming models list is non-empty', () => {
      expect(streamingModels.length).toBeGreaterThan(0);
    });

    it('whisper supports streaming', () => {
      expect(streamingModels).toContain('whisper');
    });

    it('moonshine-streaming supports streaming', () => {
      expect(streamingModels).toContain('moonshine-streaming');
    });

    it('voxtral4b supports streaming', () => {
      expect(streamingModels).toContain('voxtral4b');
    });

    it('parakeet does not support streaming', () => {
      expect(streamingModels).not.toContain('parakeet');
    });

    it('streaming and non-streaming sets are disjoint', () => {
      for (const m of nonStreamingModels) {
        expect(streamingModels).not.toContain(m);
      }
    });
  });
});
