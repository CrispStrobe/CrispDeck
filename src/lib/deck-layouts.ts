/**
 * Saved deck layouts / workspaces.
 *
 * Users can name, save, switch between, and delete column layouts.
 * Each layout stores its full DeckColumnConfig[] array.
 * The active layout name is also persisted so it survives reloads.
 */

export interface DeckColumnConfig {
  id: string;
  title: string;
  type: string;
  platform?: string;
  query?: string;
  width?: number;
  streaming?: boolean;
}

export interface DeckLayout {
  name: string;
  columns: DeckColumnConfig[];
  createdAt: string;
}

const LAYOUTS_KEY = 'crispdeck-deck-layouts';
const ACTIVE_KEY = 'crispdeck-deck-active-layout';

export function listLayouts(): DeckLayout[] {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getLayout(name: string): DeckLayout | undefined {
  return listLayouts().find(l => l.name === name);
}

export function saveLayout(name: string, columns: DeckColumnConfig[]): DeckLayout {
  const layouts = listLayouts();
  const existing = layouts.findIndex(l => l.name === name);
  const layout: DeckLayout = {
    name,
    columns: structuredClone(columns),
    createdAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    layouts[existing] = layout;
  } else {
    layouts.push(layout);
  }

  localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  return layout;
}

export function deleteLayout(name: string): void {
  const layouts = listLayouts().filter(l => l.name !== name);
  localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  // Clear active if it was the deleted one
  if (getActiveLayoutName() === name) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function renameLayout(oldName: string, newName: string): void {
  const layouts = listLayouts();
  const layout = layouts.find(l => l.name === oldName);
  if (layout) {
    layout.name = newName;
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
    if (getActiveLayoutName() === oldName) {
      setActiveLayoutName(newName);
    }
  }
}

export function getActiveLayoutName(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveLayoutName(name: string): void {
  localStorage.setItem(ACTIVE_KEY, name);
}

export function duplicateLayout(name: string): DeckLayout | null {
  const source = getLayout(name);
  if (!source) return null;

  const layouts = listLayouts();
  let copyName = `${name} (copy)`;
  let i = 2;
  while (layouts.some(l => l.name === copyName)) {
    copyName = `${name} (copy ${i++})`;
  }

  return saveLayout(copyName, source.columns);
}
