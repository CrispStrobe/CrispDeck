import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DestinationPreviews from './DestinationPreviews.svelte';
import type { Account } from '$lib/types';

let instance: ReturnType<typeof mount> | undefined;
afterEach(() => { if (instance) unmount(instance); instance = undefined; document.body.innerHTML = ''; });

function render(platform: Account['platform'], threadsMediaUrl = '') {
  const target = document.createElement('div'); document.body.append(target);
  instance = mount(DestinationPreviews, { target, props: {
    accounts: [{ id: 1, platform, handle: 'writer.example' } as Account], selected: [1], sharedText: 'Hello', overrides: {},
    mediaPreviews: ['blob:local-photo'], mediaTypes: ['image/png'], altTexts: ['A photo'], threadsMediaUrl,
    visibility: 'public', contentWarning: '', threadGate: 'everyone', disableQuotes: false, selfLabel: 'none',
  } });
  flushSync();
  return target;
}

describe('destination media previews match the delivery source', () => {
  it('uses the public media URL for Threads', () => {
    const target = render('threads', 'https://media.example/photo.png');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://media.example/photo.png');
  });
  it('explains a missing Threads URL instead of previewing an undeliverable local file', () => {
    const target = render('threads');
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain('Threads needs a public HTTPS URL');
  });
  it('keeps local media for Mastodon even when a Threads URL is supplied', () => {
    const target = render('mastodon', 'https://media.example/photo.png');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('blob:local-photo');
  });
});
