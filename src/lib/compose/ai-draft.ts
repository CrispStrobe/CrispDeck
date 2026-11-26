import { runAIAction, type AIAction, type AIResult } from './ai';

export interface AIDraft {
  generation: number;
  text: string;
  mediaFiles: File[];
  altTexts: string[];
}

type DraftAIResult = { status: 'ready'; result: AIResult; mediaIndex: number }
  | { status: 'stale' | 'no-image' | 'no-input' };

function imageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** A completed request belongs to the exact draft generation in which it began. */
export async function runDraftAIAction(action: AIAction, currentDraft: () => AIDraft): Promise<DraftAIResult> {
  const original = currentDraft();
  const generation = original.generation;
  const text = original.text;
  if (action !== 'alt-text' && !text.trim()) return { status: 'no-input' };
  const mediaIndex = action === 'alt-text'
    ? original.mediaFiles.findIndex((file, index) => file.type.startsWith('image/') && !original.altTexts[index]?.trim()) : -1;
  const file = original.mediaFiles[mediaIndex];
  const alt = original.altTexts[mediaIndex] ?? '';
  if (action === 'alt-text' && !file) return { status: 'no-image' };
  const isCurrent = () => {
    const current = currentDraft();
    return current.generation === generation && (action === 'alt-text'
      ? current.mediaFiles[mediaIndex] === file && (current.altTexts[mediaIndex] ?? '') === alt
      : current.text === text);
  };
  const image = action === 'alt-text' ? await imageDataUrl(file) : undefined;
  if (!isCurrent()) return { status: 'stale' };
  const result = await runAIAction(action, action === 'alt-text'
    ? 'Please describe the attached image for accessibility purposes.' : text, undefined, image);
  return isCurrent() ? { status: 'ready', result, mediaIndex } : { status: 'stale' };
}
