/**
 * Labelled pairs for judging crosspost detection.
 *
 * Every `same: true` entry is a shape that really happens when one person
 * posts to two networks; every `same: false` entry is a pair a reader would be
 * annoyed to see merged. Kept as data so a change to the algorithm is scored
 * rather than argued about.
 */
export interface LabelledPair {
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly same: boolean;
}

export const CROSSPOST_PAIRS: readonly LabelledPair[] = [
  // ── Should match ───────────────────────────────────────────────────────
  {
    label: 'identical text',
    same: true,
    a: 'Shipped the feed picker today. It reads your pinned feeds straight from your account preferences, so whatever you pinned in the official app shows up here.',
    b: 'Shipped the feed picker today. It reads your pinned feeds straight from your account preferences, so whatever you pinned in the official app shows up here.',
  },
  {
    label: 'truncated for the shorter limit',
    same: true,
    a: 'Shipped the feed picker today. It reads your pinned feeds straight from your account preferences, so whatever you pinned in the official app shows up here. There is also a search now, and you can pin from inside the picker.',
    b: 'Shipped the feed picker today. It reads your pinned feeds straight from your account preferences, so whatever you pinned in the official…',
  },
  {
    label: 'trailing link added on one network',
    same: true,
    a: 'Finally tracked down the layout jank: we were rendering every cached post at once, which is 36,000 DOM nodes and a seven second freeze.',
    b: 'Finally tracked down the layout jank: we were rendering every cached post at once, which is 36,000 DOM nodes and a seven second freeze. https://example.com/write-up',
  },
  {
    label: 'hashtags written differently',
    same: true,
    a: 'New release is out. Dark mode finally respects the system setting. #webdev #svelte',
    b: 'New release is out. Dark mode finally respects the system setting. webdev, svelte',
  },
  {
    label: 'mention rewritten for the other network',
    same: true,
    a: 'Huge thanks to @alice.bsky.social for the patch that fixed the scroll restore.',
    b: 'Huge thanks to @alice@mastodon.social for the patch that fixed the scroll restore.',
  },
  {
    label: 'punctuation and casing differ',
    same: true,
    a: 'The compiler finally handles nested generics — took three attempts!',
    b: 'The compiler finally handles nested generics, took three attempts.',
  },
  {
    label: 'emoji added on one side',
    same: true,
    a: 'Release day. Everything that was broken in the picker is fixed, and the tests now cover the parts that broke.',
    b: '🚀 Release day. Everything that was broken in the picker is fixed, and the tests now cover the parts that broke. 🎉',
  },

  // ── Should not match ───────────────────────────────────────────────────
  {
    label: 'same author, same day, different subject',
    same: false,
    a: 'The compiler finally handles nested generics — post about the type checker rewrite and what it cost us.',
    b: 'Our cache now batches partial writes, which took three attempts and a lot of reading about fsync.',
  },
  {
    label: 'same topic, independently written',
    same: false,
    a: 'Spent the morning reading about how feed generators actually work on atproto. The skeleton endpoint is simpler than I expected.',
    b: 'Feed generators on atproto turn out to be quite approachable once you realise the server only returns URIs.',
  },
  {
    label: 'both short and generic',
    same: false,
    a: 'Good morning everyone, hope the week is treating you kindly so far.',
    b: 'Good evening all, hope the weekend treats you better than the week did.',
  },
  {
    label: 'shared boilerplate sign-off only',
    same: false,
    a: 'The scheduler stopped trusting stale sessions. Comments welcome, the benchmark is in the repo.',
    b: 'A migration quietly broke unicode widths. Comments welcome, the benchmark is in the repo.',
  },
  {
    label: 'reply versus original',
    same: false,
    a: 'Why does every date library reinvent parsing? Genuinely asking, there must be a reason.',
    b: 'Because the formats are underspecified and everyone needs a slightly different subset.',
  },
  {
    label: 'one is a quote of the other',
    same: false,
    a: 'This is the clearest explanation of DPoP I have read, and it finally made the nonce dance make sense.',
    b: 'Worth reading if you have ever wondered why the first pushed authorization request always fails.',
  },
  {
    label: 'same opening, different post',
    same: false,
    a: 'Release notes: the feed picker now reads pinned feeds, and the deck can add a column without pasting a URI.',
    b: 'Release notes: translations are complete in seven languages, and the privacy policy is translated too.',
  },
];
