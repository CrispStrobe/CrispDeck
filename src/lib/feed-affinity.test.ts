import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The For You ranking needs 1,500 records out of IndexedDB. Nothing else does.
 * The feed always starts in timeline mode, so reading them on mount put that
 * work between opening the app and seeing a post, and threw it away on every
 * load where the reader never switched modes.
 */
describe('affinity data is loaded only when For You needs it', () => {
  const src = readFileSync('src/routes/feed/+page.svelte', 'utf8');

  it('does not read the archive during onMount', () => {
    const onMount = src.slice(src.indexOf('onMount('), src.indexOf('onDestroy('));
    expect(onMount).not.toMatch(/searchArchive\(/);
  });

  it('reads it when switching into For You', () => {
    expect(src).toMatch(/if \(mode === 'for-you'\) await loadAffinity\(\)/);
  });

  it('reads it at most once, sharing the work between rapid switches', () => {
    // Memoised on the promise, not the result: two switches in quick
    // succession must not start two reads.
    expect(src).toMatch(/affinityPromise \?\?=/);
  });

  it('lets a failed read be retried rather than disabling the feature', () => {
    // A transient IndexedDB error should not leave For You permanently
    // unranked for the rest of the session.
    expect(src).toMatch(/affinityPromise = null/);
  });

  it('still starts in timeline mode, which is what makes this worth doing', () => {
    expect(src).toMatch(/let feedMode: FeedMode = \$state\('timeline'\)/);
  });
});
