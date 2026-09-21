/**
 * What the OAuth callback page has to establish before it spends a code.
 *
 * The page used to take `code` straight off the query string: no check that
 * the redirect belonged to the sign-in this browser had started. The port on
 * the desktop build is loopback and the page on the web build is a public
 * URL, and in both cases anyone who can get the browser to open it with a
 * `code` of their choosing gets CrispDeck to exchange it — which attaches the
 * user's client to whichever account the attacker authorized. A random state
 * per attempt, echoed back by the instance and compared here, is what closes
 * that.
 *
 * Kept out of the Svelte component so it can be tested without a browser.
 */

/** What `startMastodonOAuth` stored before sending the browser away. */
export interface StoredOAuthState {
  instance_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  /** Optional in the type because an entry written by an older build has none. */
  state?: string;
}

export class OAuthCallbackError extends Error {
  /** Whether the stored attempt should be dropped rather than retried. */
  readonly discardStored: boolean;

  constructor(message: string, discardStored = false) {
    super(message);
    this.name = 'OAuthCallbackError';
    this.discardStored = discardStored;
  }
}

/**
 * Returns the authorization code, or throws with something the user can act
 * on. `params` is the callback URL's query string.
 */
export function verifyCallback(
  params: URLSearchParams,
  stored: StoredOAuthState | null
): string {
  // The instance says why it refused — "access_denied" when the user pressed
  // Cancel. Reporting a missing code for that describes our parser rather
  // than what happened.
  const refused = params.get('error');
  if (refused) {
    const description = params.get('error_description');
    throw new OAuthCallbackError(
      description
        ? `The instance refused the authorization: ${refused} (${description})`
        : `The instance refused the authorization: ${refused}`,
      true
    );
  }

  if (!stored) {
    throw new OAuthCallbackError(
      'No OAuth state found. Please try connecting your account again.'
    );
  }

  // An entry with no state is one an older build wrote, or one that was
  // tampered with. Either way there is nothing to compare against, so the
  // check cannot be satisfied and the attempt has to be started again.
  if (!stored.state || params.get('state') !== stored.state) {
    throw new OAuthCallbackError(
      'This authorization did not come from the sign-in you started. ' +
        'Nothing was connected — please try again from Settings.',
      true
    );
  }

  const code = params.get('code');
  if (!code) {
    throw new OAuthCallbackError('No authorization code in callback URL');
  }
  return code;
}
