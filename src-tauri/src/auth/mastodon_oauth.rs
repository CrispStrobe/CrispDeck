use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::TcpListener;
use std::time::{Duration, Instant};

#[derive(Debug, Serialize)]
pub struct OAuthStartResult {
    pub auth_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    /// Random per-attempt value echoed back by the instance. The callback is
    /// rejected unless it matches — see `wait_for_oauth_callback`.
    pub state: String,
}

#[derive(Debug, Deserialize)]
struct AppRegistration {
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResult {
    pub access_token: String,
}

/// Step 1: Register app with Mastodon instance, return auth URL.
/// Uses a random localhost port as redirect_uri.
pub async fn start_oauth(instance_url: &str) -> Result<OAuthStartResult> {
    let instance = instance_url.trim_end_matches('/');

    // Find an available port for the OAuth callback
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let state = random_state();

    // Register the app
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/v1/apps", instance))
        .form(&[
            ("client_name", "CrispDeck"),
            ("redirect_uris", &redirect_uri),
            (
                "scopes",
                "read write:statuses write:media write:favourites write:bookmarks",
            ),
            ("website", "https://github.com/CrispStrobe/CrispDeck"),
        ])
        .send()
        .await?;

    let reg: AppRegistration = read_json(resp, "register app").await?;

    let auth_url = format!(
        "{}/oauth/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        instance,
        urlencoding::encode(&reg.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode("read write:statuses write:media write:favourites write:bookmarks"),
        urlencoding::encode(&state),
    );

    Ok(OAuthStartResult {
        auth_url,
        client_id: reg.client_id,
        client_secret: reg.client_secret,
        redirect_uri,
        state,
    })
}

/// A value the attacker cannot guess, so a code delivered to the callback port
/// by anything other than this attempt's browser redirect is refused.
fn random_state() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// An instance that rejects a request answers with its own JSON error, which
/// does not fit the struct we asked for — so parsing straight from the
/// response turned "this instance requires approval" into a serde message
/// about a missing field. Check the status first and carry the body.
async fn read_json<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
    what: &str,
) -> Result<T> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = body.chars().take(300).collect::<String>();
        return Err(anyhow!("could not {what}: instance returned {status}: {detail}"));
    }
    serde_json::from_str(&body)
        .map_err(|e| anyhow!("could not {what}: unexpected reply from instance ({e})"))
}

/// Step 2: Exchange authorization code for access token.
pub async fn complete_oauth(
    instance_url: &str,
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<TokenResult> {
    let instance = instance_url.trim_end_matches('/');
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{}/oauth/token", instance))
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("scope", "read write:statuses write:media write:favourites write:bookmarks"),
        ])
        .send()
        .await?;

    let resp: TokenResponse = read_json(resp, "exchange the authorization code").await?;

    Ok(TokenResult {
        access_token: resp.access_token,
    })
}

/// How long to hold the callback port open. The comment here used to claim an
/// "implicit timeout from the OS"; `accept()` has none, so an authorization the
/// user abandoned in the browser left this blocked forever.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Listen on the redirect port for the OAuth callback and extract the code.
///
/// `expected_state` is the value from `start_oauth`. The port is on loopback
/// but loopback is not private: anything else running as this user can reach
/// it, and before the state check a code delivered there was accepted on
/// sight — which is how an attacker attaches a victim's client to an account
/// the attacker controls. A callback carrying the wrong state is refused.
pub fn wait_for_oauth_callback(redirect_uri: &str, expected_state: &str) -> Result<String> {
    wait_for_oauth_callback_until(redirect_uri, expected_state, CALLBACK_TIMEOUT)
}

