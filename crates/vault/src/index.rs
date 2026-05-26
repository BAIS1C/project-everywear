//! Tantivy index management for generated media in the Everywear Vault.

use crate::schema::{
    build_audio_schema, build_image_schema, build_video_schema, AudioDocument, AudioFields,
    ImageDocument, ImageFields, VaultItem, VideoDocument, VideoFields,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tantivy::collector::TopDocs;
use tantivy::query::{AllQuery, Query, QueryParser, TermQuery};
use tantivy::schema::{Field, OwnedValue, Schema, TantivyDocument, Value};
use tantivy::{Index, Term};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaFilter {
    All,
    Images,
    Audio,
    AudioKind(String),
    Videos,
    Stems,
    Favorites,
    Applet(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Newest,
    Oldest,
    Title,
    Size,
    Duration,
}

#[derive(Clone)]
pub struct VaultIndex {
    images_index: Index,
    audio_index: Index,
    video_index: Index,
    vault_root: PathBuf,
    image_schema: Schema,
    audio_schema: Schema,
    video_schema: Schema,
    image_fields: ImageFields,
    audio_fields: AudioFields,
    video_fields: VideoFields,
}

impl VaultIndex {
    pub fn open_or_create(vault_index_dir: impl AsRef<Path>) -> Result<Self> {
        let vault_index_dir = vault_index_dir.as_ref();
        let vault_root = vault_index_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| vault_index_dir.to_path_buf());
        fs::create_dir_all(vault_index_dir).with_context(|| {
            format!(
                "failed to create vault index dir {}",
                vault_index_dir.display()
            )
        })?;

        let (image_schema, image_fields) = build_image_schema();
        let (audio_schema, audio_fields) = build_audio_schema();
        let (video_schema, video_fields) = build_video_schema();

        let images_index = open_named_index(vault_index_dir, "images", image_schema.clone())?;
        let audio_index = open_named_index(vault_index_dir, "audio", audio_schema.clone())?;
        let video_index = open_named_index(vault_index_dir, "video", video_schema.clone())?;

        Ok(Self {
            images_index,
            audio_index,
            video_index,
            vault_root,
            image_schema,
            audio_schema,
            video_schema,
            image_fields,
            audio_fields,
            video_fields,
        })
    }

    pub fn index_image(&self, doc: &ImageDocument) -> Result<()> {
        let tantivy_doc = image_to_tantivy(&self.image_schema, doc)?;
        replace_document(
            &self.images_index,
            self.image_fields.id,
            &doc.id,
            tantivy_doc,
        )
    }

    pub fn index_audio(&self, doc: &AudioDocument) -> Result<()> {
        let tantivy_doc = audio_to_tantivy(&self.audio_schema, doc)?;
        replace_document(
            &self.audio_index,
            self.audio_fields.id,
            &doc.id,
            tantivy_doc,
        )
    }

    pub fn delete_audio_documents_by_file_path(
        &self,
        file_path: &str,
        except_id: Option<&str>,
    ) -> Result<usize> {
        let target = normalize_path_key(file_path);
        if target.is_empty() {
            return Ok(0);
        }
        let ids = self
            .stats_items()?
            .into_iter()
            .filter_map(|item| match item {
                VaultItem::Audio(doc)
                    if normalize_path_key(&doc.file_path) == target
                        && except_id.is_none_or(|keep| keep != doc.id) =>
                {
                    Some(doc.id)
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        for id in &ids {
            delete_from_index(&self.audio_index, self.audio_fields.id, id)?;
        }
        Ok(ids.len())
    }

    pub fn index_video(&self, doc: &VideoDocument) -> Result<()> {
        let tantivy_doc = video_to_tantivy(&self.video_schema, doc)?;
        replace_document(
            &self.video_index,
            self.video_fields.id,
            &doc.id,
            tantivy_doc,
        )
    }

    pub fn search(
        &self,
        query: &str,
        media_filter: Option<MediaFilter>,
        sort_by: SortField,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<VaultItem>> {
        let mut items =
            self.search_all_matching(query, media_filter.unwrap_or(MediaFilter::All))?;
        sort_items(&mut items, sort_by);
        dedupe_items(&mut items);
        Ok(items.into_iter().skip(offset).take(limit).collect())
    }

    pub fn search_total(&self, query: &str, media_filter: Option<MediaFilter>) -> Result<usize> {
        let mut items =
            self.search_all_matching(query, media_filter.unwrap_or(MediaFilter::All))?;
        dedupe_items(&mut items);
        Ok(items.len())
    }

    pub fn get_by_id(&self, id: &str) -> Result<Option<VaultItem>> {
        if let Some(doc) = find_one(&self.images_index, self.image_fields.id, id, |doc| {
            self.image_from_tantivy(doc)
        })? {
            return Ok(Some(VaultItem::Image(doc)));
        }
        if let Some(doc) = find_one(&self.audio_index, self.audio_fields.id, id, |doc| {
            self.audio_from_tantivy(doc)
        })? {
            return Ok(Some(VaultItem::Audio(doc)));
        }
        if let Some(doc) = find_one(&self.video_index, self.video_fields.id, id, |doc| {
            self.video_from_tantivy(doc)
        })? {
            return Ok(Some(VaultItem::Video(doc)));
        }
        Ok(None)
    }

    pub fn update_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        match self.get_by_id(id)? {
            Some(VaultItem::Image(mut doc)) => {
                doc.favorite = favorite;
                self.index_image(&doc)
            }
            Some(VaultItem::Audio(mut doc)) => {
                doc.favorite = favorite;
                self.index_audio(&doc)
            }
            Some(VaultItem::Video(mut doc)) => {
                doc.favorite = favorite;
                self.index_video(&doc)
            }
            None => Ok(()),
        }
    }

    pub fn update_tags(&self, id: &str, tags: Vec<String>) -> Result<()> {
        match self.get_by_id(id)? {
            Some(VaultItem::Image(mut doc)) => {
                doc.tags = tags;
                self.index_image(&doc)
            }
            Some(VaultItem::Audio(mut doc)) => {
                doc.tags = tags;
                self.index_audio(&doc)
            }
            Some(VaultItem::Video(mut doc)) => {
                doc.tags = tags;
                self.index_video(&doc)
            }
            None => Ok(()),
        }
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let Some(item) = self.get_by_id(id)? else {
            return Ok(());
        };

        match &item {
            VaultItem::Image(_) => delete_from_index(&self.images_index, self.image_fields.id, id)?,
            VaultItem::Audio(_) => delete_from_index(&self.audio_index, self.audio_fields.id, id)?,
            VaultItem::Video(_) => delete_from_index(&self.video_index, self.video_fields.id, id)?,
        };

        let (file_path, media_root) = match item {
            VaultItem::Image(doc) => (PathBuf::from(doc.file_path), self.vault_root.join("Images")),
            VaultItem::Audio(doc) => {
                let root = if doc.is_stem {
                    self.vault_root.join("Audio").join("Stems")
                } else {
                    self.vault_root.join("Audio")
                };
                (PathBuf::from(doc.file_path), root)
            }
            VaultItem::Video(doc) => (PathBuf::from(doc.file_path), self.vault_root.join("Videos")),
        };
        remove_file_and_empty_parents(&file_path, &media_root)?;
        Ok(())
    }

    pub fn stats_items(&self) -> Result<Vec<VaultItem>> {
        self.search_all_matching("", MediaFilter::All)
    }

    fn search_all_matching(&self, query: &str, filter: MediaFilter) -> Result<Vec<VaultItem>> {
        let mut items = Vec::new();
        let include_images = matches!(
            filter,
            MediaFilter::All
                | MediaFilter::Images
                | MediaFilter::Favorites
                | MediaFilter::Applet(_)
        );
        let include_audio = matches!(
            filter,
            MediaFilter::All
                | MediaFilter::Audio
                | MediaFilter::Stems
                | MediaFilter::Favorites
                | MediaFilter::Applet(_)
        );
        let include_video = matches!(
            filter,
            MediaFilter::All
                | MediaFilter::Videos
                | MediaFilter::Favorites
                | MediaFilter::Applet(_)
        );

        if include_images {
            items.extend(
                search_index(
                    &self.images_index,
                    query,
                    vec![
                        self.image_fields.title,
                        self.image_fields.prompt,
                        self.image_fields.tags,
                    ],
                    |doc| self.image_from_tantivy(doc).map(VaultItem::Image),
                )?
                .into_iter()
                .filter(|item| item_matches_filter(item, &filter)),
            );
        }
        if include_audio {
            items.extend(
                search_index(
                    &self.audio_index,
                    query,
                    vec![
                        self.audio_fields.title,
                        self.audio_fields.lyrics_text,
                        self.audio_fields.tags,
                    ],
                    |doc| self.audio_from_tantivy(doc).map(VaultItem::Audio),
                )?
                .into_iter()
                .filter(|item| item_matches_filter(item, &filter)),
            );
        }
        if include_video {
            items.extend(
                search_index(
                    &self.video_index,
                    query,
                    vec![
                        self.video_fields.title,
                        self.video_fields.prompt,
                        self.video_fields.tags,
                    ],
                    |doc| self.video_from_tantivy(doc).map(VaultItem::Video),
                )?
                .into_iter()
                .filter(|item| item_matches_filter(item, &filter)),
            );
        }
        Ok(items)
    }

    fn image_from_tantivy(&self, doc: &TantivyDocument) -> Result<ImageDocument> {
        Ok(ImageDocument {
            id: text_value(doc, self.image_fields.id).unwrap_or_default(),
            applet_id: text_value(doc, self.image_fields.applet_id).unwrap_or_default(),
            title: text_value(doc, self.image_fields.title).unwrap_or_default(),
            tags: tags_value(doc, self.image_fields.tags),
            created_at: u64_value(doc, self.image_fields.created_at),
            updated_at: u64_value(doc, self.image_fields.updated_at),
            file_path: text_value(doc, self.image_fields.file_path).unwrap_or_default(),
            file_size_bytes: u64_value(doc, self.image_fields.file_size_bytes),
            mime_type: text_value(doc, self.image_fields.mime_type).unwrap_or_default(),
            favorite: bool_value(doc, self.image_fields.favorite),
            width: u64_value(doc, self.image_fields.width),
            height: u64_value(doc, self.image_fields.height),
            model_id: text_value(doc, self.image_fields.model_id),
            generation_params: json_value(doc, self.image_fields.generation_params),
            prompt: text_value(doc, self.image_fields.prompt),
        })
    }

    fn audio_from_tantivy(&self, doc: &TantivyDocument) -> Result<AudioDocument> {
        let mut audio = AudioDocument {
            id: text_value(doc, self.audio_fields.id).unwrap_or_default(),
            applet_id: text_value(doc, self.audio_fields.applet_id).unwrap_or_default(),
            title: text_value(doc, self.audio_fields.title).unwrap_or_default(),
            tags: tags_value(doc, self.audio_fields.tags),
            created_at: u64_value(doc, self.audio_fields.created_at),
            updated_at: u64_value(doc, self.audio_fields.updated_at),
            file_path: text_value(doc, self.audio_fields.file_path).unwrap_or_default(),
            file_size_bytes: u64_value(doc, self.audio_fields.file_size_bytes),
            mime_type: text_value(doc, self.audio_fields.mime_type).unwrap_or_default(),
            favorite: bool_value(doc, self.audio_fields.favorite),
            duration_seconds: f64_value(doc, self.audio_fields.duration_seconds),
            sample_rate: u64_value(doc, self.audio_fields.sample_rate),
            channels: u64_value(doc, self.audio_fields.channels),
            genre: text_value(doc, self.audio_fields.genre),
            bpm: optional_u64_value(doc, self.audio_fields.bpm),
            key_signature: text_value(doc, self.audio_fields.key_signature),
            is_stem: bool_value(doc, self.audio_fields.is_stem),
            stem_type: text_value(doc, self.audio_fields.stem_type),
            lyrics_aligned: bool_value(doc, self.audio_fields.lyrics_aligned),
            lyrics_text: text_value(doc, self.audio_fields.lyrics_text),
            asset_kind: None,
        };
        audio.asset_kind = Some(audio_asset_kind(&audio).to_string());
        Ok(audio)
    }

    fn video_from_tantivy(&self, doc: &TantivyDocument) -> Result<VideoDocument> {
        Ok(VideoDocument {
            id: text_value(doc, self.video_fields.id).unwrap_or_default(),
            applet_id: text_value(doc, self.video_fields.applet_id).unwrap_or_default(),
            title: text_value(doc, self.video_fields.title).unwrap_or_default(),
            tags: tags_value(doc, self.video_fields.tags),
            created_at: u64_value(doc, self.video_fields.created_at),
            updated_at: u64_value(doc, self.video_fields.updated_at),
            file_path: text_value(doc, self.video_fields.file_path).unwrap_or_default(),
            file_size_bytes: u64_value(doc, self.video_fields.file_size_bytes),
            mime_type: text_value(doc, self.video_fields.mime_type).unwrap_or_default(),
            favorite: bool_value(doc, self.video_fields.favorite),
            duration_seconds: f64_value(doc, self.video_fields.duration_seconds),
            width: u64_value(doc, self.video_fields.width),
            height: u64_value(doc, self.video_fields.height),
            frame_rate: f64_value(doc, self.video_fields.frame_rate),
            model_id: text_value(doc, self.video_fields.model_id),
            generation_mode: text_value(doc, self.video_fields.generation_mode),
            prompt: text_value(doc, self.video_fields.prompt),
            has_audio: bool_value(doc, self.video_fields.has_audio),
        })
    }
}

fn open_named_index(root: &Path, name: &str, schema: Schema) -> Result<Index> {
    let path = root.join(name);
    fs::create_dir_all(&path)
        .with_context(|| format!("failed to create vault {name} index {}", path.display()))?;
    match Index::open_in_dir(&path) {
        Ok(index) => Ok(index),
        Err(_) => Index::create_in_dir(&path, schema)
            .with_context(|| format!("failed to create vault {name} index {}", path.display())),
    }
}

fn replace_document(index: &Index, id_field: Field, id: &str, doc: TantivyDocument) -> Result<()> {
    let mut writer = index.writer::<TantivyDocument>(50_000_000)?;
    writer.delete_term(Term::from_field_text(id_field, id));
    writer.add_document(doc)?;
    commit_with_windows_retry(&mut writer)?;
    Ok(())
}

fn delete_from_index(index: &Index, id_field: Field, id: &str) -> Result<()> {
    let mut writer = index.writer::<TantivyDocument>(50_000_000)?;
    writer.delete_term(Term::from_field_text(id_field, id));
    commit_with_windows_retry(&mut writer)?;
    Ok(())
}

fn normalize_path_key(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn commit_with_windows_retry(writer: &mut tantivy::IndexWriter<TantivyDocument>) -> Result<()> {
    for attempt in 0..3 {
        match writer.commit() {
            Ok(_) => return Ok(()),
            Err(err) if attempt < 2 && is_transient_windows_index_error(&err) => {
                thread::sleep(Duration::from_millis(150 * (attempt + 1) as u64));
            }
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

fn is_transient_windows_index_error(error: &tantivy::TantivyError) -> bool {
    let message = error.to_string();
    message.contains("Access is denied")
        || message.contains("os error 5")
        || message.contains("OpenWriteError")
}

fn search_index<T>(
    index: &Index,
    query_text: &str,
    searchable_fields: Vec<Field>,
    from_doc: impl Fn(&TantivyDocument) -> Result<T>,
) -> Result<Vec<T>> {
    let reader = index.reader()?;
    let searcher = reader.searcher();
    let boxed_query: Box<dyn Query> = if query_text.trim().is_empty() {
        Box::new(AllQuery)
    } else {
        Box::new(
            QueryParser::for_index(index, searchable_fields)
                .parse_query(query_text)
                .with_context(|| format!("failed to parse vault query '{query_text}'"))?,
        )
    };

    let docs = searcher.search(boxed_query.as_ref(), &TopDocs::with_limit(10_000))?;
    let mut items = Vec::with_capacity(docs.len());
    for (_, address) in docs {
        let doc = searcher.doc::<TantivyDocument>(address)?;
        items.push(from_doc(&doc)?);
    }
    Ok(items)
}

fn find_one<T>(
    index: &Index,
    id_field: Field,
    id: &str,
    from_doc: impl Fn(&TantivyDocument) -> Result<T>,
) -> Result<Option<T>> {
    let reader = index.reader()?;
    let searcher = reader.searcher();
    let query = TermQuery::new(
        Term::from_field_text(id_field, id),
        tantivy::schema::IndexRecordOption::Basic,
    );
    let docs = searcher.search(&query, &TopDocs::with_limit(1))?;
    if let Some((_, address)) = docs.into_iter().next() {
        let doc = searcher.doc::<TantivyDocument>(address)?;
        return Ok(Some(from_doc(&doc)?));
    }
    Ok(None)
}

fn image_to_tantivy(schema: &Schema, doc: &ImageDocument) -> Result<TantivyDocument> {
    let mut value = serde_json::to_value(doc)?;
    if let serde_json::Value::Object(map) = &mut value {
        remove_nulls(map);
        return TantivyDocument::from_json_object(schema, map.clone()).map_err(Into::into);
    }
    unreachable!("document structs serialize to objects")
}

fn audio_to_tantivy(schema: &Schema, doc: &AudioDocument) -> Result<TantivyDocument> {
    let mut value = serde_json::to_value(doc)?;
    if let serde_json::Value::Object(map) = &mut value {
        remove_nulls(map);
        map.remove("asset_kind");
        return TantivyDocument::from_json_object(schema, map.clone()).map_err(Into::into);
    }
    unreachable!("document structs serialize to objects")
}

fn video_to_tantivy(schema: &Schema, doc: &VideoDocument) -> Result<TantivyDocument> {
    let mut value = serde_json::to_value(doc)?;
    if let serde_json::Value::Object(map) = &mut value {
        remove_nulls(map);
        return TantivyDocument::from_json_object(schema, map.clone()).map_err(Into::into);
    }
    unreachable!("document structs serialize to objects")
}

fn remove_nulls(map: &mut serde_json::Map<String, serde_json::Value>) {
    map.retain(|_, value| !value.is_null());
}

fn text_value(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn tags_value(doc: &TantivyDocument, field: Field) -> Vec<String> {
    doc.get_all(field)
        .filter_map(|value| value.as_str())
        .flat_map(|tags| tags.split_whitespace().map(ToOwned::to_owned))
        .collect()
}

fn u64_value(doc: &TantivyDocument, field: Field) -> u64 {
    doc.get_first(field)
        .and_then(|value| value.as_i64())
        .unwrap_or_default()
        .max(0) as u64
}

fn optional_u64_value(doc: &TantivyDocument, field: Field) -> Option<u64> {
    doc.get_first(field)
        .and_then(|value| value.as_i64())
        .map(|value| value.max(0) as u64)
}

fn f64_value(doc: &TantivyDocument, field: Field) -> f64 {
    doc.get_first(field)
        .and_then(|value| value.as_f64())
        .unwrap_or_default()
}

fn bool_value(doc: &TantivyDocument, field: Field) -> bool {
    doc.get_first(field)
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn json_value(doc: &TantivyDocument, field: Field) -> Option<serde_json::Value> {
    doc.get_first(field).map(owned_value_to_json)
}

fn owned_value_to_json(value: &OwnedValue) -> serde_json::Value {
    match value {
        OwnedValue::Null => serde_json::Value::Null,
        OwnedValue::Str(value) => serde_json::Value::String(value.clone()),
        OwnedValue::U64(value) => serde_json::Value::Number((*value).into()),
        OwnedValue::I64(value) => serde_json::Value::Number((*value).into()),
        OwnedValue::F64(value) => serde_json::Number::from_f64(*value)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        OwnedValue::Bool(value) => serde_json::Value::Bool(*value),
        OwnedValue::Array(values) => {
            serde_json::Value::Array(values.iter().map(owned_value_to_json).collect())
        }
        OwnedValue::Object(object) => serde_json::Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), owned_value_to_json(value)))
                .collect(),
        ),
        _ => serde_json::Value::Null,
    }
}

fn item_matches_filter(item: &VaultItem, filter: &MediaFilter) -> bool {
    match filter {
        MediaFilter::All => true,
        MediaFilter::Images => matches!(item, VaultItem::Image(_)),
        MediaFilter::Audio => matches!(item, VaultItem::Audio(_)),
        MediaFilter::AudioKind(kind) => matches!(
            item,
            VaultItem::Audio(doc) if audio_asset_kind(doc) == kind.as_str()
        ),
        MediaFilter::Videos => matches!(item, VaultItem::Video(_)),
        MediaFilter::Stems => matches!(item, VaultItem::Audio(doc) if doc.is_stem),
        MediaFilter::Favorites => item_favorite(item),
        MediaFilter::Applet(applet_id) => item_applet_id(item) == applet_id,
    }
}

pub fn audio_asset_kind(doc: &AudioDocument) -> &str {
    if doc.is_stem {
        return "stem";
    }
    if let Some(kind) = inferred_legacy_gener8_asset_kind(doc) {
        return kind;
    }
    if let Some(kind) = doc.asset_kind.as_deref().filter(|kind| !kind.is_empty()) {
        return kind;
    }
    if let Some(kind) = doc
        .tags
        .iter()
        .find_map(|tag| tag.strip_prefix("asset:").filter(|kind| !kind.is_empty()))
    {
        return kind;
    }
    if doc.applet_id == "gener8" {
        return "gener8_song";
    }
    "local_audio"
}

fn inferred_legacy_gener8_asset_kind(doc: &AudioDocument) -> Option<&'static str> {
    if doc.applet_id != "gener8" {
        return None;
    }
    let legacy_indexed = doc
        .tags
        .iter()
        .any(|tag| matches!(tag.as_str(), "legacy-import" | "vault-repair"));
    if !legacy_indexed {
        return None;
    }
    let haystack = format!("{} {}", doc.title, doc.file_path).to_ascii_lowercase();
    if haystack.contains("(reference)")
        || haystack.contains("_reference")
        || haystack.contains("-reference")
    {
        return Some("reference");
    }
    if haystack.contains("(cover source)")
        || haystack.contains("_cover_source")
        || haystack.contains("-cover-source")
    {
        return Some("cover_source");
    }
    if haystack.contains("extract track_") {
        return Some("stem");
    }
    None
}

fn dedupe_items(items: &mut Vec<VaultItem>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item_id(item).to_string()));
}

fn sort_items(items: &mut [VaultItem], sort_by: SortField) {
    items.sort_by(|a, b| match sort_by {
        SortField::Newest => item_created_at(b).cmp(&item_created_at(a)),
        SortField::Oldest => item_created_at(a).cmp(&item_created_at(b)),
        SortField::Title => item_title(a).cmp(item_title(b)),
        SortField::Size => item_file_size(b).cmp(&item_file_size(a)),
        SortField::Duration => item_duration(b)
            .partial_cmp(&item_duration(a))
            .unwrap_or(Ordering::Equal),
    });
}

pub fn item_id(item: &VaultItem) -> &str {
    match item {
        VaultItem::Image(doc) => &doc.id,
        VaultItem::Audio(doc) => &doc.id,
        VaultItem::Video(doc) => &doc.id,
    }
}

pub fn item_title(item: &VaultItem) -> &str {
    match item {
        VaultItem::Image(doc) => &doc.title,
        VaultItem::Audio(doc) => &doc.title,
        VaultItem::Video(doc) => &doc.title,
    }
}

pub fn item_applet_id(item: &VaultItem) -> &str {
    match item {
        VaultItem::Image(doc) => &doc.applet_id,
        VaultItem::Audio(doc) => &doc.applet_id,
        VaultItem::Video(doc) => &doc.applet_id,
    }
}

pub fn item_created_at(item: &VaultItem) -> u64 {
    match item {
        VaultItem::Image(doc) => doc.created_at,
        VaultItem::Audio(doc) => doc.created_at,
        VaultItem::Video(doc) => doc.created_at,
    }
}

pub fn item_file_size(item: &VaultItem) -> u64 {
    match item {
        VaultItem::Image(doc) => doc.file_size_bytes,
        VaultItem::Audio(doc) => doc.file_size_bytes,
        VaultItem::Video(doc) => doc.file_size_bytes,
    }
}

pub fn item_favorite(item: &VaultItem) -> bool {
    match item {
        VaultItem::Image(doc) => doc.favorite,
        VaultItem::Audio(doc) => doc.favorite,
        VaultItem::Video(doc) => doc.favorite,
    }
}

pub fn item_duration(item: &VaultItem) -> f64 {
    match item {
        VaultItem::Image(_) => 0.0,
        VaultItem::Audio(doc) => doc.duration_seconds,
        VaultItem::Video(doc) => doc.duration_seconds,
    }
}

fn remove_file_and_empty_parents(file_path: &Path, media_root: &Path) -> Result<()> {
    if file_path.exists() {
        fs::remove_file(file_path)
            .with_context(|| format!("failed to delete vault file {}", file_path.display()))?;
    }

    let mut current = file_path.parent();
    while let Some(dir) = current {
        if dir == media_root || !dir.starts_with(media_root) {
            break;
        }
        if fs::read_dir(dir)?.next().is_none() {
            fs::remove_dir(dir)?;
            current = dir.parent();
        } else {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_index() -> (PathBuf, VaultIndex) {
        let root = std::env::temp_dir().join(format!("vault-test-{}", Uuid::new_v4()));
        let index = VaultIndex::open_or_create(&root).unwrap();
        (root, index)
    }

    fn image_doc(title: &str) -> ImageDocument {
        ImageDocument {
            id: Uuid::new_v4().to_string(),
            applet_id: "1magen".into(),
            title: title.into(),
            tags: vec!["test".into(), "portrait".into()],
            created_at: 10,
            updated_at: 10,
            file_path: "C:/tmp/test.png".into(),
            file_size_bytes: 100,
            mime_type: "image/png".into(),
            width: 256,
            height: 256,
            prompt: Some("bright test portrait".into()),
            ..Default::default()
        }
    }

    #[test]
    fn creates_three_indexes() {
        let (root, _index) = temp_index();
        assert!(root.join("images").exists());
        assert!(root.join("audio").exists());
        assert!(root.join("video").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn indexes_and_searches_images() {
        let (root, index) = temp_index();
        let doc = image_doc("Test Image");
        index.index_image(&doc).unwrap();

        let hits = index
            .search(
                "portrait",
                Some(MediaFilter::Images),
                SortField::Newest,
                10,
                0,
            )
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(item_id(&hits[0]), doc.id);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn updates_favorites_and_filters() {
        let (root, index) = temp_index();
        let doc = image_doc("Favorite Image");
        index.index_image(&doc).unwrap();
        index.update_favorite(&doc.id, true).unwrap();

        let hits = index
            .search("", Some(MediaFilter::Favorites), SortField::Newest, 10, 0)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(item_favorite(&hits[0]));

        let _ = fs::remove_dir_all(root);
    }
}
