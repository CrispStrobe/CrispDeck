use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, Result};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

/// Derive a 256-bit key from a passphrase + salt using Argon2id.
fn derive_key(passphrase: &[u8], salt: &[u8]) -> Result<[u8; 32]> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|e| anyhow!("argon2 error: {}", e))?;
    Ok(key)
}

/// Get the passphrase for credential encryption.
/// Uses a machine-stable value so credentials survive app restarts.
/// In production you'd want a user-set passphrase; for now we use a
/// hardcoded app-level secret combined with the machine hostname.
fn get_passphrase() -> Vec<u8> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "crispdeck-default".to_string());
    format!("CrispDeck-v1-{}", hostname).into_bytes()
}

/// Encrypt plaintext credentials. Returns base64(salt + nonce + ciphertext).
pub fn encrypt(plaintext: &str) -> Result<String> {
    let passphrase = get_passphrase();

    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let key = derive_key(&passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow!("cipher error: {}", e))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("encryption error: {}", e))?;

    // Pack: salt (16) + nonce (12) + ciphertext
    let mut packed = Vec::with_capacity(16 + 12 + ciphertext.len());
    packed.extend_from_slice(&salt);
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);

    Ok(B64.encode(&packed))
}

/// Decrypt base64(salt + nonce + ciphertext) back to plaintext.
pub fn decrypt(encoded: &str) -> Result<String> {
    let passphrase = get_passphrase();
    let packed = B64.decode(encoded)?;

    if packed.len() < 28 {
        return Err(anyhow!("invalid encrypted data"));
    }

    let salt = &packed[..16];
    let nonce_bytes = &packed[16..28];
    let ciphertext = &packed[28..];

    let key = derive_key(&passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow!("cipher error: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("decryption error: {}", e))?;

    Ok(String::from_utf8(plaintext)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let secret = r#"{"app_password":"xxxx-yyyy-zzzz"}"#;
        let encrypted = encrypt(secret).unwrap();
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(secret, decrypted);
    }
}
