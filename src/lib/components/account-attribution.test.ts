// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AccountAttribution from './AccountAttribution.svelte';
describe('account attribution', () => {
  it.each([
    ['bluesky','cstroebele.bsky.social','Bluesky','@cstroebele'],
    ['mastodon','@c_stroebele@mastodon.social','Mastodon','@c_stroebele'],
    ['threads','christian','Threads','@christian'],
  ] as const)('shows the %s logo and identifies the account', (platform, account, name, short) => {
    const target=document.createElement('div');document.body.appendChild(target);
    const component=mount(AccountAttribution,{target,props:{platform,account}});flushSync();
    const badge=target.querySelector('[aria-label]')!;
    expect(badge.getAttribute('aria-label')).toBe(`${name}: ${account}`);
    expect(badge.textContent).toContain(short);
    expect(target.querySelector('img')?.getAttribute('src')).toContain(`/platform-icons/${platform}.svg`);
    unmount(component);target.remove();
  });
});
