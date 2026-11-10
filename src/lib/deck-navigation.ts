const key = 'crispdeck-detail-origin';
export function recordDetailOrigin(from: string, to: string): void {
  try {
    const detail = (path: string) => path === '/thread' || path === '/profile';
    if (detail(to) && (from === '/deck' || from === '/search')) sessionStorage.setItem(key, from.slice(1));
    else if (!detail(from) || !detail(to)) sessionStorage.removeItem(key);
  } catch { /* storage may be unavailable */ }
}
export function detailCameFromDeck(): boolean {
  try { return sessionStorage.getItem(key) === 'deck'; } catch { return false; }
}

export function detailCameFromSearch(): boolean {
  try { return sessionStorage.getItem(key) === 'search'; } catch { return false; }
}
