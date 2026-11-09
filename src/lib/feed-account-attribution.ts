import type { Account, Platform } from '$lib/types';

/** Attribution is useful only when this provider has more than one source account. */
export function needsAccountAttribution(accounts: Account[], platform: Platform): boolean {
  return accounts.filter(account => account.platform === platform).length > 1;
}
