import { describe, it, expect } from 'vitest';
import { routePath } from './routes';

describe('routePath at the root (the Vercel deployment)', () => {
  it('passes every path through untouched', () => {
    for (const p of ['/', '/feed', '/settings?tab=account', '/thread']) {
      expect(routePath(p, '')).toBe(p);
    }
  });

  it('never returns an empty string', () => {
    expect(routePath('', '')).toBe('/');
  });
});

describe('routePath under a mount point (GitHub Pages)', () => {
  const M = '/CrispDeck';

  it('strips the mount point off a route', () => {
    expect(routePath('/CrispDeck/feed', M)).toBe('/feed');
    expect(routePath('/CrispDeck/settings', M)).toBe('/settings');
  });

  it('maps the mount point itself to the home route', () => {
    expect(routePath('/CrispDeck', M)).toBe('/');
  });

  it('maps the mount point with a trailing slash to the home route', () => {
    expect(routePath('/CrispDeck/', M)).toBe('/');
  });

  it('keeps nested routes intact', () => {
    expect(routePath('/CrispDeck/oauth/bsky-callback', M)).toBe('/oauth/bsky-callback');
  });

  it('does not strip a path that merely starts with the same letters', () => {
    // '/CrispDeckchen' is not inside '/CrispDeck'. Slicing blindly would turn
    // it into 'chen' and match nothing — or worse, match the wrong thing.
    expect(routePath('/CrispDeckchen/feed', M)).toBe('/CrispDeckchen/feed');
  });

  it('leaves a path outside the mount point alone', () => {
    expect(routePath('/somewhere-else', M)).toBe('/somewhere-else');
  });
});

describe('round trip', () => {
  it('link then compare gives back the original route', () => {
    // This is the invariant the sidebar depends on: an href built as
    // `${base}${route}` must compare equal to `route` after routePath.
    for (const mount of ['', '/CrispDeck']) {
      for (const route of ['/', '/feed', '/deck', '/oauth/callback']) {
        const href = route === '/' ? mount || '/' : `${mount}${route}`;
        expect(routePath(href, mount)).toBe(route);
      }
    }
  });
});
