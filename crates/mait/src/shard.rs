//! Trait shard definitions and composition.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const STRANDS_AVATAR_V1: &str = "strands-avatar-v1";

/// Portable MAIT manifest used by Kasai and CharacterStudio bridges.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MaitManifest {
    pub id: String,
    pub schema: String,
    pub display_name: String,
    pub version: u32,
    #[serde(default)]
    pub source: Option<ManifestSource>,
    #[serde(default)]
    pub aesthetic_shards: Vec<AestheticShard>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

impl MaitManifest {
    pub fn new(display_name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            schema: "mait-manifest-v1".into(),
            display_name: display_name.into(),
            version: 1,
            source: None,
            aesthetic_shards: Vec::new(),
            metadata: BTreeMap::new(),
        }
    }

    pub fn from_strands_avatar_value(value: Value) -> Result<Self> {
        let schema = string_at(
            &value,
            &[
                &["schema"],
                &["schema_version"],
                &["format"],
                &["avatar", "schema"],
            ],
        );
        if let Some(schema) = schema.as_deref() {
            if schema != STRANDS_AVATAR_V1 {
                return Err(anyhow!(
                    "unsupported strands avatar schema '{}', expected '{}'",
                    schema,
                    STRANDS_AVATAR_V1
                ));
            }
        }

        let id = string_at(
            &value,
            &[
                &["id"],
                &["avatar_id"],
                &["avatar", "id"],
                &["metadata", "id"],
            ],
        )
        .unwrap_or_else(|| Uuid::new_v4().to_string());
        let display_name = string_at(
            &value,
            &[
                &["display_name"],
                &["name"],
                &["avatar", "display_name"],
                &["avatar", "name"],
            ],
        )
        .unwrap_or_else(|| "Strands Avatar".into());

        let mut metadata = BTreeMap::new();
        metadata.insert(
            "imported_schema".into(),
            Value::String(STRANDS_AVATAR_V1.into()),
        );
        if let Some(author) = string_at(&value, &[&["author"], &["metadata", "author"]]) {
            metadata.insert("author".into(), Value::String(author));
        }
        if let Some(notes) = string_at(&value, &[&["notes"], &["metadata", "notes"]]) {
            metadata.insert("notes".into(), Value::String(notes));
        }

        let mut aesthetic_shards = Vec::new();
        aesthetic_shards.push(AestheticShard::StrandsAvatar {
            id: format!("{id}:avatar"),
            avatar_id: id.clone(),
            name: display_name.clone(),
            vrm_path: string_at(
                &value,
                &[
                    &["vrm_path"],
                    &["model_path"],
                    &["avatar", "vrm_path"],
                    &["assets", "vrm"],
                ],
            )
            .map(PathBuf::from),
            preview_image: string_at(
                &value,
                &[
                    &["preview_image"],
                    &["thumbnail"],
                    &["avatar", "preview_image"],
                    &["assets", "preview"],
                ],
            )
            .map(PathBuf::from),
            traits: traits_from_value(&value),
        });

        if let Some(colors) = palette_from_value(&value) {
            aesthetic_shards.push(AestheticShard::Palette {
                id: format!("{id}:palette"),
                name: "avatar palette".into(),
                colors,
            });
        }

        if let Some(prompt) = string_at(
            &value,
            &[&["style_prompt"], &["prompt"], &["aesthetic", "prompt"]],
        ) {
            aesthetic_shards.push(AestheticShard::StylePrompt {
                id: format!("{id}:style-prompt"),
                prompt,
                negative_prompt: string_at(
                    &value,
                    &[&["negative_prompt"], &["aesthetic", "negative_prompt"]],
                ),
            });
        }

        Ok(Self {
            id,
            schema: "mait-manifest-v1".into(),
            display_name,
            version: 1,
            source: Some(ManifestSource {
                schema: STRANDS_AVATAR_V1.into(),
                path: None,
            }),
            aesthetic_shards,
            metadata,
        })
    }

    pub fn from_strands_avatar_str(input: &str) -> Result<Self> {
        let value: Value =
            serde_json::from_str(input).context("failed to parse strands-avatar-v1 JSON")?;
        Self::from_strands_avatar_value(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestSource {
    pub schema: String,
    #[serde(default)]
    pub path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AestheticShard {
    StrandsAvatar {
        id: String,
        avatar_id: String,
        name: String,
        #[serde(default)]
        vrm_path: Option<PathBuf>,
        #[serde(default)]
        preview_image: Option<PathBuf>,
        #[serde(default)]
        traits: BTreeMap<String, Value>,
    },
    Palette {
        id: String,
        name: String,
        colors: Vec<String>,
    },
    StylePrompt {
        id: String,
        prompt: String,
        #[serde(default)]
        negative_prompt: Option<String>,
    },
    AssetRef {
        id: String,
        role: String,
        path: PathBuf,
        #[serde(default)]
        mime: Option<String>,
    },
    Custom {
        id: String,
        label: String,
        data: Value,
    },
}

impl AestheticShard {
    pub fn id(&self) -> &str {
        match self {
            Self::StrandsAvatar { id, .. }
            | Self::Palette { id, .. }
            | Self::StylePrompt { id, .. }
            | Self::AssetRef { id, .. }
            | Self::Custom { id, .. } => id,
        }
    }
}

/// File-backed CRUD store for MAIT manifests.
#[derive(Debug, Clone)]
pub struct MaitStore {
    root: PathBuf,
}

impl MaitStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.root)
            .with_context(|| format!("failed to create MAIT store {}", self.root.display()))
    }

    pub fn create(&self, manifest: &MaitManifest) -> Result<()> {
        self.init()?;
        let path = self.path_for(&manifest.id);
        if path.exists() {
            return Err(anyhow!("MAIT manifest '{}' already exists", manifest.id));
        }
        self.write_manifest(manifest)
    }

    pub fn update(&self, manifest: &MaitManifest) -> Result<()> {
        self.init()?;
        let path = self.path_for(&manifest.id);
        if !path.exists() {
            return Err(anyhow!("MAIT manifest '{}' does not exist", manifest.id));
        }
        self.write_manifest(manifest)
    }

    pub fn upsert(&self, manifest: &MaitManifest) -> Result<()> {
        self.init()?;
        self.write_manifest(manifest)
    }

    pub fn read(&self, id: &str) -> Result<MaitManifest> {
        let path = self.path_for(id);
        let input = fs::read_to_string(&path)
            .with_context(|| format!("failed to read MAIT manifest {}", path.display()))?;
        serde_json::from_str(&input)
            .with_context(|| format!("failed to parse MAIT manifest {}", path.display()))
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        let path = self.path_for(id);
        if !path.exists() {
            return Ok(false);
        }
        fs::remove_file(&path)
            .with_context(|| format!("failed to delete MAIT manifest {}", path.display()))?;
        Ok(true)
    }

    pub fn list(&self) -> Result<Vec<MaitManifest>> {
        self.init()?;
        let mut manifests: Vec<MaitManifest> = Vec::new();
        for entry in fs::read_dir(&self.root)
            .with_context(|| format!("failed to list MAIT store {}", self.root.display()))?
        {
            let entry = entry?;
            if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let input = fs::read_to_string(entry.path())?;
            manifests.push(serde_json::from_str(&input)?);
        }
        manifests.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        Ok(manifests)
    }

    pub fn import_strands_avatar_file(&self, path: impl AsRef<Path>) -> Result<MaitManifest> {
        let path = path.as_ref();
        let input = fs::read_to_string(path)
            .with_context(|| format!("failed to read strands avatar {}", path.display()))?;
        let mut manifest = MaitManifest::from_strands_avatar_str(&input)?;
        if let Some(source) = manifest.source.as_mut() {
            source.path = Some(path.to_path_buf());
        }
        self.upsert(&manifest)?;
        Ok(manifest)
    }

    fn write_manifest(&self, manifest: &MaitManifest) -> Result<()> {
        let path = self.path_for(&manifest.id);
        let json = serde_json::to_string_pretty(manifest)?;
        fs::write(&path, json)
            .with_context(|| format!("failed to write MAIT manifest {}", path.display()))
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.root.join(format!("{}.json", sanitize_id(id)))
    }
}

