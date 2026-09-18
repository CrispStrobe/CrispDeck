/**
 * Visibility-aware polling.
 *
 * The app keeps several background refreshes running — unread counts, new-post
 * checks, deck column reloads, scheduled drafts. A plain setInterval keeps
 * firing in a hidden tab, so a backgrounded CrispDeck went on making API calls
 * indefinitely: battery and rate limit spent on updates nobody is looking at.
 *
 * pollWhenVisible pauses while the document is hidden and resumes on return,
 * catching up immediately if at least one interval was missed, so coming back
 * to the tab still shows fresh data.
 */
export interface PollOptions {
  /** Run once immediately on becoming visible if an interval was missed. Default true. */
  catchUp?: boolean;
  /** Injectable for tests. Defaults to the global document. */
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  /** Injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

export function pollWhenVisible(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: PollOptions = {}
): () => void {
  const { catchUp = true, now = Date.now } = options;
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastRun = now();
  let stopped = false;

  const run = () => {
    lastRun = now();
    void fn();
  };

  const start = () => {
    if (timer !== null || stopped) return;
    timer = setInterval(run, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  // No document (SSR, tests, some Tauri contexts): behave like a plain interval.
  if (!doc) {
    start();
    return () => { stopped = true; stop(); };
  }

  const onVisibilityChange = () => {
    if (stopped) return;
    if (doc.hidden) {
      stop();
    } else {
      if (catchUp && now() - lastRun >= intervalMs) run();
      start();
    }
  };

  doc.addEventListener('visibilitychange', onVisibilityChange);
  if (!doc.hidden) start();

  return () => {
    stopped = true;
    stop();
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
