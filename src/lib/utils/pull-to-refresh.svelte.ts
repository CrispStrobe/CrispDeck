/**
 * Reusable pull-to-refresh gesture handler.
 * Returns state and touch event handlers for any scrollable view.
 */
import { haptic } from '$lib/haptics';

export interface PullToRefreshState {
  pullDistance: number;
  isPulling: boolean;
  pullRefreshing: boolean;
}

export function createPullToRefresh(onRefresh: () => Promise<void>) {
  let pullStartY = 0;
  let state = $state<PullToRefreshState>({
    pullDistance: 0,
    isPulling: false,
    pullRefreshing: false,
  });
  let triggered = false;

  function onTouchStart(e: TouchEvent) {
    // Only activate at the top of scroll
    const el = e.currentTarget as HTMLElement;
    const scrollTop = el.scrollTop ?? window.scrollY;
    if (scrollTop === 0) {
      pullStartY = e.touches[0].clientY;
      state.isPulling = true;
      triggered = false;
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (!state.isPulling) return;
    const y = e.touches[0].clientY;
    state.pullDistance = Math.max(0, Math.min(120, (y - pullStartY) * 0.5));
    if (!triggered && state.pullDistance >= 60) {
      haptic('light');
      triggered = true;
    }
  }

  async function onTouchEnd() {
    if (!state.isPulling) return;
    state.isPulling = false;
    if (state.pullDistance >= 60) {
      state.pullRefreshing = true;
      state.pullDistance = 50;
      await onRefresh();
      state.pullRefreshing = false;
    }
    state.pullDistance = 0;
  }

  return {
    get state() { return state; },
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
