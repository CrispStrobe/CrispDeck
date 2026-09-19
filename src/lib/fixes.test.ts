/**
 * Poll voting and error feedback.
 *
 * This file previously built a headers object, asserted it contained an
 * Authorization key, and called that a test of the poll-voting fix. The toast
 * cases did the same with object literals, and the accessibility cases asserted
 * attributes on objects the test constructed — including role="article", which
 * does not appear anywhere in the app, so nothing was checking markup at all.
 *
 * What remains here is what can actually be exercised: the poll vote, now a
 * method on MastodonClient rather than an inline fetch in Post.svelte, and the
 * real toast store. The accessibility cases are gone rather than rewritten —
 * they asserted markup that is not there, and adding ARIA roles on the strength
 * of a test that never checked the component would be guessing.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MastodonClient } from './api/mastodon';
import { toast, getToasts, dismissToast } from './toast.svelte';

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    statusText: ok ? 'OK' : 'Error',
  })) as any;
}

describe('poll voting', () => {
  const authed = () => {
    const client = new MastodonClient('https://mastodon.social');
    (client as any).accessToken = 'token-123';
    return client;
  };

  it('sends the vote with an Authorization header', async () => {
    const fetchMock = respond({ id: 'p1', voted: true });
    vi.stubGlobal('fetch', fetchMock);

    await authed().votePoll('p1', [2]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mastodon.social/api/v1/polls/p1/votes');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer token-123');
    expect(JSON.parse(init.body)).toEqual({ choices: [2] });
  });

  it('refuses without an account rather than calling the instance', async () => {
    const fetchMock = respond({});
    vi.stubGlobal('fetch', fetchMock);

    const client = new MastodonClient('https://mastodon.social');
    await expect(client.votePoll('p1', [0])).rejects.toThrow(/auth/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the updated poll so the UI can re-render it', async () => {
    vi.stubGlobal('fetch', respond({ id: 'p1', votes_count: 7 }));
    expect(await authed().votePoll('p1', [1])).toMatchObject({ votes_count: 7 });
  });

  it('throws with the instance’s reason when the vote is rejected', async () => {
    vi.stubGlobal('fetch', respond({ error: 'Poll has expired' }, false, 422));
    await expect(authed().votePoll('p1', [0])).rejects.toThrow(/expired/i);
  });

  it('supports a multiple-choice vote', async () => {
    const fetchMock = respond({ id: 'p1' });
    vi.stubGlobal('fetch', fetchMock);
    await authed().votePoll('p1', [0, 2]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ choices: [0, 2] });
  });
});

describe('error feedback toasts', () => {
  beforeEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it('records an error toast with its message', () => {
    toast.error('Bookmark failed');
    expect(getToasts().map(t => ({ type: t.type, message: t.message })))
      .toContainEqual({ type: 'error', message: 'Bookmark failed' });
  });

  it('distinguishes a warning from an error', () => {
    toast.warning('Server bookmark sync failed');
    expect(getToasts()[0].type).toBe('warning');
  });

  it('records success separately', () => {
    toast.success('Vote recorded');
    expect(getToasts()[0].type).toBe('success');
  });

  it('keeps several toasts at once', () => {
    toast.error('TTS failed');
    toast.error('Translation failed');
    expect(getToasts()).toHaveLength(2);
  });

  it('gives each toast a distinct id, so dismissing one keeps the other', () => {
    toast.error('first');
    toast.error('second');
    const [a, b] = getToasts();
    expect(a.id).not.toBe(b.id);
    dismissToast(a.id);
    expect(getToasts().map(t => t.message)).toEqual(['second']);
  });

  it('dismissing an unknown id changes nothing', () => {
    toast.error('only');
    dismissToast(999_999);
    expect(getToasts()).toHaveLength(1);
  });
});
