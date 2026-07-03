/**
 * Bluesky server preferences sync — muted words.
 * Fetches muted words from app.bsky.actor.defs#mutedWordsPref
 * and merges with local muted words store.
 */

import type { Agent } from '@atproto/api';
import { listMutedWords, saveMutedWords, createMutedWord, type MutedWord } from './muted-words';

export interface BskyMutedWord {
  value: string;
  targets: string[]; // ['content', 'tag']
  actorTarget?: string;
  expiresAt?: string;
}

/**
 * Fetch server muted words and merge into local store.
 * Server words get tagged with source='bluesky' so they can be identified.
 */
export async function syncMutedWordsFromServer(agent: Agent): Promise<void> {
  try {
    const prefs = await agent.getPreferences();
    const serverWords: BskyMutedWord[] = (prefs as any)?.mutedWords ?? [];
    if (serverWords.length === 0) return;

    const local = listMutedWords();
    const localValues = new Set(local.map(w => w.value.toLowerCase()));

    let added = false;
    for (const sw of serverWords) {
      // Skip expired
      if (sw.expiresAt && new Date(sw.expiresAt) < new Date()) continue;
      if (!localValues.has(sw.value.toLowerCase())) {
        const word = createMutedWord(sw.value, false);
        (word as any).source = 'bluesky';
        local.push(word);
        added = true;
      }
    }

    if (added) saveMutedWords(local);
  } catch (e) {
    console.error('Failed to sync muted words from Bluesky:', e);
  }
}

/**
 * Push a muted word to the Bluesky server preferences.
 */
export async function pushMutedWordToServer(agent: Agent, value: string): Promise<void> {
  try {
    await agent.api.app.bsky.actor.putPreferences({
      preferences: [{
        $type: 'app.bsky.actor.defs#mutedWordsPref',
        items: [{ value, targets: ['content', 'tag'] }],
      }],
    });
  } catch (e) {
    console.error('Failed to push muted word to Bluesky:', e);
  }
}
