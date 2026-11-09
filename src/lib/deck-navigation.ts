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
