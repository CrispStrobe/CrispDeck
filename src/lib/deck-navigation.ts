import type { Language } from './i18n.svelte';

const backLabels: Record<Language, string> = { en: 'Back to Deck', de: 'Zurück zum Deck', fr: 'Retour au Deck', es: 'Volver al Deck', pt: 'Voltar ao Deck', ja: 'デッキに戻る', zh: '返回多栏', ar: 'العودة إلى الأعمدة' };
const longColumns: Record<Language, string> = { en: 'columns', de: 'Spalten', fr: 'colonnes', es: 'columnas', pt: 'colunas', ja: '列', zh: '栏', ar: 'أعمدة' };
export const backToDeckLabel = (lang: Language) => backLabels[lang];
export const deckColumnCount = (lang: Language, count: number) => `${count} ${longColumns[lang]}`;
const key = 'crispdeck-detail-origin';
export function recordDetailOrigin(from: string, to: string): void {
  try {
    const detail = (path: string) => path === '/thread' || path === '/profile';
    if (detail(to) && from === '/deck') sessionStorage.setItem(key, 'deck');
    else if (!detail(from) || !detail(to)) sessionStorage.removeItem(key);
  } catch { /* storage may be unavailable */ }
}
export function detailCameFromDeck(): boolean {
  try { return sessionStorage.getItem(key) === 'deck'; } catch { return false; }
}
