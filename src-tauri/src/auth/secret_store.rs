//! Where the credential secret actually lives.
//!
//! Until now there was one answer: an AES-256-GCM blob in the accounts table,
//! keyed by a passphrase derived from the machine hostname. The cryptography
//! is sound; the key is not a secret. Anyone who can read the database can
//! also read the hostname, which on a shared machine is everyone.
//!
//! The operating system already has somewhere to put this — Secret Service on
//! Linux, Credential Manager on Windows, Keychain on macOS. So the secret goes
//! there and the database keeps only a reference.
//!
//! MIGRATION. The reference is stored in the same `credentials_enc` column, as
//! `keychain:v1:<key>`. Anything without that prefix is read the old way, so
//! existing rows keep working and no migration step has to run. A row written
//! by one backend is readable after switching to the other, because `load`
//! dispatches on what it finds rather than on the current preference.
//!
//! FALLBACK. A headless Linux box has no Secret Service. Rather than refuse to
//! start, the store falls back to the local blob and reports which backend it
//! used, so the caller can say so rather than implying a protection that is
//! not there.
//!
//! macOS is special-cased. The `keyring` crate uses the default login keychain
//! and cannot select another, so macOS goes through `security-framework`
//! directly: the modern data protection keychain, the login keychain, or a
//! keychain file the user already manages. See mac_keychain.rs.

use anyhow::{anyhow, Result};

use super::credentials;

/// Marker prefix for a secret held outside the database.
const KEYCHAIN_PREFIX: &str = "keychain:v1:";

/// The service name secrets are filed under in the OS store.
pub const SERVICE: &str = "CrispDeck";

/// Which store a secret should be written to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// The operating system's secret store.
    Keychain,
    /// The encrypted blob in the database. Weaker, and always available.
    Local,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Keychain => "keychain",
            Backend::Local => "local",
        }
    }

    pub fn parse(value: &str) -> Backend {
        match value {
            "keychain" => Backend::Keychain,
            _ => Backend::Local,
        }
    }
}

/// The OS secret store, behind a trait so the logic above it can be tested
/// without one. A test double is not a substitute for running against the
/// real Keychain — it is a way to check the dispatch, the fallback and the
/// migration, which is where the bugs would otherwise be.
pub trait SecretStore {
    fn set(&self, key: &str, secret: &str) -> Result<()>;
    fn get(&self, key: &str) -> Result<String>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// The key an account's secret is filed under.
///
/// Keyed on platform and handle rather than the row id, because the id does
/// not exist until the row is inserted — and inserting first would mean
/// writing the secret to disk before moving it, which is the thing this is
/// meant to avoid. The accounts table already enforces UNIQUE(platform,
/// handle), so this is unique for the same reason the row is.
pub fn key_for(platform: &str, handle: &str) -> String {
    format!("{platform}:{handle}")
}

/// Write a secret, returning the value to put in the `credentials_enc` column.
///
/// Returns the backend actually used: asking for Keychain on a machine with no
/// secret service yields Local, and the caller should say so rather than
/// claim the stronger one.
pub fn store(
    preferred: Backend,
    store: &dyn SecretStore,
    platform: &str,
    handle: &str,
    plaintext: &str,
) -> Result<(String, Backend)> {
    if preferred == Backend::Keychain {
        let key = key_for(platform, handle);
        match store.set(&key, plaintext) {
            Ok(()) => return Ok((format!("{KEYCHAIN_PREFIX}{key}"), Backend::Keychain)),
            Err(e) => {
                log::warn!("secret store unavailable, falling back to the local blob: {e}");
            }
        }
    }
    Ok((credentials::encrypt(plaintext)?, Backend::Local))
}

/// Read a secret back, whichever backend wrote it.
pub fn load(store: &dyn SecretStore, column: &str) -> Result<String> {
    match column.strip_prefix(KEYCHAIN_PREFIX) {
        Some(key) => store
            .get(key)
            .map_err(|e| anyhow!("credential missing from the secret store ({key}): {e}")),
        None => credentials::decrypt(column),
    }
}

/// Remove a secret when its account is deleted.
///
/// A local blob needs nothing — it goes with the row. A keychain entry would
/// otherwise outlive the account that owned it.
pub fn forget(store: &dyn SecretStore, column: &str) -> Result<()> {
    match column.strip_prefix(KEYCHAIN_PREFIX) {
        Some(key) => store.delete(key),
        None => Ok(()),
    }
}

/// Is this column value a reference rather than a blob?
pub fn is_keychain_ref(column: &str) -> bool {
    column.starts_with(KEYCHAIN_PREFIX)
}


/// The real OS secret store, where there is one.
///
/// Present on Linux (Secret Service) and Windows (Credential Manager). On any
/// other platform — macOS for now, and anything unknown — every call fails, so
/// `store` falls back to the local blob and reports that it did.
pub struct OsSecretStore;

#[cfg(any(target_os = "linux", target_os = "windows"))]
impl SecretStore for OsSecretStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, key)?;
        entry.set_password(secret)?;
        Ok(())
    }

    fn get(&self, key: &str) -> Result<String> {
        let entry = keyring::Entry::new(SERVICE, key)?;
        Ok(entry.get_password()?)
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, key)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            // Already gone is the outcome the caller wanted.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

