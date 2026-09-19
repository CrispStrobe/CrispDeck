/**
 * Normalising what the user types during sign-in.
 *
 * People paste "https://mastodon.social/" and type "@alice.bsky.social", and
 * the APIs want "mastodon.social" and "alice.bsky.social". The cleaning was
 * written inline at each call site and had already diverged — one site trimmed
 * surrounding whitespace before stripping the @, another did not — so a handle
 * pasted with a trailing space failed to sign in from one screen and worked
 * from the next.
 */

/** Host only: no scheme, no trailing slash, no surrounding whitespace. */
export function cleanInstanceUrl(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The https:// origin for a cleaned host. */
export function buildInstanceUrl(cleaned: string): string {
  return `https://${cleaned}`;
}

/** Handle without a leading @ or surrounding whitespace. */
export function cleanBskyHandle(input: string): string {
  return input.trim().replace(/^@/, '');
}

/**
 * Whether the user has completed first-run setup.
 *
 * Note: the app writes this flag but has never read it — onboarding is gated on
 * whether any account exists. Kept because it is written on both sign-in paths
 * and something is presumably meant to consult it; wiring it into the gating is
 * a behaviour change, not a refactor.
 */
const FIRST_RUN_KEY = 'crispdeck-first-run-complete';

export function markFirstRunComplete(): void {
  localStorage.setItem(FIRST_RUN_KEY, 'true');
}

export function isFirstRunComplete(): boolean {
  return localStorage.getItem(FIRST_RUN_KEY) === 'true';
}

export function resetFirstRun(): void {
  localStorage.removeItem(FIRST_RUN_KEY);
}
