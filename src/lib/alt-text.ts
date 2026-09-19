/**
 * Alt text on post media.
 *
 * The ALT badge is the user-visible promise that a description exists, so the
 * test for "does this image have alt text" has to be the same one the badge
 * uses. It previously wasn't: the template tested the string for truthiness,
 * which is true of "   ", so a whitespace-only description produced a badge
 * that opened an empty popover.
 */
import { getBskyImages, getMastodonMedia } from '$lib/components/post-embeds';

/** Whether a description is real enough to advertise. */
export function hasAltText(altText: string | undefined | null): boolean {
  return typeof altText === 'string' && altText.trim().length > 0;
}

/** Alt text of each Bluesky image, in order; missing alt becomes ''. */
export function getBskyImageAltTexts(embeds: unknown): string[] {
  return getBskyImages(embeds).map((img: any) => img.alt ?? '');
}

/** Description of each Mastodon attachment, in order; missing becomes ''. */
export function getMastodonMediaAltTexts(raw: unknown): string[] {
  return getMastodonMedia(undefined, raw).map((m: any) => m.description ?? '');
}

/** How many of the post's images are missing a description. */
export function countMissingAltText(altTexts: string[]): number {
  return altTexts.filter((t) => !hasAltText(t)).length;
}
