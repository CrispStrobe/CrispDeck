import type { ComposeOptions } from '$lib/compose/adapter';
import { read, write, remove } from './storage';

export type StoredOptions = Omit<ComposeOptions, 'text' | 'mediaFiles' | 'onVideoProgress'>;
export interface ComposerSnapshot {
  id: string;
  text: string;
  accountIds: number[];
  overrides: Record<string, string>;
  options: StoredOptions;
  media: Array<{ blob: Blob; name: string; lastModified: number }>;
  savedAt: string;
  jobId?: string;
  context?: { quoteAuthor: string; quoteText: string; replyAuthor: string };
}

export function snapshot(id: string, text: string, accountIds: number[], overrides: Record<string, string>, options: Omit<ComposeOptions, 'text'>, jobId?: string): ComposerSnapshot {
  const { mediaFiles = [], onVideoProgress: _progress, ...stored } = options;
  return {
    id, text, accountIds: [...accountIds], overrides: { ...overrides }, options: JSON.parse(JSON.stringify(stored)),
    media: mediaFiles.map(file => ({ blob: file, name: file.name, lastModified: file.lastModified })),
    savedAt: new Date().toISOString(), jobId,
  };
}

export function restoreFiles(saved: ComposerSnapshot): File[] {
  return saved.media.map(({ blob, name, lastModified }) => new File([blob], name, { type: blob.type, lastModified }));
}
export const saveSnapshot = (value: ComposerSnapshot) => write('snapshots', value);
export const loadSnapshot = (id: string) => read<ComposerSnapshot>('snapshots', id);
export const deleteSnapshot = (id: string) => remove('snapshots', id);
