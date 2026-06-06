import type { Platform } from '$lib/types';

const CHAR_LIMITS: Record<Platform, number> = {
  bluesky: 300,
  mastodon: 500,
  threads: 500,
};

/** Count graphemes (Bluesky uses grapheme length, Mastodon uses codepoint length) */
function charCount(text: string, platform: Platform): number {
  if (platform === 'bluesky') {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
      return [...segmenter.segment(text)].length;
    }
    return [...text].length;
  }
  return text.length;
}

export interface ThreadPart {
  text: string;
  index: number;       // 0-based
  total: number;       // total parts for this platform
  charCount: number;   // chars used
  charLimit: number;   // platform limit
}

export interface ThreadPlan {
  platform: Platform;
  parts: ThreadPart[];
  needsThread: boolean; // true if text exceeds single post limit
}

/**
 * Split text into thread parts for a given platform.
 *
 * Strategy:
 * 1. If text fits in one post → single part, no numbering.
 * 2. Otherwise, split on paragraph breaks (\n\n) first.
 * 3. If a paragraph is still too long, split on sentence boundaries (. ! ? followed by space).
 * 4. If a sentence is still too long, split on word boundaries.
 * 5. Add thread numbering (n/N) at the end of each part, accounting for the numbering itself.
 */
export function splitForPlatform(text: string, platform: Platform): ThreadPlan {
  const limit = CHAR_LIMITS[platform];
  const trimmed = text.trim();

  if (charCount(trimmed, platform) <= limit) {
    return {
      platform,
      parts: [{
        text: trimmed,
        index: 0,
        total: 1,
        charCount: charCount(trimmed, platform),
        charLimit: limit,
      }],
      needsThread: false,
    };
  }

  // Reserve space for thread numbering " (nn/nn)" — up to 8 chars
  const NUMBERING_RESERVE = 8;
  const effectiveLimit = limit - NUMBERING_RESERVE;

  // Split into chunks
  const chunks = splitTextIntoChunks(trimmed, effectiveLimit, platform);

  const parts: ThreadPart[] = chunks.map((chunk, i) => ({
    text: `${chunk} (${i + 1}/${chunks.length})`,
    index: i,
    total: chunks.length,
    charCount: charCount(`${chunk} (${i + 1}/${chunks.length})`, platform),
    charLimit: limit,
  }));

  return { platform, parts, needsThread: true };
}

function splitTextIntoChunks(text: string, maxLen: number, platform: Platform): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (charCount(candidate, platform) <= maxLen) {
      current = candidate;
    } else {
      // Current buffer is full — flush it
      if (current) {
        chunks.push(current.trim());
        current = '';
      }

      // If this paragraph alone fits, use it
      if (charCount(para, platform) <= maxLen) {
        current = para;
      } else {
        // Paragraph too long — split on sentences
        const sentenceChunks = splitOnSentences(para, maxLen, platform);
        for (let i = 0; i < sentenceChunks.length; i++) {
          if (i < sentenceChunks.length - 1) {
            chunks.push(sentenceChunks[i].trim());
          } else {
            current = sentenceChunks[i];
          }
        }
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function splitOnSentences(text: string, maxLen: number, platform: Platform): string[] {
  // Split on sentence endings followed by space
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (charCount(candidate, platform) <= maxLen) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }

      if (charCount(sentence, platform) <= maxLen) {
        current = sentence;
      } else {
        // Sentence too long — split on words
        const wordChunks = splitOnWords(sentence, maxLen, platform);
        for (let i = 0; i < wordChunks.length; i++) {
          if (i < wordChunks.length - 1) {
            chunks.push(wordChunks[i].trim());
          } else {
            current = wordChunks[i];
          }
        }
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function splitOnWords(text: string, maxLen: number, platform: Platform): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (charCount(candidate, platform) <= maxLen) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current.trim());
      }
      // If a single word is longer than maxLen, force-split it
      if (charCount(word, platform) > maxLen) {
        const chars = [...word];
        let piece = '';
        for (const ch of chars) {
          if (charCount(piece + ch, platform) > maxLen) {
            chunks.push(piece);
            piece = ch;
          } else {
            piece += ch;
          }
        }
        current = piece;
      } else {
        current = word;
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Generate a unified thread plan showing how text splits on each selected platform.
 * Uses the *strictest* platform's limits to determine the split, so the same
 * text chunks work on both. This avoids confusing mismatched thread lengths.
 */
export function planThread(
  text: string,
  platforms: Platform[],
): { perPlatform: ThreadPlan[]; unified: ThreadPart[] } {
  const perPlatform = platforms.map(p => splitForPlatform(text, p));

  // The "unified" view uses the platform that needs the most parts
  // so the thread works correctly on all selected platforms
  const maxParts = Math.max(...perPlatform.map(p => p.parts.length));
  const strictestPlatform = perPlatform.find(p => p.parts.length === maxParts) ?? perPlatform[0];

  return {
    perPlatform,
    unified: strictestPlatform?.parts ?? [],
  };
}
