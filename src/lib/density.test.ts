import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDensity, saveDensity, applyDensity, initDensity, getDensityOptions, type DensityMode } from './density';

describe('density', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getDensity', () => {
    it('returns comfortable by default', () => {
      expect(getDensity()).toBe('comfortable');
    });

    it('returns saved compact mode', () => {
      store['crispdeck-density'] = 'compact';
      expect(getDensity()).toBe('compact');
    });

    it('returns saved spacious mode', () => {
      store['crispdeck-density'] = 'spacious';
      expect(getDensity()).toBe('spacious');
    });

    it('returns comfortable for invalid saved value', () => {
      store['crispdeck-density'] = 'invalid';
      expect(getDensity()).toBe('comfortable');
    });
  });

  describe('saveDensity', () => {
    it('saves compact mode to localStorage', () => {
      saveDensity('compact');
      expect(store['crispdeck-density']).toBe('compact');
    });

    it('saves spacious mode to localStorage', () => {
      saveDensity('spacious');
      expect(store['crispdeck-density']).toBe('spacious');
    });
  });

  describe('applyDensity', () => {
    let setPropertyCalls: [string, string][] = [];
    let datasetDensity = '';

    beforeEach(() => {
      setPropertyCalls = [];
      datasetDensity = '';
      vi.stubGlobal('document', {
        documentElement: {
          style: {
            setProperty: (key: string, value: string) => { setPropertyCalls.push([key, value]); },
          },
          dataset: new Proxy({}, {
            set: (_target, prop, value) => {
              if (prop === 'density') datasetDensity = value;
              return true;
            },
          }),
        },
      });
    });

    it('sets compact CSS variables', () => {
      applyDensity('compact');
      const vars = Object.fromEntries(setPropertyCalls);
      expect(vars['--density-avatar']).toBe('28px');
      expect(vars['--density-padding']).toBe('8px');
      expect(vars['--density-gap']).toBe('6px');
      expect(vars['--density-font-scale']).toBe('0.9');
    });

    it('sets comfortable CSS variables', () => {
      applyDensity('comfortable');
      const vars = Object.fromEntries(setPropertyCalls);
      expect(vars['--density-avatar']).toBe('40px');
      expect(vars['--density-padding']).toBe('16px');
      expect(vars['--density-gap']).toBe('12px');
      expect(vars['--density-font-scale']).toBe('1');
    });

    it('sets spacious CSS variables', () => {
      applyDensity('spacious');
      const vars = Object.fromEntries(setPropertyCalls);
      expect(vars['--density-avatar']).toBe('48px');
      expect(vars['--density-padding']).toBe('20px');
      expect(vars['--density-gap']).toBe('16px');
      expect(vars['--density-font-scale']).toBe('1.05');
    });

    it('sets data-density attribute on root', () => {
      applyDensity('compact');
      expect(datasetDensity).toBe('compact');
    });

    it('sets all 7 CSS custom properties', () => {
      applyDensity('comfortable');
      expect(setPropertyCalls.length).toBe(7);
      const keys = setPropertyCalls.map(([k]) => k);
      expect(keys).toContain('--density-avatar');
      expect(keys).toContain('--density-avatar-sm');
      expect(keys).toContain('--density-padding');
      expect(keys).toContain('--density-gap');
      expect(keys).toContain('--density-card-padding');
      expect(keys).toContain('--density-font-scale');
      expect(keys).toContain('--density-line-clamp');
    });
  });

  describe('initDensity', () => {
    it('applies the saved density mode', () => {
      store['crispdeck-density'] = 'spacious';
      const setPropertyCalls: [string, string][] = [];
      vi.stubGlobal('document', {
        documentElement: {
          style: {
            setProperty: (key: string, value: string) => { setPropertyCalls.push([key, value]); },
          },
          dataset: {},
        },
      });
      initDensity();
      const vars = Object.fromEntries(setPropertyCalls);
      expect(vars['--density-avatar']).toBe('48px');
    });

    it('defaults to comfortable when nothing saved', () => {
      const setPropertyCalls: [string, string][] = [];
      vi.stubGlobal('document', {
        documentElement: {
          style: {
            setProperty: (key: string, value: string) => { setPropertyCalls.push([key, value]); },
          },
          dataset: {},
        },
      });
      initDensity();
      const vars = Object.fromEntries(setPropertyCalls);
      expect(vars['--density-avatar']).toBe('40px');
    });
  });

  describe('getDensityOptions', () => {
    it('returns 3 options', () => {
      const options = getDensityOptions();
      expect(options).toHaveLength(3);
    });

    it('includes all modes', () => {
      const options = getDensityOptions();
      const modes = options.map(o => o.mode);
      expect(modes).toEqual(['compact', 'comfortable', 'spacious']);
    });

    it('has labels for all modes', () => {
      const options = getDensityOptions();
      for (const opt of options) {
        expect(opt.label).toBeTruthy();
        expect(opt.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('DensityMode type', () => {
    it('only allows valid modes', () => {
      const validModes: DensityMode[] = ['compact', 'comfortable', 'spacious'];
      expect(validModes).toHaveLength(3);
    });
  });
});
