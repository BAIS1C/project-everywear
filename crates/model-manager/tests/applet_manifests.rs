use model_manager::AppletManifest;
use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("model-manager crate should live under crates/model-manager")
        .to_path_buf()
}

#[test]
fn applet_manifests_parse_with_canonical_schema() {
    let applets_dir = workspace_root().join("applets");
    let entries = std::fs::read_dir(&applets_dir)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", applets_dir.display()));

    let mut checked = Vec::new();

    for entry in entries.flatten() {
        let manifest_path = entry.path().join("applet.toml");
        if !manifest_path.is_file() {
            continue;
        }

        let manifest = AppletManifest::load(&manifest_path).unwrap_or_else(|err| {
            panic!("{} failed canonical parse: {err}", manifest_path.display())
        });
        checked.push(manifest.applet.id);
    }

    checked.sort();
    assert_eq!(
        checked,
        vec![
            "1magen",
            "3nvizen",
            "character-studio",
            "gener8",
            "kasai",
            "loom",
            "vid",
        ]
    );
}

#[test]
fn frontend_only_manifests_are_zero_model_web_manifests() {
    let root = workspace_root();

    for applet_id in ["character-studio", "loom", "vid"] {
        let manifest_path = root.join("applets").join(applet_id).join("applet.toml");
        let manifest = AppletManifest::load(&manifest_path).unwrap_or_else(|err| {
            panic!("{} failed canonical parse: {err}", manifest_path.display())
        });

        assert_eq!(manifest.applet.id, applet_id);
        assert_eq!(manifest.applet.transport, "web");
        assert_eq!(manifest.engine.engine_type, "none");
        assert_eq!(manifest.engine.backend, "none");
        assert!(
            manifest.model_groups.is_empty(),
            "{applet_id} should not declare local model groups"
        );
    }
}

#[test]
fn qa_provisioning_seed_is_excluded_from_release_manifests() {
    let manifest_path = workspace_root()
        .join("applets")
        .join("kasai")
        .join("applet.toml");
    let manifest = AppletManifest::load(&manifest_path)
        .unwrap_or_else(|err| panic!("{} failed canonical parse: {err}", manifest_path.display()));
    let seeds = manifest.qa_provisioning_models();

    let (_, seed) = seeds
        .iter()
        .find(|(_, seed)| seed.key == "qa-tiny-random-llama-q2k")
        .expect("kasai applet should carry the Lane 5 QA provisioning seed");

    assert!(seed.qa_only);
    assert!(seed.release_manifest_excluded);
    assert_eq!(
        seed.sha256.as_deref(),
        Some("17b638445eb0272abd5c524b69c8cf84dcf23b20142db309595218b93a4424e7")
    );
    assert_eq!(seed.size_bytes, Some(7_581_728));
}
