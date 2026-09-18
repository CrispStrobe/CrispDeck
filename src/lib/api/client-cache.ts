/**
 * Generation counter for the client-factory cache.
 *
 * Lives in its own module with no imports so that db.ts can invalidate the
 * cache without depending on client-factory (which depends on db.ts), and
 * without pulling @atproto/api into routes that only touch the database.
 */
let generation = 0;

/** Called whenever the set of accounts or their credentials change. */
export function bumpClientCache(): void {
  generation++;
}

export function clientCacheGeneration(): number {
  return generation;
}
