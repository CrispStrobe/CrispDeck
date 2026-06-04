/**
 * Post templates — save reusable text templates for compose.
 * Stored in localStorage.
 */

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
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveTemplate(template: Omit<PostTemplate, 'id' | 'createdAt'>): PostTemplate {
  const templates = listTemplates();
  const newTemplate: PostTemplate = {
    ...template,
    id: `tpl-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  templates.unshift(newTemplate);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  return newTemplate;
}

export function deleteTemplate(id: string): void {
  const templates = listTemplates().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}
