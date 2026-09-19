/**
 * Bluesky server preferences sync — muted words.
 * Fetches muted words from app.bsky.actor.defs#mutedWordsPref
 * and merges with local muted words store.
 */

import type { Agent } from '@atproto/api';
import { listMutedWords, saveMutedWords, createMutedWord, type MutedWord } from './muted-words';
import { swallow } from './debug-log';

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
    // A background merge on connect. Nothing the user started, so no toast;
    // it still needs to be readable in Settings when words fail to appear.
    swallow('bluesky-prefs.syncMutedWordsFromServer', e);
  }
}

/**
 * Push a muted word to the Bluesky server preferences.
 *
 * Goes through the SDK's addMutedWord rather than putPreferences, for the
 * reason already documented on pinFeed in bluesky-feeds.ts: the preferences
 * document is a single array covering saved feeds, labelers, adult content
 * settings and every other muted word, and putPreferences writes that array
 * wholesale. This function used to call it with an array holding one
 * mutedWordsPref, so muting a single word discarded the account's saved feeds,
 * labeler subscriptions and every word muted before it. addMutedWord reads,
 * merges and writes back.
 *
 * Throws on failure — the caller saves the word locally and needs to know that
 * the server copy did not happen, or the user is told a word is muted
 * everywhere when it is muted only on this device.
 */
export async function pushMutedWordToServer(agent: Agent, value: string): Promise<void> {
  await (agent as any).addMutedWord({
    value,
    targets: ['content', 'tag'],
    actorTarget: 'all',
  });
}
