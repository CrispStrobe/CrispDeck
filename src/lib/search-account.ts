/** A federated Mastodon address has an explicit user and instance. */
export function isMastodonHandle(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value.trim().replace(/^@/, ''));
}
