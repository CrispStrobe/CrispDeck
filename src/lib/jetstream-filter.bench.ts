/**
 * A/B: cost of processing firehose traffic, old path vs new.
 *
 *   npx vitest bench src/lib/jetstream-filter.bench.ts
 *
 * Jetstream can filter by collection but not by subject, so we receive every
 * like and repost on the network. With a feed of ~200 posts on screen, the
 * share of messages that concern one of them is tiny — the benchmark models
 * that hit rate rather than assuming it.
 */
import { bench, describe } from 'vitest';
import { matchRawEvent, decodeEvent, type CountUpdate } from './jetstream-filter';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(5);
const rkey = () => Math.random().toString(36).slice(2, 15);
const did = (i: number) => `did:plc:${String(i).padStart(16, 'k')}`;

// 200 posts on screen, the size of a scrolled feed.
const watched = new Set<string>();
for (let i = 0; i < 200; i++) watched.add(`at://${did(i)}/app.bsky.feed.post/${i}abcdefg`);
const isWatched = (uri: string) => watched.has(uri);

/** A realistic Jetstream commit — roughly the shape and size of the real thing. */
function message(subjectUri: string, collection: string) {
  return JSON.stringify({
    did: did(Math.floor(rng() * 100000)),
    time_us: 1789000000000000 + Math.floor(rng() * 1e9),
    kind: 'commit',
    commit: {
      rev: rkey(), operation: 'create', collection, rkey: rkey(),
      record: {
        $type: collection,
        createdAt: new Date().toISOString(),
        subject: { cid: `bafyrei${rkey()}${rkey()}`, uri: subjectUri },
      },
      cid: `bafyrei${rkey()}${rkey()}`,
    },
  });
}

/**
 * 10,000 messages at a 0.5% hit rate — generous; on the real firehose a
 * 200-post feed sees far less than that.
 */
const HIT_RATE = 0.005;
const stream: string[] = [];
const watchedList = [...watched];
for (let i = 0; i < 10_000; i++) {
  const collection = rng() < 0.75 ? 'app.bsky.feed.like' : 'app.bsky.feed.repost';
  const subject = rng() < HIT_RATE
    ? watchedList[Math.floor(rng() * watchedList.length)]
    : `at://${did(Math.floor(rng() * 1e6))}/app.bsky.feed.post/${rkey()}`;
  stream.push(message(subject, collection));
}

/** The previous implementation: JSON.parse every message, then check. */
function oldPath(raw: string): CountUpdate | null {
  let data: any;
  try { data = JSON.parse(raw); } catch { return null; }
  return decodeEvent(data, isWatched);
}

describe('10,000 firehose messages, 200 posts on screen', () => {
  bench('pre-filter then parse (current)', () => {
    for (const raw of stream) matchRawEvent(raw, isWatched);
  });

  bench('parse every message (original)', () => {
    for (const raw of stream) oldPath(raw);
  });
});
