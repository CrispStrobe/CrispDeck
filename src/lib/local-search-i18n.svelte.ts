/** Optional feature copy stays out of the application shell's download. */
import { i18n, type Language } from './i18n.svelte';
import { swallow } from './debug-log';
import en, { type LocalSearchTranslations } from './local-search-locales/en';

const loaders = {
  de: () => import('./local-search-locales/de'),
  fr: () => import('./local-search-locales/fr'),
  es: () => import('./local-search-locales/es'),
  ja: () => import('./local-search-locales/ja'),
  pt: () => import('./local-search-locales/pt'),
  zh: () => import('./local-search-locales/zh'),
  ar: () => import('./local-search-locales/ar'),
};
const loaded: Partial<Record<Language, LocalSearchTranslations>> = { en };
const pending: Partial<Record<Language, Promise<LocalSearchTranslations>>> = {};

/** Coalesce language loads across the search/settings page and its controls. */
export function loadLocalSearchTranslations(language: Language): Promise<LocalSearchTranslations> {
  const ready = loaded[language];
  if (ready) return Promise.resolve(ready);
  const loading = pending[language];
  if (loading) return loading;
  const loader = language === 'en' ? undefined : loaders[language];
  if (!loader) return Promise.resolve(en);
  const request = loader().then(module => {
    loaded[language] = module.default;
    delete pending[language];
    return module.default;
  }, error => {
    delete pending[language];
    throw error;
  });
  pending[language] = request;
  return request;
}

/** Call during component setup; follows language changes and cleans up on exit. */
export function useLocalSearchTranslations() {
  let copy = $state<LocalSearchTranslations>(loaded[i18n.lang] ?? en);
  $effect(() => {
    const language = i18n.lang;
    let active = true;
    copy = loaded[language] ?? en;
    if (!loaded[language]) {
      void loadLocalSearchTranslations(language).then(value => {
        if (active) copy = value;
      }).catch(error => swallow('local-search.i18n', error));
    }
    return () => { active = false; };
  });
  return { get t() { return copy; } };
}