fn wait_for_oauth_callback_until(
    redirect_uri: &str,
    expected_state: &str,
    timeout: Duration,
) -> Result<String> {
    let port: u16 = redirect_uri
        .rsplit(':')
        .next()
        .and_then(|s| s.split('/').next())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow!("invalid redirect_uri"))?;

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))?;
    listener.set_nonblocking(true)?;

    let deadline = Instant::now() + timeout;
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(anyhow!(
                        "timed out waiting for the authorization to come back from the browser"
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.into()),
        }
    };
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf)?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // "GET /callback?code=XXXX&state=YYYY HTTP/1.1"
    let query = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.split('?').nth(1))
        .unwrap_or("");

    let param = |name: &str| -> Option<String> {
        query.split('&').find_map(|pair| {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some(name) {
                kv.next().map(urlencoding::decode)
            } else {
                None
            }
        })
    };

    let outcome = (|| -> Result<String> {
        // The instance says why it refused — "access_denied" when the user
        // pressed Cancel. Reporting "no code in OAuth callback" for that told
        // the user nothing about what had happened.
        if let Some(err) = param("error") {
            let description = param("error_description").unwrap_or_default();
            return Err(if description.is_empty() {
                anyhow!("the instance refused the authorization: {err}")
            } else {
                anyhow!("the instance refused the authorization: {err} ({description})")
            });
        }

        let state = param("state").unwrap_or_default();
        if state != expected_state {
            return Err(anyhow!(
                "the authorization did not come from this sign-in attempt; ignoring it"
            ));
        }

        param("code").ok_or_else(|| anyhow!("no code in OAuth callback"))
    })();

    // Answer either way, or the browser sits on a blank tab waiting.
    let body = match &outcome {
        Ok(_) => "<h2>Authorization successful!</h2>\
            <p>You can close this tab and return to CrispDeck.</p>"
            .to_string(),
        Err(e) => format!("<h2>Authorization failed</h2><p>{}</p>", html_escape(&e.to_string())),
    };
    let status = if outcome.is_ok() { "200 OK" } else { "400 Bad Request" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n<html><body>{body}</body></html>",
        body.len() + 26
    );
    use std::io::Write;
    stream.write_all(response.as_bytes()).ok();

    outcome
}

