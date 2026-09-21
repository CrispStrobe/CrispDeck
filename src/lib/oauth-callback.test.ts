/**
 * The OAuth callback page exchanged whatever `code` it was handed. These tests
 * pin the check that stops that, and the reasons it can refuse.
 */
import { describe, it, expect } from 'vitest';
import { verifyCallback, OAuthCallbackError, type StoredOAuthState } from './oauth-callback';

const attempt = (state?: string): StoredOAuthState => ({
  instance_url: 'https://mastodon.social',
  client_id: 'cid',
  client_secret: 'csec',
  redirect_uri: 'https://app.example/oauth/callback',
  ...(state === undefined ? {} : { state }),
});

const query = (s: string) => new URLSearchParams(s);

describe('verifyCallback', () => {
  it('returns the code when the state matches the attempt', () => {
    expect(verifyCallback(query('code=abc123&state=s3cr3t'), attempt('s3cr3t'))).toBe('abc123');
  });

  it('refuses a code that arrives with somebody else’s state', () => {
    // The attack this exists for: a link that opens /oauth/callback with a
    // code the attacker obtained, binding this client to their account.
    let thrown: unknown;
    try {
      verifyCallback(query('code=attacker-code&state=not-ours'), attempt('s3cr3t'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(OAuthCallbackError);
    expect(String(thrown)).toContain('did not come from the sign-in you started');
  });

  it('refuses a callback carrying no state at all', () => {
    // Exactly what every callback looked like before this change, so it has to
    // stop being accepted rather than being treated as "nothing to compare".
    expect(() => verifyCallback(query('code=abc123'), attempt('s3cr3t'))).toThrow(
      /did not come from the sign-in/
    );
  });

  it('refuses when the stored attempt predates states', () => {
    // An entry written by an older build. There is nothing to check against,
    // so the attempt has to be started again rather than waved through.
    expect(() => verifyCallback(query('code=abc123&state=anything'), attempt())).toThrow(
      /did not come from the sign-in/
    );
  });

  it('drops the stored attempt when the state is wrong, so a retry starts clean', () => {
    try {
      verifyCallback(query('code=x&state=wrong'), attempt('right'));
      expect.unreachable();
    } catch (e) {
      expect((e as OAuthCallbackError).discardStored).toBe(true);
    }
  });

  it('reports what the instance said when the user pressed Cancel', () => {
    expect(() =>
      verifyCallback(
        query('error=access_denied&error_description=The+user+denied+the+request'),
        attempt('s3cr3t')
      )
    ).toThrow(/access_denied.*denied the request/);
  });

  it('reports a bare error with no description', () => {
    expect(() => verifyCallback(query('error=server_error'), attempt('s3cr3t'))).toThrow(
      /server_error/
    );
  });

  it('checks the instance’s refusal before anything else, so a lost attempt still explains itself', () => {
    expect(() => verifyCallback(query('error=access_denied'), null)).toThrow(/access_denied/);
  });

  it('says the attempt is missing rather than blaming the state', () => {
    expect(() => verifyCallback(query('code=abc&state=s'), null)).toThrow(/No OAuth state found/);
  });

  it('reports a matching state with no code', () => {
    expect(() => verifyCallback(query('state=s3cr3t'), attempt('s3cr3t'))).toThrow(
      /No authorization code/
    );
  });

  it('does not treat an empty state as a match for an empty stored state', () => {
    expect(() => verifyCallback(query('code=abc&state='), attempt(''))).toThrow(
      /did not come from the sign-in/
    );
  });
});
