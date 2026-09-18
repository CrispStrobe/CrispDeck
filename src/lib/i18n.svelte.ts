/**
 * Translation service.
 *
 * English is imported statically — it is the fallback every other language
 * merges over, so it is always needed. The other seven are separate chunks
 * loaded on demand: together they were ~47 KB raw / 14 KB gzip sitting in a
 * chunk every route pulls in, to serve one language per visitor.
 *
 * A language that isn't loaded yet renders as English and switches over when
 * its chunk arrives. `ready` resolves once the saved language is in place, for
 * callers that would rather wait than show the fallback.
 */
import en from './i18n/en';

export type Language = 'en' | 'de' | 'fr' | 'es' | 'ja' | 'pt' | 'zh' | 'ar';
export type Strings = typeof en;

export const LANGUAGES: Language[] = ['en', 'de', 'fr', 'es', 'ja', 'pt', 'zh', 'ar'];

const RTL_LANGUAGES: Language[] = ['ar'];

/** Static map of dynamic imports so the bundler can see every chunk. */
const loaders: Record<Exclude<Language, 'en'>, () => Promise<{ default: Record<string, any> }>> = {
  de: () => import('./i18n/de'),
  fr: () => import('./i18n/fr'),
  es: () => import('./i18n/es'),
  ja: () => import('./i18n/ja'),
  pt: () => import('./i18n/pt'),
  zh: () => import('./i18n/zh'),
  ar: () => import('./i18n/ar'),
};

function deepMerge(target: any, fallback: any): any {
  const result: any = { ...fallback };
  for (const key of Object.keys(target)) {
    if (typeof target[key] === 'object' && target[key] !== null && typeof fallback[key] === 'object') {
      result[key] = deepMerge(target[key], fallback[key]);
    } else {
      result[key] = target[key];
    }
  }
  return result;
}

export class TranslationService {
  lang = $state<Language>('en');
  /** Language packs fetched so far. English is there from the start. */
  private packs = $state<Partial<Record<Language, Record<string, any>>>>({ en });
  /** Resolves once the initially selected language has loaded. */
  ready: Promise<void> = Promise.resolve();

  t: Strings = $derived(
    this.lang === 'en'
      ? en
      : (deepMerge(this.packs[this.lang] ?? {}, en) as Strings)
  );
  isRtl = $derived(RTL_LANGUAGES.includes(this.lang));
  dir = $derived(RTL_LANGUAGES.includes(this.lang) ? 'rtl' as const : 'ltr' as const);

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('crispdeck-language') as Language | null;
      if (saved && LANGUAGES.includes(saved)) {
        this.lang = saved;
        this.ready = this.load(saved);
      }
    }
  }

  /** Fetch a language pack if it isn't already loaded. */
  async load(l: Language): Promise<void> {
    if (l === 'en' || this.packs[l]) return;
    try {
      const module = await loaders[l as Exclude<Language, 'en'>]();
      this.packs = { ...this.packs, [l]: module.default };
    } catch {
      // Chunk failed to load; English stays in place rather than blank strings.
    }
  }

  setLanguage(l: Language) {
    this.lang = l;
    this.ready = this.load(l);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('crispdeck-language', l);
    }
    // Update document direction for RTL support
    if (typeof document !== 'undefined') {
      document.documentElement.dir = RTL_LANGUAGES.includes(l) ? 'rtl' : 'ltr';
    }
  }
}

export const i18n = new TranslationService();
