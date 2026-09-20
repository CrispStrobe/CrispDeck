/**
 * fetch that fails when the request failed.
 *
 * `fetch` only rejects on a network-level error. A 401, a 403, a 404, a 500
 * all resolve normally, so `await fetch(...)` inside a try/catch reports
 * success for a request the server refused. That is how "User blocked." and
 * "message sent" were shown for actions that never happened: the catch block
 * was fine, the error simply never arrived.
 *
 * Use fetchOk anywhere the response status is the difference between the
 * action having happened and not. Where the body is wanted, fetchJson also
 * parses it.
 */

/** A non-2xx response, carrying enough to debug without leaking credentials. */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string, what?: string) {
    super(`${what ? what + ': ' : ''}${status} from ${url}${body ? ` — ${body}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * Strip the query string before putting a URL in an error message.
 *
 * Access tokens, OAuth codes and DPoP nonces travel as query parameters on
 * some of these endpoints, and an error message ends up in the in-app log
 * viewer, which users are asked to paste into bug reports.
 */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://localhost');
    return u.origin === 'http://localhost' ? u.pathname : `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

/** Read a short excerpt of the body for the error message, never the whole thing. */
async function excerpt(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return '';
    // Mastodon and Bluesky both return {"error": "..."} shapes; prefer that.
    try {
      const parsed = JSON.parse(text);
      const msg = parsed?.error_description ?? parsed?.message ?? parsed?.error;
      if (typeof msg === 'string') return msg.slice(0, 200);
    } catch {
      // Not JSON — fall through to the raw text.
    }
    return text.slice(0, 200);
  } catch {
    // A body that cannot be read must not replace the status with a crash.
    return '';
  }
}

/**
 * fetch, but a non-2xx response throws.
 *
 * @param what short description used in the error, e.g. 'block account'
 */
export async function fetchOk(input: string, init?: RequestInit, what?: string): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new HttpError(response.status, safeUrl(input), await excerpt(response), what);
  }
  return response;
}

/** fetchOk plus JSON parsing. */
export async function fetchJson<T = unknown>(input: string, init?: RequestInit, what?: string): Promise<T> {
  const response = await fetchOk(input, init, what);
  return (await response.json()) as T;
}
