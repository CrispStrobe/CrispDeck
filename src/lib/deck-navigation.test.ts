import { beforeEach, describe, expect, it } from 'vitest';
import { backToDeckLabel, deckColumnCount, detailCameFromDeck, recordDetailOrigin } from './deck-navigation';

describe('Deck detail navigation', () => {
  beforeEach(() => sessionStorage.clear());
  it('keeps the Deck origin across nested post and profile views and clears it elsewhere', () => {
    recordDetailOrigin('/deck', '/thread');
    expect(detailCameFromDeck()).toBe(true);
    recordDetailOrigin('/thread', '/profile');
    expect(detailCameFromDeck()).toBe(true);
    recordDetailOrigin('/profile', '/feed');
    expect(detailCameFromDeck()).toBe(false);
    recordDetailOrigin('/feed', '/thread');
    expect(detailCameFromDeck()).toBe(false);
  });
  it('uses German destination and column count labels', () => {
    expect(backToDeckLabel('de')).toBe('Zurück zum Deck');
    expect(deckColumnCount('de', 3)).toBe('3 Spalten');
  });
});
