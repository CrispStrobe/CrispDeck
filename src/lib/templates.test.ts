/**
 * Tests for post templates — localStorage CRUD.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { listTemplates, saveTemplate, deleteTemplate, type PostTemplate } from './templates';

describe('post templates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('listTemplates', () => {
    it('returns empty array when no templates exist', () => {
      expect(listTemplates()).toEqual([]);
    });

    it('returns saved templates', () => {
      saveTemplate({ name: 'Test', text: 'Hello world' });
      const templates = listTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Test');
      expect(templates[0].text).toBe('Hello world');
    });
  });

  describe('saveTemplate', () => {
    it('generates an id and createdAt', () => {
      const tpl = saveTemplate({ name: 'Greeting', text: 'Hi there!' });
      expect(tpl.id).toMatch(/^tpl-\d+$/);
      expect(tpl.createdAt).toBeTruthy();
      expect(new Date(tpl.createdAt).getTime()).not.toBeNaN();
    });

    it('prepends new templates (newest first)', () => {
      saveTemplate({ name: 'First', text: 'aaa' });
      saveTemplate({ name: 'Second', text: 'bbb' });
      const templates = listTemplates();
      expect(templates[0].name).toBe('Second');
      expect(templates[1].name).toBe('First');
    });

    it('preserves optional visibility and contentWarning', () => {
      const tpl = saveTemplate({
        name: 'CW Post',
        text: 'Sensitive content',
        visibility: 'unlisted',
        contentWarning: 'spoilers',
      });
      expect(tpl.visibility).toBe('unlisted');
      expect(tpl.contentWarning).toBe('spoilers');
    });

    it('persists to localStorage', () => {
      saveTemplate({ name: 'Persistent', text: 'data' });
      const raw = localStorage.getItem('crispdeck-templates');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Persistent');
    });

    it('handles empty text', () => {
      const tpl = saveTemplate({ name: 'Empty', text: '' });
      expect(tpl.text).toBe('');
    });

    it('handles special characters in text', () => {
      const text = 'Hello "world" <script>alert("xss")</script> & more\nnewline';
      const tpl = saveTemplate({ name: 'Special', text });
      const loaded = listTemplates();
      expect(loaded[0].text).toBe(text);
    });
  });

  describe('deleteTemplate', () => {
    it('removes a template by id', () => {
      const tpl = saveTemplate({ name: 'Delete me', text: 'gone' });
      expect(listTemplates()).toHaveLength(1);
      deleteTemplate(tpl.id);
      expect(listTemplates()).toHaveLength(0);
    });

    it('does nothing for non-existent id', () => {
      saveTemplate({ name: 'Keep', text: 'stay' });
      deleteTemplate('tpl-nonexistent');
      expect(listTemplates()).toHaveLength(1);
    });

    it('only removes the targeted template', () => {
      // Use direct localStorage manipulation to ensure unique IDs
      const templates = [
        { id: 'tpl-1', name: 'A', text: 'aaa', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'tpl-2', name: 'B', text: 'bbb', createdAt: '2024-01-01T00:01:00Z' },
        { id: 'tpl-3', name: 'C', text: 'ccc', createdAt: '2024-01-01T00:02:00Z' },
      ];
      localStorage.setItem('crispdeck-templates', JSON.stringify(templates));
      deleteTemplate('tpl-2');
      const remaining = listTemplates();
      expect(remaining).toHaveLength(2);
      const names = remaining.map(t => t.name);
      expect(names).toContain('A');
      expect(names).toContain('C');
      expect(names).not.toContain('B');
    });
  });

  describe('multiple operations', () => {
    it('handles create-delete-create cycle', () => {
      const t1 = saveTemplate({ name: 'First', text: 'a' });
      deleteTemplate(t1.id);
      expect(listTemplates()).toHaveLength(0);
      saveTemplate({ name: 'Second', text: 'b' });
      expect(listTemplates()).toHaveLength(1);
      expect(listTemplates()[0].name).toBe('Second');
    });

    it('handles many templates', () => {
      for (let i = 0; i < 50; i++) {
        saveTemplate({ name: `Template ${i}`, text: `Content ${i}` });
      }
      expect(listTemplates()).toHaveLength(50);
      expect(listTemplates()[0].name).toBe('Template 49'); // newest first
    });
  });
});
