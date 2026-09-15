/**
 * Sample data for App Store screenshots.
 *
 * Every handle here is fictional and every domain is a reserved example/test
 * domain, so a screenshot cannot be mistaken for a real person's account or
 * imply an endorsement. The shapes are the real ones — Bluesky's
 * `app.bsky.feed.defs#feedViewPost` and Mastodon's `Status` — because the
 * screenshots render through the app's own normalisation code, not a mock UI.
 */

import { createHash } from 'node:crypto';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * A real CIDv1 (dag-cbor, sha2-256, base32) derived from `seed`.
 *
 * The AT Protocol client validates every response against the lexicon before
 * the app sees it, and `cid` carries `format: "cid"` — a placeholder string
 * fails there, so the whole timeline comes back as "the server gave an invalid
 * response" and the screenshot shows an error banner instead of posts.
 */
function cid(seed) {
  const digest = createHash('sha256').update(seed).digest();
  return `b${base32([0x01, 0x71, 0x12, 0x20, ...digest])}`;
}

/** `did:plc:` identifiers are 24 base32 characters; the same rule applies. */
function plc(seed) {
  return `did:plc:${base32(createHash('sha256').update(seed).digest()).slice(0, 24)}`;
}

const DID = plc('crispdeck-screenshot-owner');
const HANDLE = 'you.crispdeck.test';

export const SEED = {
  cryptoKey: 'crispdeck-screenshot-seed-do-not-reuse',
  // 32 zero bytes, base64 — the salt only has to be stable, not secret, for a
  // throwaway profile that holds fixture credentials.
  cryptoSalt: btoa(String.fromCharCode(...new Uint8Array(32))),
};

export const ACCOUNTS = [
  {
    id: 1,
    platform: 'bluesky',
    handle: HANDLE,
    display_name: 'Sam Okonkwo',
    avatar_url: 'https://cdn.bsky.app/avatar/you.png',
    did: DID,
    mastodon_id: null,
    threads_user_id: null,
    instance_url: null,
    is_primary: true,
    credentials: { auth_method: 'app_password', app_password: 'demo-demo-demo-demo', did: DID },
  },
  {
    id: 2,
    platform: 'mastodon',
    handle: 'sam@social.example',
    display_name: 'Sam Okonkwo',
    avatar_url: 'https://social.example/avatars/sam.png',
    did: null,
    mastodon_id: '109000000000000001',
    threads_user_id: null,
    instance_url: 'https://social.example',
    is_primary: false,
    credentials: { access_token: 'demo-token', instance_url: 'https://social.example' },
  },
];

const AUTHORS = [
  { h: 'ada.crispdeck.test', n: 'Ada Bergström', c: '#4f7cff' },
  { h: 'mira.crispdeck.test', n: 'Mira Lindqvist', c: '#e8663d' },
  { h: 'tomas.crispdeck.test', n: 'Tomás Areia', c: '#2fa36b' },
  { h: 'kenji.crispdeck.test', n: 'Kenji Watanabe', c: '#a05ad6' },
  { h: 'noor.crispdeck.test', n: 'Noor Haddad', c: '#d4a017' },
];

const BSKY_TEXT = [
  'Finally moved my whole reading setup into one window — timeline, mentions and two hashtag columns side by side. No more tab roulette.',
  'The keyword column is doing the thing I actually wanted: it watches the firehose for "typesetting" and nothing else gets through.',
  'Wrote a long thread this morning and it split itself across both networks at the right lengths. I did not have to count a single character.',
  'Custom feed builder question — does anyone have a good recipe for filtering to just posts with alt text?',
  'Three years of posts, searchable offline, on my own machine. That is the feature I did not know I wanted.',
];

