use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::TcpListener;

#[derive(Debug, Serialize)]
pub struct OAuthStartResult {
    pub auth_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
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

    // Register the app
    let client = reqwest::Client::new();
    let reg: AppRegistration = client
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
        .await?
        .json()
        .await?;

    let auth_url = format!(
        "{}/oauth/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}",
        instance,
        reg.client_id,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode("read write:statuses write:media write:favourites write:bookmarks"),
    );

    Ok(OAuthStartResult {
        auth_url,
        client_id: reg.client_id,
        client_secret: reg.client_secret,
        redirect_uri,
    })
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

    let resp: TokenResponse = client
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
        .await?
        .json()
        .await?;

    Ok(TokenResult {
        access_token: resp.access_token,
    })
}

/// Listen on the redirect port for the OAuth callback, extract the code.
/// This blocks until the callback arrives or times out.
pub fn wait_for_oauth_callback(redirect_uri: &str) -> Result<String> {
    let port: u16 = redirect_uri
        .split(':')
        .last()
        .and_then(|s| s.split('/').next())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow!("invalid redirect_uri"))?;

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))?;
    listener
        .set_nonblocking(false)
        .ok();

    // Wait for one connection (with implicit timeout from OS)
    let (mut stream, _) = listener.accept()?;
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf)?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse "GET /callback?code=XXXX HTTP/1.1"
    let code = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| {
            path.split('?')
                .nth(1)
                .and_then(|query| {
                    query.split('&').find_map(|param| {
                        let mut kv = param.splitn(2, '=');
                        if kv.next() == Some("code") {
                            kv.next().map(String::from)
                        } else {
                            None
                        }
                    })
                })
        })
        .ok_or_else(|| anyhow!("no code in OAuth callback"))?;

    // Send a simple response
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <html><body><h2>Authorization successful!</h2>\
        <p>You can close this tab and return to CrispDeck.</p></body></html>";
    use std::io::Write;
    stream.write_all(response.as_bytes()).ok();

    Ok(code)
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
}