/// macOS goes through security-framework because keyring can only ever use the
/// login keychain. The choice of keychain is the user's — including pointing
/// at one they already manage — and we never hold a keychain password, so
/// losing one cannot take CrispDeck's credentials with it. See mac_keychain.rs.
#[cfg(target_os = "macos")]
impl SecretStore for OsSecretStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        super::mac_keychain::MacKeychainStore { which: mac_keychain_choice() }.set(key, secret)
    }
    fn get(&self, key: &str) -> Result<String> {
        super::mac_keychain::MacKeychainStore { which: mac_keychain_choice() }.get(key)
    }
    fn delete(&self, key: &str) -> Result<()> {
        super::mac_keychain::MacKeychainStore { which: mac_keychain_choice() }.delete(key)
    }
}

/// Which keychain to use: one of the two reserved names, or a path to a
/// keychain the user already manages.
///
/// Read from the environment so the choice is made once at startup and tests
/// can pin it; the command layer writes it from the stored setting.
#[cfg(target_os = "macos")]
fn mac_keychain_choice() -> super::mac_keychain::MacKeychain {
    super::mac_keychain::MacKeychain::parse(
        &std::env::var("CRISPDECK_MACOS_KEYCHAIN").unwrap_or_default(),
    )
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
impl SecretStore for OsSecretStore {
    fn set(&self, _key: &str, _secret: &str) -> Result<()> {
        Err(anyhow!("no OS secret store wired up for this platform"))
    }
    fn get(&self, _key: &str) -> Result<String> {
        Err(anyhow!("no OS secret store wired up for this platform"))
    }
    fn delete(&self, _key: &str) -> Result<()> {
        Ok(())
    }
}

/// Is an OS secret store compiled in at all?
///
/// Distinct from whether it *works* — a Linux build has one compiled in and
/// may still have no session bus to talk to. The UI wants both: whether to
/// offer the choice, and what actually happened when a credential was written.
pub const fn os_store_compiled_in() -> bool {
    cfg!(any(target_os = "linux", target_os = "windows", target_os = "macos"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// A stand-in for the OS store. Not a substitute for running against a
    /// real Keychain — a way to check the dispatch, the fallback and the
    /// migration, which is where the bugs would otherwise hide.
    struct FakeStore {
        items: RefCell<HashMap<String, String>>,
        available: bool,
    }

    impl FakeStore {
        fn working() -> Self {
            FakeStore { items: RefCell::new(HashMap::new()), available: true }
        }
        /// A headless Linux box: no secret service to talk to.
        fn unavailable() -> Self {
            FakeStore { items: RefCell::new(HashMap::new()), available: false }
        }
    }

    impl SecretStore for FakeStore {
        fn set(&self, key: &str, secret: &str) -> Result<()> {
            if !self.available {
                return Err(anyhow!("no secret service"));
            }
            self.items.borrow_mut().insert(key.to_string(), secret.to_string());
            Ok(())
        }
        fn get(&self, key: &str) -> Result<String> {
            if !self.available {
                return Err(anyhow!("no secret service"));
            }
            self.items
                .borrow()
                .get(key)
                .cloned()
                .ok_or_else(|| anyhow!("not found"))
        }
        fn delete(&self, key: &str) -> Result<()> {
            self.items.borrow_mut().remove(key);
            Ok(())
        }
    }

    const SECRET: &str = r#"{"app_password":"xxxx-yyyy-zzzz"}"#;

    #[test]
    fn keychain_keeps_the_secret_out_of_the_database() {
        let store_ = FakeStore::working();
        let (column, used) = store(Backend::Keychain, &store_, "bluesky", "a.test", SECRET).unwrap();

        assert_eq!(used, Backend::Keychain);
        assert!(is_keychain_ref(&column));
        // The whole point: the column holds a reference, not the secret.
        assert!(!column.contains("xxxx-yyyy-zzzz"));
        assert!(!column.contains("app_password"));
    }

    #[test]
    fn keychain_round_trips() {
        let store_ = FakeStore::working();
        let (column, _) = store(Backend::Keychain, &store_, "bluesky", "a.test", SECRET).unwrap();
        assert_eq!(load(&store_, &column).unwrap(), SECRET);
    }

    #[test]
    fn local_round_trips() {
        let store_ = FakeStore::working();
        let (column, used) = store(Backend::Local, &store_, "bluesky", "a.test", SECRET).unwrap();

        assert_eq!(used, Backend::Local);
        assert!(!is_keychain_ref(&column));
        assert_eq!(load(&store_, &column).unwrap(), SECRET);
    }

    #[test]
    fn a_row_written_before_any_of_this_still_reads() {
        // The migration story: existing rows hold a bare AES blob with no
        // prefix, and nothing runs to convert them.
        let legacy = credentials::encrypt(SECRET).unwrap();
        let store_ = FakeStore::working();
        assert_eq!(load(&store_, &legacy).unwrap(), SECRET);
    }

    #[test]
    fn switching_backend_does_not_strand_existing_rows() {
        // load dispatches on what it finds, not on the current preference.
        let store_ = FakeStore::working();
        let (keychain_row, _) = store(Backend::Keychain, &store_, "bluesky", "one.test", "one").unwrap();
        let (local_row, _) = store(Backend::Local, &store_, "mastodon", "two.test", "two").unwrap();

        assert_eq!(load(&store_, &keychain_row).unwrap(), "one");
        assert_eq!(load(&store_, &local_row).unwrap(), "two");
    }

    #[test]
    fn falls_back_when_there_is_no_secret_service() {
        // Headless Linux. Refusing to start would be worse than the weaker
        // store, but the caller has to know which it got.
        let store_ = FakeStore::unavailable();
        let (column, used) = store(Backend::Keychain, &store_, "bluesky", "a.test", SECRET).unwrap();

        assert_eq!(used, Backend::Local, "must report what it actually used");
        assert!(!is_keychain_ref(&column));
        assert_eq!(load(&store_, &column).unwrap(), SECRET);
    }

    #[test]
    fn a_missing_keychain_entry_is_an_error_not_an_empty_secret() {
        // Someone cleared their keychain. Returning "" would look like a
        // valid empty credential and fail much further away.
        let store_ = FakeStore::working();
        let result = load(&store_, "keychain:v1:bluesky:missing.test");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing.test"));
    }

    #[test]
    fn forget_removes_a_keychain_entry() {
        let store_ = FakeStore::working();
        let (column, _) = store(Backend::Keychain, &store_, "bluesky", "a.test", SECRET).unwrap();

        forget(&store_, &column).unwrap();
        assert!(load(&store_, &column).is_err(), "entry should be gone");
    }

    #[test]
    fn forget_on_a_local_row_does_nothing_and_succeeds() {
        // The blob goes with the row; there is nothing else to clean up.
        let store_ = FakeStore::working();
        let (column, _) = store(Backend::Local, &store_, "bluesky", "a.test", SECRET).unwrap();
        assert!(forget(&store_, &column).is_ok());
    }

    #[test]
    fn each_account_gets_its_own_key() {
        assert_ne!(key_for("bluesky", "a.test"), key_for("mastodon", "a.test"));
        assert_ne!(key_for("bluesky", "a.test"), key_for("bluesky", "b.test"));
        assert!(key_for("bluesky", "a.test").contains("a.test"));
    }

    #[test]
    fn two_accounts_do_not_overwrite_each_other() {
        let store_ = FakeStore::working();
        let (a, _) = store(Backend::Keychain, &store_, "bluesky", "first.test", "first").unwrap();
        let (b, _) = store(Backend::Keychain, &store_, "bluesky", "second.test", "second").unwrap();

        assert_eq!(load(&store_, &a).unwrap(), "first");
        assert_eq!(load(&store_, &b).unwrap(), "second");
    }

    #[test]
    fn the_platform_flag_matches_the_build() {
        // Guards the cfg list against drifting from the Cargo.toml targets.
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        assert!(os_store_compiled_in());
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        assert!(!os_store_compiled_in(), "macOS is deliberately not wired up yet");
    }

    /// Against the real OS store, not the fake one.
    ///
    /// Off by default: a developer machine may have a locked keychain, and a
    /// test that prompts for a password is a test that hangs. CI sets
    /// CRISPDECK_REAL_KEYCHAIN after preparing a store it owns — a temporary
    /// keychain on macOS, a gnome-keyring session on Linux, and on Windows
    /// the runner's own Credential Manager, which needs no preparation.
    ///
    /// This is the part the fake store cannot stand in for: whether the
    /// platform actually accepts what we write and hands it back.
    mod real_store {
        use super::*;

        fn enabled() -> bool {
            std::env::var("CRISPDECK_REAL_KEYCHAIN").is_ok()
        }

        /// Is there a store to talk to on this platform?
        ///
        /// macOS has none compiled in yet, so the round-trip tests below
        /// cannot pass there, and asserting that they should was simply
        /// wrong — the first CI run failed on exactly that, with "no OS
        /// secret store wired up for this platform". What macOS needs
        /// checking for is the other half: that the fallback works on the
        /// platform that actually depends on it.
        fn has_store() -> bool {
            enabled() && os_store_compiled_in()
        }

        /// A key nothing else uses, so a failed run cannot poison a later one.
        fn scratch_key() -> String {
            format!(
                "test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            )
        }

        #[test]
        fn the_real_store_round_trips() {
            if !has_store() {
                eprintln!("skipped: no OS store compiled in, or CRISPDECK_REAL_KEYCHAIN unset");
                return;
            }
            let store = OsSecretStore;
            let key = scratch_key();
            let secret = r#"{"app_password":"real-store-round-trip"}"#;

            store.set(&key, secret).expect("write to the OS store");
            let read = store.get(&key).expect("read it back");
            assert_eq!(read, secret);

            store.delete(&key).expect("clean up");
            assert!(store.get(&key).is_err(), "entry should be gone after delete");
        }

        #[test]
        fn the_real_store_keeps_entries_apart() {
            if !has_store() {
                return;
            }
            let store = OsSecretStore;
            let (a, b) = (scratch_key(), scratch_key());

            store.set(&a, "first").unwrap();
            store.set(&b, "second").unwrap();
            assert_eq!(store.get(&a).unwrap(), "first");
            assert_eq!(store.get(&b).unwrap(), "second");

            store.delete(&a).unwrap();
            store.delete(&b).unwrap();
        }

        #[test]
        fn deleting_something_absent_is_not_an_error() {
            // forget() runs on every account deletion, including ones whose
            // secret was never in the OS store.
            if !has_store() {
                return;
            }
            assert!(OsSecretStore.delete(&scratch_key()).is_ok());
        }

        /// The macOS case, and any future platform without a backend.
        ///
        /// Falling back is the documented behaviour, so it deserves testing
        /// on the platform that relies on it rather than only against a fake.
        #[test]
        fn without_an_os_store_it_falls_back_and_still_works() {
            if !enabled() || os_store_compiled_in() {
                return;
            }
            let secret = r#"{"token":"fallback-path"}"#;
            let (column, used) =
                store(Backend::Keychain, &OsSecretStore, "bluesky", &scratch_key(), secret)
                    .expect("falling back must not be an error");

            assert_eq!(used, Backend::Local, "must report the backend it actually used");
            assert!(!is_keychain_ref(&column));
            assert_eq!(load(&OsSecretStore, &column).unwrap(), secret);

            // forget() runs on every account deletion; with no store to talk
            // to it must still succeed rather than block the delete.
            assert!(forget(&OsSecretStore, &column).is_ok());
        }

        #[test]
        fn store_and_load_work_end_to_end_against_the_real_store() {
            // The layer the app actually calls, not just the trait beneath it.
            if !has_store() {
                return;
            }
            let handle = scratch_key();
            let secret = r#"{"token":"end-to-end"}"#;

            let (column, used) =
                store(Backend::Keychain, &OsSecretStore, "bluesky", &handle, secret).unwrap();
            assert_eq!(used, Backend::Keychain, "a prepared store should not fall back");
            assert!(is_keychain_ref(&column));
            assert!(!column.contains("end-to-end"), "the secret must not be in the column");

            assert_eq!(load(&OsSecretStore, &column).unwrap(), secret);
            forget(&OsSecretStore, &column).unwrap();
        }
    }

    #[test]
    fn backend_names_round_trip() {
        for b in [Backend::Keychain, Backend::Local] {
            assert_eq!(Backend::parse(b.as_str()), b);
        }
        // Anything unrecognised is the safe, always-available one.
        assert_eq!(Backend::parse("nonsense"), Backend::Local);
    }
}
