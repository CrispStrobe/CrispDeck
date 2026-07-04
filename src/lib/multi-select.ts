/**
 * Multi-select state for bulk post actions.
 *
 * Tracks selected post URIs and provides bulk action helpers.
 * Used by feed and deck pages to select multiple posts for
 * batch like, bookmark, or add-to-reading-list operations.
 */

import type { UnifiedPost } from '$lib/types';

/** Multi-select state container. */
export interface MultiSelectState {
  enabled: boolean;
  selected: Set<string>; // post URIs
}

export function createMultiSelect(): MultiSelectState {
  return { enabled: false, selected: new Set() };
}

export function toggleMultiSelect(state: MultiSelectState): MultiSelectState {
  return {
    enabled: !state.enabled,
    selected: state.enabled ? new Set() : state.selected, // clear on disable
  };
}

export function togglePost(state: MultiSelectState, uri: string): MultiSelectState {
  const next = new Set(state.selected);
  if (next.has(uri)) next.delete(uri);
  else next.add(uri);
  return { ...state, selected: next };
}

export function selectAll(state: MultiSelectState, uris: string[]): MultiSelectState {
  return { ...state, selected: new Set(uris) };
}

export function deselectAll(state: MultiSelectState): MultiSelectState {
  return { ...state, selected: new Set() };
}

/** Range select: select all posts between two indices (inclusive). */
export function selectRange(state: MultiSelectState, allUris: string[], fromIdx: number, toIdx: number): MultiSelectState {
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const next = new Set(state.selected);
  for (let i = start; i <= end; i++) {
    if (allUris[i]) next.add(allUris[i]);
  }
  return { ...state, selected: next };
}

export function isSelected(state: MultiSelectState, uri: string): boolean {
  return state.selected.has(uri);
}

export function selectedCount(state: MultiSelectState): number {
  return state.selected.size;
}

/** Get selected posts from a full post list. */
export function getSelectedPosts(state: MultiSelectState, posts: UnifiedPost[]): UnifiedPost[] {
  return posts.filter(p => state.selected.has(p.uri));
}
