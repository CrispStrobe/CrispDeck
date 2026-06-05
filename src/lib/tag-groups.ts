/**
 * Tag groups: named sets of hashtags that combine into a single feed.
 * Stored in localStorage. Can be used as deck column source.
 */

export interface TagGroup {
  id: string;
  name: string;
  tags: string[]; // without # prefix
}

const STORAGE_KEY = 'crispdeck-tag-groups';

export function listTagGroups(): TagGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTagGroup(group: Omit<TagGroup, 'id'>): TagGroup {
  const groups = listTagGroups();
  const newGroup: TagGroup = { ...group, id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  groups.push(newGroup);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  return newGroup;
}

export function updateTagGroup(id: string, updates: Partial<Omit<TagGroup, 'id'>>): void {
  const groups = listTagGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx >= 0) {
    groups[idx] = { ...groups[idx], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }
}

export function deleteTagGroup(id: string): void {
  const groups = listTagGroups().filter(g => g.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}
