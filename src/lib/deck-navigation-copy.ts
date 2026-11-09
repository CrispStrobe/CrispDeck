import type { Language } from './i18n.svelte';

const backLabels: Record<Language, string> = { en: 'Back to Deck', de: 'Zurück zum Deck', fr: 'Retour au Deck', es: 'Volver al Deck', pt: 'Voltar ao Deck', ja: 'デッキに戻る', zh: '返回多栏', ar: 'العودة إلى الأعمدة' };
const longColumns: Record<Language, string> = { en: 'columns', de: 'Spalten', fr: 'colonnes', es: 'columnas', pt: 'colunas', ja: '列', zh: '栏', ar: 'أعمدة' };
export const backToDeckLabel = (lang: Language) => backLabels[lang];
export const deckColumnCount = (lang: Language, count: number) => `${count} ${longColumns[lang]}`;
