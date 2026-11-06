// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import BlueskyVideo from './BlueskyVideo.svelte';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('turns the preview into a native HLS player and exposes controls', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(BlueskyVideo, { target, props: { playlist: 'https://video.bsky.app/playlist.m3u8', thumbnail: 'https://video.bsky.app/poster.jpg', postUrl: 'https://bsky.app/profile/a/post/b' } });
  flushSync();
  flushSync(() => (target.querySelector('button') as HTMLButtonElement).click());
  await tick();
  const video = target.querySelector('video')!;
  expect(video.controls).toBe(true);
  expect(video.getAttribute('playsinline')).not.toBeNull();
  await vi.waitFor(() => expect(video.src).toBe('https://video.bsky.app/playlist.m3u8'));
  expect(play).toHaveBeenCalled();
  flushSync(() => video.dispatchEvent(new Event('error')));
  expect(target.textContent).toContain('Video could not be played');
  expect(target.querySelector('a')?.href).toBe('https://bsky.app/profile/a/post/b');
  unmount(component);
});
