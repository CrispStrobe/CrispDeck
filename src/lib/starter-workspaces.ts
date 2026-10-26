import type { DeckColumnConfig } from './deck-layouts';
import { saveLayout, setActiveLayoutName } from './deck-layouts';
import { writeJson } from './safe-storage';

export type WorkspaceId = 'dailyReading' | 'communityMonitoring' | 'publishingDesk';
export const STARTER_WORKSPACES: WorkspaceId[] = ['dailyReading', 'communityMonitoring', 'publishingDesk'];

export function workspaceColumns(id: WorkspaceId, labels: { feed: string; notifications: string; search: string; trending: string; messages: string; mentions: string; myPosts: string }): DeckColumnConfig[] {
  const columns: Record<WorkspaceId, Array<Omit<DeckColumnConfig, 'id'>>> = {
    dailyReading: [
      { title: labels.feed, type: 'timeline', color: '#3b82f6' },
      { title: labels.notifications, type: 'notifications', color: '#a78bfa' },
      { title: labels.trending, type: 'trending', color: '#34d399' },
    ],
    communityMonitoring: [
      { title: labels.mentions, type: 'mentions', color: '#a78bfa' },
      { title: '#community', type: 'hashtag', query: 'community', color: '#34d399' },
      { title: labels.search, type: 'search', query: 'community', color: '#3b82f6' },
    ],
    publishingDesk: [
      { title: labels.myPosts, type: 'my-posts', color: '#3b82f6' },
      { title: labels.mentions, type: 'mentions', color: '#a78bfa' },
      { title: labels.notifications, type: 'notifications', color: '#fbbf24' },
    ],
  };
  return columns[id].map((column, index) => ({ ...column, id: `${id}-${index}-${crypto.randomUUID()}`, width: 350 }));
}

export function applyWorkspace(id: WorkspaceId, name: string, columns: DeckColumnConfig[]) {
  if (!writeJson('crispdeck-deck-columns', columns)) throw new Error('Could not save the workspace on this device.');
  // Starter layouts have stable keys so selecting another never overwrites a user's named layout.
  saveLayout(`starter:${id}`, columns);
  setActiveLayoutName(`starter:${id}`);
}
