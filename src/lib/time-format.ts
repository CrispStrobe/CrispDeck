/**
 * Formatting timestamps for display.
 *
 * Post.svelte and the archive page each had their own formatDate. They agreed
 * on the format and disagreed on robustness: Post guarded a missing or
 * unparseable value and returned an em dash, the archive page passed it
 * straight to Date and rendered the string "Invalid Date". The drafts page has
 * a third, deliberately different one — date *and* time — which stays where it
 * is.
 */

/** "Mar 14, 2026", or an em dash when there is nothing to show. */
export function formatDate(dateString?: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Compact age: "now", "5m", "3h", "2d", then an absolute date.
 *
 * Empty string rather than an em dash for a missing value — this sits inline in
 * a post header, where a placeholder would be noise.
 */
export function relativeTime(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
