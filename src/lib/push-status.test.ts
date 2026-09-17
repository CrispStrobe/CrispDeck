import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Web push is off on purpose, and the reason is easy to mistake for a missing
 * configuration value. These assert the shape of that decision so it is not
 * quietly undone by someone adding VAPID keys and assuming it now works.
 */
describe('web push is not silently half-enabled', () => {
  const send = readFileSync('api/push/send.ts', 'utf8');

  it('the cron handler still sends nothing, and says so', () => {
    // If someone implements it, this test should fail and be rewritten — that
    // is the point. What must not happen is the env vars being set while the
    // handler is still a stub.
    expect(send).toMatch(/DO NOT set those env vars/);
    // Matching the source for a call is no good: the TODO comment names one.
    // The dependency an implementation would need is the honest signal.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('web-push');
  });

  it('records why it cannot be finished as configuration', () => {
    // The blocker is credential custody, not a key. Losing that note is how
    // this gets "fixed" into a privacy-policy violation.
    expect(send).toMatch(/credentials/i);
    expect(send).toMatch(/privacy policy/i);
  });

  it('the privacy policy still makes the promise this rests on', () => {
    const en = readFileSync('src/lib/i18n.svelte.ts', 'utf8');
    expect(en).toMatch(/None of this data is transmitted to the developer or any third party/);
  });
});
