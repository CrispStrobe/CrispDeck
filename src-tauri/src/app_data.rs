//! Keep database files and the explicit local credential backend private to
//! this OS user. SQLite also creates journals/WAL files beside the database,
//! so protecting just the main database file would leave the others exposed.

use std::io;
use std::path::Path;

pub fn prepare_directory(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_app_data_and_preserves_existing_contents() {
        let path = std::env::temp_dir().join(format!("crispdeck-app-data-{}", rand::random::<u64>()));
        prepare_directory(&path).unwrap();
        std::fs::write(path.join("saved-data"), b"keep").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Existing installations can have inherited a permissive umask.
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        prepare_directory(&path).unwrap();
        assert_eq!(std::fs::read(path.join("saved-data")).unwrap(), b"keep");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
        }
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn filesystem_failures_are_reported_before_opening_the_database() {
        let parent = std::env::temp_dir().join(format!("crispdeck-app-data-file-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&parent).unwrap();
        let path = parent.join("not-a-directory");
        std::fs::write(&path, b"not a directory").unwrap();
        assert!(prepare_directory(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a directory");
        std::fs::remove_dir_all(parent).unwrap();
    }
}