/// The error text lands in a page we serve, and part of it comes from the
/// instance.
fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// URL encoding helper (no extra dep needed for just this)
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut result = String::new();
        for b in input.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(b as char);
                }
                _ => {
                    result.push_str(&format!("%{:02X}", b));
                }
            }
        }
        result
    }

    /// The query string arrives percent-encoded, and the code was previously
    /// passed to the token endpoint exactly as it came off the wire — so a
    /// code containing any reserved character was sent back wrong.
    pub fn decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'%' if i + 2 < bytes.len() => {
                    let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                    match u8::from_str_radix(hex, 16) {
                        Ok(b) => {
                            out.push(b);
                            i += 3;
                        }
                        Err(_) => {
                            out.push(bytes[i]);
                            i += 1;
                        }
                    }
                }
                b'+' => {
                    out.push(b' ');
                    i += 1;
                }
                b => {
                    out.push(b);
                    i += 1;
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpStream;

    /// A free port, released again. Both the callback listener and the fake
    /// instance need to be told a port before they bind it.
    fn free_port() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        p
    }

    /// A stand-in for a Mastodon instance: answers one request with the given
    /// status and body, then stops. Enough to drive the real reqwest client
    /// through the real parsing, which is the part that was wrong.
    fn fake_instance(status: &str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let status = status.to_string();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    /// Runs the callback listener in the background and sends it one request.
    fn callback_with(query: &str, expected_state: &str) -> Result<String> {
        let port = free_port();
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");
        let expected = expected_state.to_string();
        let handle = std::thread::spawn(move || {
            wait_for_oauth_callback_until(&redirect_uri, &expected, Duration::from_secs(10))
        });

        // The listener binds on its own thread, so connecting can lose the race.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(s) => break s,
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(e) => panic!("callback listener never came up: {e}"),
            }
        };
        write!(stream, "GET /callback?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        stream.flush().unwrap();

        handle.join().unwrap()
    }

    #[test]
    fn a_callback_carrying_the_right_state_yields_the_code() {
        let code = callback_with("code=abc123&state=s3cr3t", "s3cr3t").unwrap();
        assert_eq!(code, "abc123");
    }

    #[test]
    fn a_callback_from_a_different_attempt_is_refused() {
        // The one this exists for. The port is on loopback, but loopback is
        // not private: any process running as this user can post a code to it.
        // Before the state check that code was accepted, which attaches the
        // user's client to whichever account the attacker authorized.
        let err = callback_with("code=attacker-code&state=wrong", "s3cr3t").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("this sign-in attempt"), "unexpected message: {msg}");
        assert!(!msg.contains("attacker-code"));
    }

    #[test]
    fn a_callback_with_no_state_at_all_is_refused() {
        // What the old callbacks looked like. It must not keep working.
        let err = callback_with("code=abc123", "s3cr3t").unwrap_err();
        assert!(err.to_string().contains("this sign-in attempt"));
    }

    #[test]
    fn pressing_cancel_reports_what_the_instance_said() {
        // Previously "no code in OAuth callback", which describes our parser
        // rather than what happened.
        let err = callback_with(
            "error=access_denied&error_description=The+user+denied+the+request&state=s3cr3t",
            "s3cr3t",
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("access_denied"), "unexpected message: {msg}");
        assert!(msg.contains("denied the request"), "unexpected message: {msg}");
    }

    #[test]
    fn a_percent_encoded_code_is_decoded_before_it_is_used() {
        // The code went to the token endpoint exactly as it came off the wire,
        // so any reserved character in it was sent back still encoded.
        let code = callback_with("code=a%2Fb%2Bc%3Dd&state=s", "s").unwrap();
        assert_eq!(code, "a/b+c=d");
    }

    #[test]
    fn an_abandoned_authorization_gives_up_instead_of_blocking_forever() {
        // accept() has no timeout of its own, whatever the old comment said.
        let port = free_port();
        let uri = format!("http://127.0.0.1:{port}/callback");
        let started = Instant::now();
        let err = wait_for_oauth_callback_until(&uri, "s", Duration::from_millis(300)).unwrap_err();
        assert!(err.to_string().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn the_state_is_long_and_different_every_time() {
        let a = random_state();
        let b = random_state();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn the_error_page_does_not_hand_the_instances_text_to_the_browser_as_markup() {
        assert_eq!(html_escape("<script>&\"x\""), "&lt;script&gt;&amp;&quot;x&quot;");
    }

    #[test]
    fn encoding_round_trips() {
        for s in ["a/b+c=d", "plain", "sp ace", "ü", "100%"] {
            assert_eq!(urlencoding::decode(&urlencoding::encode(s)), s);
        }
    }

    #[tokio::test]
    async fn starting_an_oauth_puts_the_state_in_the_url_it_sends_you_to() {
        let instance = fake_instance(
            "200 OK",
            r#"{"client_id":"cid-1","client_secret":"csec-1"}"#,
        );
        let result = start_oauth(&instance).await.unwrap();

        assert_eq!(result.client_id, "cid-1");
        assert_eq!(result.client_secret, "csec-1");
        assert_eq!(result.state.len(), 64);
        assert!(
            result.auth_url.contains(&format!("state={}", result.state)),
            "auth_url carried no state: {}",
            result.auth_url
        );
        assert!(result.auth_url.contains("client_id=cid-1"));
        assert!(result.redirect_uri.starts_with("http://127.0.0.1:"));
    }

    #[tokio::test]
    async fn an_instance_that_refuses_registration_says_so_in_its_own_words() {
        // The reply was parsed straight into AppRegistration, so a 403 became
        // "missing field `client_id`" — which sends the user looking in
        // entirely the wrong place.
        let instance = fake_instance("403 Forbidden", r#"{"error":"registrations closed"}"#);
        let err = start_oauth(&instance).await.unwrap_err().to_string();

        assert!(err.contains("403"), "unexpected message: {err}");
        assert!(err.contains("registrations closed"), "unexpected message: {err}");
        assert!(!err.contains("missing field"), "still a serde message: {err}");
    }

    #[tokio::test]
    async fn a_successful_exchange_returns_the_token() {
        let instance = fake_instance("200 OK", r#"{"access_token":"tok-1","token_type":"Bearer"}"#);
        let result = complete_oauth(&instance, "code", "cid", "csec", "http://127.0.0.1:1/callback")
            .await
            .unwrap();
        assert_eq!(result.access_token, "tok-1");
    }

    #[tokio::test]
    async fn a_rejected_exchange_reports_the_status_and_the_reason() {
        let instance = fake_instance("401 Unauthorized", r#"{"error":"invalid_grant"}"#);
        let err = complete_oauth(&instance, "stale", "cid", "csec", "http://127.0.0.1:1/callback")
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("401"), "unexpected message: {err}");
        assert!(err.contains("invalid_grant"), "unexpected message: {err}");
    }

    #[tokio::test]
    async fn a_trailing_slash_on_the_instance_url_does_not_double_up() {
        let instance = fake_instance("200 OK", r#"{"access_token":"tok-1"}"#);
        let result = complete_oauth(
            &format!("{instance}/"),
            "code",
            "cid",
            "csec",
            "http://127.0.0.1:1/callback",
        )
        .await
        .unwrap();
        assert_eq!(result.access_token, "tok-1");
    }
}
