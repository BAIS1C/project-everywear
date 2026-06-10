fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let resources_dir = std::path::Path::new(&manifest_dir).join("resources");
    if let Err(error) = std::fs::create_dir_all(&resources_dir) {
        panic!(
            "failed to create generated Tauri resources directory {}: {error}",
            resources_dir.display()
        );
    }
    tauri_build::build();
}
