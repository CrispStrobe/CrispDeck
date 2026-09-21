//! macOS: which keychain, and never one we hold the password to.
//!
//! The first version of this created a keychain of its own and kept its
//! password in the login keychain. That was wrong, and a user's experience
//! said why: they had forgotten their login keychain password, and it mattered
//! little because other keychains held what their apps needed. A design that
//! parks its password in the login keychain rebuilds exactly the dependency
//! they had escaped — forget that one password and CrispDeck's credentials go
//! with it.
//!
//! So this holds no keychain password at all. Three choices, none of which
//! require us to keep a secret in order to reach a secret:
//!
//! - DataProtection — the modern keychain, the one Passwords.app surfaces and
//!   iOS uses exclusively. There is no keychain password: items are protected
//!   by the login session, and can optionally sync through iCloud. Needs the
//!   app to be signed with a keychain-access-group entitlement, so an unsigned
//!   development build may be refused — which is why it degrades rather than
//!   insists.
//! - File — a keychain the user already has and manages, named by path. We
//!   open it and read; if it is locked, macOS asks the user, exactly as it
//!   does for any other app. Their password stays theirs.
//! - Login — the default keychain, alongside everything else. Simple, and what
//!   most apps do.
//!
//! We deliberately do not create keychains. `security create-keychain` and
//! Keychain Access both do it better, and a keychain created by an app is one
//! whose password has to live somewhere — which is the mistake above.

#![cfg(target_os = "macos")]

use anyhow::{anyhow, Context, Result};
use security_framework::os::macos::keychain::SecKeychain;
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
};
use security_framework::passwords_options::PasswordOptions;

use super::secret_store::{SecretStore, SERVICE};

/// Which keychain macOS credentials go to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MacKeychain {
    /// The modern keychain: no keychain password, optional iCloud sync.
    DataProtection,
    /// A keychain file the user manages, by path.
    File(String),
    /// The login keychain.
    Login,
}

impl MacKeychain {
    pub fn as_str(&self) -> String {
        match self {
            MacKeychain::DataProtection => "data-protection".to_string(),
            MacKeychain::Login => "login".to_string(),
            MacKeychain::File(path) => path.clone(),
        }
    }

    /// Anything that looks like a path is one; the two names are reserved.
    ///
    /// Defaults to the login keychain rather than DataProtection, because an
    /// unsigned build cannot use the latter and silently falling back to the
    /// encrypted blob would be a worse surprise than using the keychain every
    /// other app uses.
    pub fn parse(value: &str) -> MacKeychain {
        match value {
            "data-protection" => MacKeychain::DataProtection,
            "login" | "" => MacKeychain::Login,
            path if path.contains('/') => MacKeychain::File(path.to_string()),
            _ => MacKeychain::Login,
        }
    }
}

/// Should items follow the user to their other Macs?
///
/// Off unless asked for. Syncing access tokens through iCloud is a reasonable
/// thing to want and a surprising thing to get without choosing it.
fn sync_enabled() -> bool {
    std::env::var("CRISPDECK_KEYCHAIN_ICLOUD_SYNC").as_deref() == Ok("1")
}

fn protected_options(key: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(SERVICE, key);
    options.use_protected_keychain();
    if sync_enabled() {
        options.set_access_synchronized(Some(true));
    }
    options
}

/// The macOS secret store, in whichever keychain the user chose.
pub struct MacKeychainStore {
    pub which: MacKeychain,
}

impl MacKeychainStore {
    /// The file-based keychain for File and Login.
    ///
    /// Note what is absent: any attempt to unlock. A locked keychain makes
    /// macOS ask the user, which is the right party to ask — and means we
    /// never hold a password that could be lost with us.
    fn file_keychain(&self) -> Result<SecKeychain> {
        match &self.which {
            MacKeychain::Login => SecKeychain::default().context("cannot open the login keychain"),
            MacKeychain::File(path) => SecKeychain::open(path)
                .map_err(|e| anyhow!("cannot open the keychain at {path}: {e}")),
            MacKeychain::DataProtection => {
                Err(anyhow!("the data protection keychain is not a file"))
            }
        }
    }
}

impl SecretStore for MacKeychainStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        if self.which == MacKeychain::DataProtection {
            return set_generic_password_options(secret.as_bytes(), protected_options(key))
                .map_err(|e| anyhow!("could not write {key} to the data protection keychain: {e}"));
        }
        self.file_keychain()?
            .set_generic_password(SERVICE, key, secret.as_bytes())
            .map_err(|e| anyhow!("could not write {key} to the keychain: {e}"))
    }

    fn get(&self, key: &str) -> Result<String> {
        if self.which == MacKeychain::DataProtection {
            let bytes = generic_password(protected_options(key))
                .map_err(|e| anyhow!("no data protection keychain entry for {key}: {e}"))?;
            return String::from_utf8(bytes).context("keychain entry is not valid UTF-8");
        }
        let keychain = self.file_keychain()?;
        let (password, _item) = keychain
            .find_generic_password(SERVICE, key)
            .map_err(|e| anyhow!("no keychain entry for {key}: {e}"))?;
        String::from_utf8(password.to_vec()).context("keychain entry is not valid UTF-8")
    }

    fn delete(&self, key: &str) -> Result<()> {
        // Already gone is the outcome the caller wanted: forget() runs on every
        // account deletion, including accounts never stored here.
        if self.which == MacKeychain::DataProtection {
            let _ = delete_generic_password_options(protected_options(key));
            return Ok(());
        }
        let keychain = self.file_keychain()?;
        match keychain.find_generic_password(SERVICE, key) {
            Err(_) => Ok(()),
            Ok((_, item)) => {
                item.delete();
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_names_are_reserved_and_anything_path_like_is_a_path() {
        assert_eq!(MacKeychain::parse("data-protection"), MacKeychain::DataProtection);
        assert_eq!(MacKeychain::parse("login"), MacKeychain::Login);
        assert_eq!(
            MacKeychain::parse("/Users/someone/Library/Keychains/Work.keychain-db"),
            MacKeychain::File("/Users/someone/Library/Keychains/Work.keychain-db".to_string())
        );
    }

    #[test]
    fn an_empty_or_unrecognised_setting_means_the_login_keychain() {
        // Not DataProtection: an unsigned build cannot use that, and falling
        // through to the encrypted blob would surprise people more than using
        // the keychain every other app uses.
        assert_eq!(MacKeychain::parse(""), MacKeychain::Login);
        assert_eq!(MacKeychain::parse("nonsense"), MacKeychain::Login);
    }

    #[test]
    fn a_path_round_trips_through_the_setting() {
        let path = "/Volumes/Secrets/crispdeck.keychain-db";
        assert_eq!(MacKeychain::parse(&MacKeychain::parse(path).as_str()), MacKeychain::File(path.to_string()));
    }

    #[test]
    fn the_names_round_trip_too() {
        for which in [MacKeychain::DataProtection, MacKeychain::Login] {
            assert_eq!(MacKeychain::parse(&which.as_str()), which);
        }
    }
}
