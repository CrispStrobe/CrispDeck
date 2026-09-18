/**
 * TTS/STT engine selection.
 *
 * Previously asserted against localStorage directly, so it could not fail when
 * the settings page or the compose dictation changed. Now exercises
 * $lib/settings, which both of those use.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTtsEngine, setTtsEngine, getSttEngine, setSttEngine,
  SPEECH_ENGINES, type SpeechEngine,
} from './settings';

beforeEach(() => localStorage.clear());

describe('TTS engine', () => {
  it('defaults to auto', () => {
    expect(getTtsEngine()).toBe('auto');
  });

  it('round-trips each engine', () => {
    for (const engine of SPEECH_ENGINES) {
      setTtsEngine(engine);
      expect(getTtsEngine()).toBe(engine);
    }
  });

  it('writes the key the settings page reads', () => {
    setTtsEngine('crispasr');
    expect(localStorage.getItem('crispdeck-tts-engine')).toBe('crispasr');
  });

  it('falls back to auto for an unknown value', () => {
    localStorage.setItem('crispdeck-tts-engine', 'festival');
    expect(getTtsEngine()).toBe('auto');
  });
});

describe('STT engine', () => {
  it('defaults to auto', () => {
    expect(getSttEngine()).toBe('auto');
  });

  it('round-trips each engine', () => {
    for (const engine of SPEECH_ENGINES) {
      setSttEngine(engine);
      expect(getSttEngine()).toBe(engine);
    }
  });

  it('writes the key compose reads for dictation', () => {
    setSttEngine('browser');
    expect(localStorage.getItem('crispdeck-stt-engine')).toBe('browser');
  });

  it('falls back to auto for an unknown value', () => {
    localStorage.setItem('crispdeck-stt-engine', 'sphinx');
    expect(getSttEngine()).toBe('auto');
  });
});

describe('the two engines are independent', () => {
  it('setting one does not move the other', () => {
    setTtsEngine('crispasr');
    setSttEngine('browser');
    expect(getTtsEngine()).toBe('crispasr');
    expect(getSttEngine()).toBe('browser');
  });
});

describe('storage failures', () => {
  it('reading falls back to the default rather than throwing', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    try {
      expect(getTtsEngine()).toBe('auto');
      expect(() => setTtsEngine('browser')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});