const MASTO_TEXT = [
  '<p>Boosting this into the fediverse because it deserves a wider audience: small clients doing careful work.</p>',
  '<p>The translation dropdown now tries my own instance first. Faster, and nothing leaves the server I already trust.</p>',
  '<p>Reminder that alt text is not optional. Nice to see a composer that can simply refuse to post without it.</p>',
  '<p>Local timeline is quiet today. Good day for reading the archive instead.</p>',
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * Timestamps for the "your own posts" fixtures, spread over five weeks and
 * across the working day. The timeline fixtures are all minutes old, which is
 * right for a feed and useless for the analytics page: every post landing in
 * the same hour draws an empty activity chart.
 */
const archiveMinutes = (i) => 190 + i * 1147 + (i % 7) * 83;

function bskyPost(i, age = null) {
  const a = AUTHORS[i % AUTHORS.length];
  const author = plc(`author-${i}`);
  const uri = `at://${author}/app.bsky.feed.post/${1000 + i}`;
  return {
    post: {
      uri,
      cid: cid(`post-${i}`),
      author: {
        did: author,
        handle: a.h,
        displayName: a.n,
        avatar: `https://cdn.bsky.app/avatar/${a.h}.png`,
        viewer: { muted: false, blockedBy: false },
        labels: [],
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: BSKY_TEXT[i % BSKY_TEXT.length],
        createdAt: minutesAgo(age ?? 7 + i * 23),
        langs: ['en'],
      },
      replyCount: (i * 3) % 7,
      repostCount: (i * 5) % 19,
      likeCount: 12 + ((i * 17) % 90),
      quoteCount: i % 3,
      indexedAt: minutesAgo(age ?? 7 + i * 23),
      viewer: { like: i === 1 ? `at://${DID}/app.bsky.feed.like/1` : undefined },
      labels: [],
    },
  };
}

function mastoPost(i, age = null) {
  const a = AUTHORS[(i + 2) % AUTHORS.length];
  const acct = a.h.split('.')[0];
  return {
    id: `11000000000000${i}`,
    uri: `https://social.example/users/${acct}/statuses/${i}`,
    url: `https://social.example/@${acct}/${i}`,
    createdAt: minutesAgo(age ?? 12 + i * 31),
    content: MASTO_TEXT[i % MASTO_TEXT.length],
    visibility: 'public',
    sensitive: false,
    spoilerText: '',
    repliesCount: (i * 2) % 5,
    reblogsCount: (i * 4) % 13,
    favouritesCount: 8 + ((i * 11) % 60),
    favourited: i === 0,
    reblogged: false,
    bookmarked: false,
    mediaAttachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    account: {
      id: `2000000000000${i}`,
      username: acct,
      acct: `${acct}@social.example`,
      displayName: a.n,
      url: `https://social.example/@${acct}`,
      avatar: `https://social.example/avatars/${acct}.png`,
      avatarStatic: `https://social.example/avatars/${acct}.png`,
      header: '', headerStatic: '',
      followersCount: 400 + i * 37, followingCount: 210 + i * 11, statusesCount: 1800 + i * 90,
      note: '<p>Typesetter. Slow reader.</p>', emojis: [], fields: [], bot: false, locked: false,
      createdAt: '2023-02-11T10:00:00.000Z',
    },
  };
}

export const BSKY_FEED = Array.from({ length: 12 }, (_, i) => bskyPost(i));
export const MASTO_TIMELINE = Array.from({ length: 10 }, (_, i) => mastoPost(i));

/** The signed-in account's own history, behind the author-feed endpoints. */
export const BSKY_ARCHIVE = Array.from({ length: 24 }, (_, i) => bskyPost(100 + i, archiveMinutes(i)));
export const MASTO_ARCHIVE = Array.from({ length: 18 }, (_, i) => mastoPost(100 + i, archiveMinutes(i) + 400));

export const BSKY_PROFILE = {
  did: DID, handle: HANDLE, displayName: 'Sam Okonkwo',
  avatar: 'https://cdn.bsky.app/avatar/you.png',
  banner: 'https://cdn.bsky.app/banner/you.png',
  description: 'Reading three networks in one window.',
  followersCount: 1284, followsCount: 431, postsCount: 2907,
  indexedAt: '2024-05-02T09:00:00.000Z', labels: [], viewer: { muted: false, blockedBy: false },
};

export const BSKY_NOTIFICATIONS = AUTHORS.slice(0, 6).map((a, i) => ({
  uri: `at://${plc(`author-${i}`)}/app.bsky.feed.like/${i}`,
  cid: cid(`notif-${i}`),
  author: {
    did: plc(`author-${i}`), handle: a.h, displayName: a.n,
    avatar: `https://cdn.bsky.app/avatar/${a.h}.png`, labels: [], viewer: {},
  },
  reason: ['like', 'repost', 'follow', 'reply', 'mention', 'quote'][i % 6],
  reasonSubject: `at://${DID}/app.bsky.feed.post/${1000 + i}`,
  record: { $type: 'app.bsky.feed.like', createdAt: minutesAgo(4 + i * 18) },
  isRead: i > 2,
  indexedAt: minutesAgo(4 + i * 18),
  labels: [],
}));

/** Colour-coded initials avatar, so nothing in a screenshot needs the network. */
export function avatarSvg(key) {
  const author = AUTHORS.find((a) => key.includes(a.h.split('.')[0]) || key.includes(a.h));
  const colour = author?.c ?? '#4f7cff';
  const initials = (author?.n ?? 'Sam Okonkwo').split(' ').map((w) => w[0]).join('').slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <rect width="96" height="96" rx="48" fill="${colour}"/>
  <text x="48" y="61" font-family="system-ui,-apple-system,sans-serif" font-size="38"
        font-weight="600" fill="#fff" text-anchor="middle">${initials}</text>
</svg>`;
}
