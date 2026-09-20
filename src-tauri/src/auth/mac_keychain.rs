//! macOS: a keychain of our own, rather than the login one.
//!
//! The `keyring` crate uses the default login keychain and offers no way to
//! choose another, which is why macOS was left on the local encrypted blob
//! when the other platforms moved to their OS stores.
//!
//! WHAT A SEPARATE KEYCHAIN ACTUALLY BUYS. Not a stronger root of trust: the
//! password for this keychain is itself kept in the login keychain, so anyone
//! who can open that can reach this one. What it buys is independent locking.
//! The login keychain typically stays unlocked for a whole session; this one
//! is set to lock on sleep and after fifteen minutes idle, so a walked-away-
//! from Mac stops handing out access tokens without logging the user out of
//! everything else they own. Say that plainly rather than implying more.
//!
//! The user can choose the login keychain instead — some people prefer one
//! place for everything, and a security control nobody understands gets
//! turned off rather than used.

#![cfg(target_os = "macos")]

use anyhow::{anyhow, Context, Result};
use security_framework::os::macos::keychain::{CreateOptions, KeychainSettings, SecKeychain};

use super::secret_store::{SecretStore, SERVICE};

/// Which keychain macOS credentials go to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacKeychain {
    /// A keychain belonging to this app, locked independently.
    Dedicated,
    /// The user's login keychain, alongside everything else.
    Login,
}

impl MacKeychain {
    pub fn as_str(self) -> &'static str {
        match self {
            MacKeychain::Dedicated => "dedicated",
            MacKeychain::Login => "login",
        }
    }

    pub fn parse(value: &str) -> MacKeychain {
        match value {
            "login" => MacKeychain::Login,
            _ => MacKeychain::Dedicated,
        }
    }
}

/// The account name the dedicated keychain's own password is filed under, in
/// the login keychain.
const KEYCHAIN_PASSWORD_ACCOUNT: &str = "dedicated-keychain-password";

/// Lock fifteen minutes after the last use.
const LOCK_INTERVAL_SECONDS: u32 = 15 * 60;

/// Where the dedicated keychain lives.
///
/// Overridable so tests can work in a directory they own rather than the
/// user's real keychain directory — CI runs these against the real Security
/// framework, and a test that writes to ~/Library/Keychains is a test that
/// leaves something behind.
fn keychain_path() -> Result<String> {
    if let Ok(path) = std::env::var("CRISPDECK_KEYCHAIN_PATH") {
        return Ok(path);
    }
    let home = std::env::var("HOME").context("no HOME to put a keychain in")?;
    Ok(format!("{home}/Library/Keychains/CrispDeck.keychain-db"))
}

/// A password for the dedicated keychain, generated once and kept in the
/// login keychain.
///
/// Generated rather than asked for: prompting on first launch to invent a
/// second password is how people end up choosing the same one they already
/// use, or writing it down.
fn dedicated_password() -> Result<String> {
    let login = SecKeychain::default().context("cannot open the login keychain")?;

    if let Ok((password, _)) = login.find_generic_password(SERVICE, KEYCHAIN_PASSWORD_ACCOUNT) {
        return Ok(String::from_utf8(password.to_vec())
            .context("the stored keychain password is not valid UTF-8")?);
    }

    let generated = generate_password();
    login
        .set_generic_password(SERVICE, KEYCHAIN_PASSWORD_ACCOUNT, generated.as_bytes())
        .map_err(|e| anyhow!("could not store the keychain password: {e}"))?;
    Ok(generated)
}

/// 32 bytes of randomness, hex encoded.
fn generate_password() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Open the dedicated keychain, creating it the first time.
fn open_dedicated() -> Result<SecKeychain> {
    let path = keychain_path()?;
    let password = dedicated_password()?;

    match SecKeychain::open(&path) {
        Ok(mut keychain) => {
            // Opening succeeds for a keychain that is merely locked, so unlock
            // before use or the first read fails with a prompt behind it.
            keychain
                .unlock(Some(&password))
                .map_err(|e| anyhow!("could not unlock {path}: {e}"))?;
            Ok(keychain)
        }
        Err(_) => create_dedicated(&path, &password),
    }
}

fn create_dedicated(path: &str, password: &str) -> Result<SecKeychain> {
    let mut keychain = CreateOptions::new()
        .password(password)
        // Never prompt: this may run while the app is starting, and a modal
        // nobody is there to answer is a hang.
        .prompt_user(false)
        .create(path)
        .map_err(|e| anyhow!("could not create {path}: {e}"))?;

    // The reason for a separate keychain in the first place.
    let mut settings = KeychainSettings::new();
    settings.set_lock_on_sleep(true);
    settings.set_lock_interval(Some(LOCK_INTERVAL_SECONDS));
    keychain
        .set_settings(&settings)
        .map_err(|e| anyhow!("could not set lock settings on {path}: {e}"))?;

    Ok(keychain)
}

/// The macOS secret store, in whichever keychain the user chose.
pub struct MacKeychainStore {
    pub which: MacKeychain,
}

impl MacKeychainStore {
    fn keychain(&self) -> Result<SecKeychain> {
        match self.which {
            MacKeychain::Login => {
                SecKeychain::default().context("cannot open the login keychain")
            }
            MacKeychain::Dedicated => open_dedicated(),
        }
    }
}

impl SecretStore for MacKeychainStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        self.keychain()?
            .set_generic_password(SERVICE, key, secret.as_bytes())
            .map_err(|e| anyhow!("could not write {key} to the keychain: {e}"))
    }

    fn get(&self, key: &str) -> Result<String> {
        let keychain = self.keychain()?;
        let (password, _item) = keychain
            .find_generic_password(SERVICE, key)
            .map_err(|e| anyhow!("no keychain entry for {key}: {e}"))?;
        String::from_utf8(password.to_vec()).context("keychain entry is not valid UTF-8")
    }

    fn delete(&self, key: &str) -> Result<()> {
        let keychain = self.keychain()?;
        match keychain.find_generic_password(SERVICE, key) {
            // Already gone is the outcome the caller wanted; forget() runs on
            // every account deletion, including ones never stored here.
            Err(_) => Ok(()),
            Ok((_, item)) => {
                item.delete();
                Ok(())
            }
        }
    }
}
