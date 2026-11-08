import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import { i18n } from '$lib/i18n.svelte';
import ThreadsFeedSources from './ThreadsFeedSources.svelte';

describe('Threads feed source localization', () => {
  afterEach(() => { i18n.setLanguage('en'); document.body.innerHTML = ''; });
  it('renders the explanation and import action in German', async () => {
    i18n.setLanguage('de');
    const target = document.createElement('div'); document.body.append(target);
    const app = createClassComponent({ component: ThreadsFeedSources, target, props: { account: '@c_stroebele' } });
    flushSync();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Threads-Feedquellen für @c_stroebele'); });
    expect(target.textContent).toContain('Abonnementliste importieren');
    expect(target.textContent).toContain('mindestens 100 Follower');
    app.$destroy();
  });
});