pub fn deserialize_strands_avatar_v1(input: &str) -> Result<MaitManifest> {
    MaitManifest::from_strands_avatar_str(input)
}

fn string_at(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for part in *path {
            current = current.get(*part)?;
        }
        current.as_str().map(ToOwned::to_owned)
    })
}

fn traits_from_value(value: &Value) -> BTreeMap<String, Value> {
    let mut traits = BTreeMap::new();
    for key in [
        "traits",
        "trait_composition",
        "traitComposition",
        "aesthetic_traits",
    ] {
        if let Some(Value::Object(map)) = value.get(key) {
            merge_object(&mut traits, map);
        }
        if let Some(Value::Object(map)) = value.get("avatar").and_then(|avatar| avatar.get(key)) {
            merge_object(&mut traits, map);
        }
    }
    traits
}

fn merge_object(target: &mut BTreeMap<String, Value>, source: &Map<String, Value>) {
    for (key, value) in source {
        target.insert(key.clone(), value.clone());
    }
}

fn palette_from_value(value: &Value) -> Option<Vec<String>> {
    if let Some(Value::Array(colors)) = value.get("colors") {
        let colors: Vec<_> = colors
            .iter()
            .filter_map(|color| color.as_str().map(ToOwned::to_owned))
            .collect();
        if !colors.is_empty() {
            return Some(colors);
        }
    }

    let palette = value
        .get("palette")
        .or_else(|| value.pointer("/aesthetic/palette"))?;
    match palette {
        Value::Array(colors) => {
            let colors: Vec<_> = colors
                .iter()
                .filter_map(|color| color.as_str().map(ToOwned::to_owned))
                .collect();
            (!colors.is_empty()).then_some(colors)
        }
        Value::Object(map) => {
            let colors: Vec<_> = map
                .values()
                .filter_map(|color| color.as_str().map(ToOwned::to_owned))
                .collect();
            (!colors.is_empty()).then_some(colors)
        }
        _ => None,
    }
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_strands_avatar_v1() {
        let manifest = deserialize_strands_avatar_v1(
            r##"{
                "schema": "strands-avatar-v1",
                "id": "hero-01",
                "name": "Hero One",
                "vrm_path": "avatars/hero.vrm",
                "preview_image": "avatars/hero.png",
                "traits": { "warmth": 0.9, "style": "cinematic" },
                "palette": { "primary": "#ffffff", "accent": "#ff0066" },
                "style_prompt": "sharp editorial lighting"
            }"##,
        )
        .unwrap();

        assert_eq!(manifest.id, "hero-01");
        assert_eq!(manifest.display_name, "Hero One");
        assert_eq!(manifest.aesthetic_shards.len(), 3);
        assert_eq!(manifest.aesthetic_shards[0].id(), "hero-01:avatar");
    }

    #[test]
    fn store_crud_roundtrip() {
        let root = std::env::temp_dir().join(format!("mait-test-{}", Uuid::new_v4()));
        let store = MaitStore::new(&root);
        let mut manifest = MaitManifest::new("Test Agent");
        manifest.id = "test-agent".into();

        store.create(&manifest).unwrap();
        assert_eq!(store.read("test-agent").unwrap().display_name, "Test Agent");

        manifest.display_name = "Updated Agent".into();
        store.update(&manifest).unwrap();
        assert_eq!(store.list().unwrap()[0].display_name, "Updated Agent");
        assert!(store.delete("test-agent").unwrap());
        assert!(!store.delete("test-agent").unwrap());

        let _ = fs::remove_dir_all(root);
    }
}
