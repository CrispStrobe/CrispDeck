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
    #[cfg(not(mobile))]
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "crispdeck-default".to_string());
    #[cfg(mobile)]
    let hostname = "crispdeck-mobile".to_string();
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

    /// Credential blobs are AES-256-GCM. GCM is an AEAD: tampering with any
    /// byte of the ciphertext, nonce or salt must make decryption *fail*, not
    /// return altered plaintext. That property is the reason for choosing it,
    /// and a round-trip test alone never exercises it.
    ///
    /// These run against the real cipher. They are cheap — Argon2 with the
    /// default parameters dominates, at a few hundred milliseconds each.

    fn sample() -> &'static str {
        r#"{"app_password":"xxxx-yyyy-zzzz","handle":"someone.bsky.social"}"#
    }

    #[test]
    fn test_roundtrip() {
        let secret = sample();
        let encrypted = encrypt(secret).unwrap();
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(secret, decrypted);
    }

    #[test]
    fn ciphertext_is_not_the_plaintext() {
        // A trivially broken implementation would still pass a round trip.
        let encrypted = encrypt(sample()).unwrap();
        assert!(!encrypted.contains("app_password"));
        assert!(!encrypted.contains("xxxx-yyyy-zzzz"));
    }

    #[test]
    fn each_encryption_differs() {
        // Salt and nonce are drawn fresh per call. Identical output for
        // identical input would mean one of them is fixed, which for GCM is
        // catastrophic: two messages under one key and nonce leak their xor.
        let a = encrypt(sample()).unwrap();
        let b = encrypt(sample()).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let encrypted = encrypt(sample()).unwrap();
        let mut packed = B64.decode(&encrypted).unwrap();
        let last = packed.len() - 1;
        packed[last] ^= 0x01; // flip one bit of the ciphertext

        assert!(decrypt(&B64.encode(&packed)).is_err());
    }

    #[test]
    fn tampered_nonce_is_rejected() {
        let encrypted = encrypt(sample()).unwrap();
        let mut packed = B64.decode(&encrypted).unwrap();
        packed[20] ^= 0x01; // inside the 16..28 nonce

        assert!(decrypt(&B64.encode(&packed)).is_err());
    }

    #[test]
    fn tampered_salt_is_rejected() {
        // A different salt derives a different key, so the tag will not verify.
        let encrypted = encrypt(sample()).unwrap();
        let mut packed = B64.decode(&encrypted).unwrap();
        packed[0] ^= 0x01;

        assert!(decrypt(&B64.encode(&packed)).is_err());
    }

    #[test]
    fn truncated_input_is_rejected_without_panicking() {
        // Shorter than salt+nonce: the slicing below it would panic on a
        // range out of bounds if the length check were ever removed.
        let encrypted = encrypt(sample()).unwrap();
        let packed = B64.decode(&encrypted).unwrap();

        for len in [0usize, 1, 15, 16, 27] {
            let short = B64.encode(&packed[..len.min(packed.len())]);
            assert!(decrypt(&short).is_err(), "length {} should be rejected", len);
        }
    }

    #[test]
    fn header_only_input_is_rejected() {
        // Exactly 28 bytes: the length check passes and the ciphertext is
        // empty. GCM must reject it for want of an authentication tag.
        let packed = vec![0u8; 28];
        assert!(decrypt(&B64.encode(&packed)).is_err());
    }

    #[test]
    fn invalid_base64_is_rejected() {
        assert!(decrypt("this is not base64!!!").is_err());
        assert!(decrypt("").is_err());
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let encrypted = encrypt("").unwrap();
        assert_eq!(decrypt(&encrypted).unwrap(), "");
    }

    #[test]
    fn unicode_round_trips() {
        // Credentials carry display names, which are arbitrary UTF-8.
        let secret = r#"{"name":"Zoë 日本語 🔑","token":"ü-ß-é"}"#;
        let encrypted = encrypt(secret).unwrap();
        assert_eq!(decrypt(&encrypted).unwrap(), secret);
    }

    #[test]
    fn a_large_credential_round_trips() {
        // OAuth blobs with a DPoP key and a long refresh token are not small.
        let secret = "x".repeat(16 * 1024);
        let encrypted = encrypt(&secret).unwrap();
        assert_eq!(decrypt(&encrypted).unwrap(), secret);
    }

    #[test]
    fn the_packed_layout_is_what_decrypt_expects() {
        // salt(16) + nonce(12) + ciphertext, and GCM adds a 16-byte tag.
        let encrypted = encrypt("a").unwrap();
        let packed = B64.decode(&encrypted).unwrap();
        assert_eq!(packed.len(), 16 + 12 + 1 + 16);
    }
}
