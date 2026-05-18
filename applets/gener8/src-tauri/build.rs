use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=sidecar/whisper-align");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("sidecar").join("whisper-align");
    if !source.exists() {
        return;
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };
    let target = profile_dir
        .join("resources")
        .join("sidecar")
        .join("whisper-align");

    if let Err(error) = copy_dir_clean(&source, &target) {
        panic!(
            "failed to package whisper-align sidecar from {} to {}: {error}",
            source.display(),
            target.display()
        );
    }
}

fn copy_dir_clean(source: &Path, target: &Path) -> io::Result<()> {
    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    fs::create_dir_all(target)?;
    copy_dir(source, target)
}

fn copy_dir(source: &Path, target: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            fs::create_dir_all(&destination)?;
            copy_dir(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}
