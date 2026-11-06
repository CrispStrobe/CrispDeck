import type { Platform } from '$lib/types';
import { isVideoFile, validateMediaFile } from './media';

// Bluesky's gallery lexicon asks authoring clients to enforce 10 (the schema
// ceiling of 20 is reserved for future use). The older images embed stays at 4.
// https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/embed/gallery.json
export const MEDIA_LIMITS: Readonly<Record<Platform, number>> = {
  bluesky: 10,
  mastodon: 4,
  threads: 10,
};
export const BLUESKY_IMAGE_MAX_BYTES = 2_000_000;

/** Respect every selected destination; switching accounts never removes files. */
export function mediaAttachmentLimit(platforms: readonly Platform[]): number {
  return platforms.length ? Math.min(...platforms.map(platform => MEDIA_LIMITS[platform])) : 10;
}

export function parseMediaUrls(value: string): string[] {
  return value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
}

/** Preflight must reject an invalid selection, never silently drop its tail. */
export function validateMediaForPlatform(platform: Platform, files: readonly File[] = [], mediaUrls: readonly string[] = []): string | null {
  if (platform === 'threads') {
    if (mediaUrls.length > MEDIA_LIMITS.threads) return `Threads posts in CrispDeck support up to ${MEDIA_LIMITS.threads} public media URLs.`;
    if (mediaUrls.some(url => { try { return new URL(url).protocol !== 'https:'; } catch { return true; } })) return 'Threads media URLs must use HTTPS.';
    if (files.length && files.length !== mediaUrls.length) return 'Add one public HTTPS media URL for every Threads attachment, in the same order.';
    return null;
  }
  const label = platform === 'bluesky' ? 'Bluesky' : 'Mastodon';
  if (files.length > MEDIA_LIMITS[platform]) return `${label} supports up to ${MEDIA_LIMITS[platform]} attachments in a post.`;
  for (const file of files) {
    const error = validateMediaFile(file);
    if (error) return `${file.name}: ${error}`;
  }
  if (platform === 'bluesky') {
    if (files.some(isVideoFile) && files.length !== 1) return 'Choose a single video or up to 10 images for Bluesky.';
    const oversized = files.find(file => !isVideoFile(file) && file.size > BLUESKY_IMAGE_MAX_BYTES);
    if (oversized) return `${oversized.name}: Bluesky images must be at most 2 MB. Resize the image before publishing.`;
  }
  return null;
}
