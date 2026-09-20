/**
 * Post templates — save reusable text templates for compose.
 * Stored in localStorage.
 */

import { readJson, writeJson } from './safe-storage';

export interface PostTemplate {
  id: string;
  name: string;
  text: string;
  visibility?: string;
  contentWarning?: string;
  createdAt: string;
}

const STORAGE_KEY = 'crispdeck-templates';

export function listTemplates(): PostTemplate[] {
  return readJson<PostTemplate[]>(STORAGE_KEY, [], Array.isArray);
}

export function saveTemplate(template: Omit<PostTemplate, 'id' | 'createdAt'>): PostTemplate {
  const templates = listTemplates();
  const newTemplate: PostTemplate = {
    ...template,
    id: `tpl-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  templates.unshift(newTemplate);
  writeJson(STORAGE_KEY, templates);
  return newTemplate;
}

export function deleteTemplate(id: string): void {
  const templates = listTemplates().filter(t => t.id !== id);
  writeJson(STORAGE_KEY, templates);
}

/**
 * Interpolate template variables.
 * Supported: {date}, {time}, {day}, {month}, {year}, {handle}, {iso}
 */
export function interpolateTemplate(text: string, handle?: string): string {
  const now = new Date();
  const vars: Record<string, string> = {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    day: now.toLocaleDateString(undefined, { weekday: 'long' }),
    month: now.toLocaleDateString(undefined, { month: 'long' }),
    year: String(now.getFullYear()),
    handle: handle ?? 'user',
    iso: now.toISOString().split('T')[0],
  };

  return text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
