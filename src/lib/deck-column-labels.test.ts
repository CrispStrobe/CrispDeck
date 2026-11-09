import { describe, expect, it } from 'vitest';
import { deckColumnLabels } from './deck-column-labels';
import type { Language } from './i18n.svelte';

describe('deck column labels', () => {
  it('provides every column label for every supported language', () => {
    const english = deckColumnLabels('en');
    for (const language of ['en', 'de', 'fr', 'es', 'pt', 'ja', 'zh', 'ar'] as Language[]) {
      const labels = deckColumnLabels(language);
      expect(labels.map(item => item.type)).toEqual(english.map(item => item.type));
      expect(labels.every(item => typeof item.label === 'string' && item.label.trim().length > 0)).toBe(true);
    }
  });
});
