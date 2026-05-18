//! Media document schemas for the Everywear Vault.

use serde::{Deserialize, Serialize};
use tantivy::schema::{Field, Schema, FAST, INDEXED, STORED, STRING, TEXT};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldType {
    StringField,
    TextField,
    Int64Field,
    FloatField,
    BoolField,
    StoredField,
    JsonField,
}

use FieldType::*;

// Base fields shared by all media types.
pub const COMMON_FIELDS: &[(&str, FieldType)] = &[
    ("id", StringField),
    ("applet_id", StringField),
    ("title", TextField),
    ("tags", StringField),
    ("created_at", Int64Field),
    ("updated_at", Int64Field),
    ("file_path", StoredField),
    ("file_size_bytes", Int64Field),
    ("mime_type", StringField),
    ("favorite", BoolField),
];

pub const IMAGE_FIELDS: &[(&str, FieldType)] = &[
    ("width", Int64Field),
    ("height", Int64Field),
    ("model_id", StringField),
    ("generation_params", JsonField),
    ("prompt", TextField),
];

pub const AUDIO_FIELDS: &[(&str, FieldType)] = &[
    ("duration_seconds", FloatField),
    ("sample_rate", Int64Field),
    ("channels", Int64Field),
    ("genre", StringField),
    ("bpm", Int64Field),
    ("key_signature", StringField),
    ("is_stem", BoolField),
    ("stem_type", StringField),
    ("lyrics_aligned", BoolField),
    ("lyrics_text", TextField),
];

pub const VIDEO_FIELDS: &[(&str, FieldType)] = &[
    ("duration_seconds", FloatField),
    ("width", Int64Field),
    ("height", Int64Field),
    ("frame_rate", FloatField),
    ("model_id", StringField),
    ("generation_mode", StringField),
    ("prompt", TextField),
    ("has_audio", BoolField),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "media_type", rename_all = "snake_case")]
pub enum VaultItem {
    Image(ImageDocument),
    Audio(AudioDocument),
    Video(VideoDocument),
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageDocument {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub applet_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub file_size_bytes: u64,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub width: u64,
    #[serde(default)]
    pub height: u64,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub generation_params: Option<serde_json::Value>,
    #[serde(default)]
    pub prompt: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioDocument {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub applet_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub file_size_bytes: u64,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub duration_seconds: f64,
    #[serde(default)]
    pub sample_rate: u64,
    #[serde(default)]
    pub channels: u64,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub bpm: Option<u64>,
    #[serde(default)]
    pub key_signature: Option<String>,
    #[serde(default)]
    pub is_stem: bool,
    #[serde(default)]
    pub stem_type: Option<String>,
    #[serde(default)]
    pub lyrics_aligned: bool,
    #[serde(default)]
    pub lyrics_text: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoDocument {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub applet_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub file_size_bytes: u64,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub duration_seconds: f64,
    #[serde(default)]
    pub width: u64,
    #[serde(default)]
    pub height: u64,
    #[serde(default)]
    pub frame_rate: f64,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub generation_mode: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub has_audio: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct ImageFields {
    pub id: Field,
    pub applet_id: Field,
    pub title: Field,
    pub tags: Field,
    pub created_at: Field,
    pub updated_at: Field,
    pub file_path: Field,
    pub file_size_bytes: Field,
    pub mime_type: Field,
    pub favorite: Field,
    pub width: Field,
    pub height: Field,
    pub model_id: Field,
    pub generation_params: Field,
    pub prompt: Field,
}

#[derive(Debug, Clone, Copy)]
pub struct AudioFields {
    pub id: Field,
    pub applet_id: Field,
    pub title: Field,
    pub tags: Field,
    pub created_at: Field,
    pub updated_at: Field,
    pub file_path: Field,
    pub file_size_bytes: Field,
    pub mime_type: Field,
    pub favorite: Field,
    pub duration_seconds: Field,
    pub sample_rate: Field,
    pub channels: Field,
    pub genre: Field,
    pub bpm: Field,
    pub key_signature: Field,
    pub is_stem: Field,
    pub stem_type: Field,
    pub lyrics_aligned: Field,
    pub lyrics_text: Field,
}

#[derive(Debug, Clone, Copy)]
pub struct VideoFields {
    pub id: Field,
    pub applet_id: Field,
    pub title: Field,
    pub tags: Field,
    pub created_at: Field,
    pub updated_at: Field,
    pub file_path: Field,
    pub file_size_bytes: Field,
    pub mime_type: Field,
    pub favorite: Field,
    pub duration_seconds: Field,
    pub width: Field,
    pub height: Field,
    pub frame_rate: Field,
    pub model_id: Field,
    pub generation_mode: Field,
    pub prompt: Field,
    pub has_audio: Field,
}

pub fn build_image_schema() -> (Schema, ImageFields) {
    let mut builder = Schema::builder();
    let common = add_common_fields(&mut builder);
    let width = add_field(&mut builder, "width", Int64Field);
    let height = add_field(&mut builder, "height", Int64Field);
    let model_id = add_field(&mut builder, "model_id", StringField);
    let generation_params = add_field(&mut builder, "generation_params", JsonField);
    let prompt = add_field(&mut builder, "prompt", TextField);
    let schema = builder.build();
    (
        schema,
        ImageFields {
            id: common.id,
            applet_id: common.applet_id,
            title: common.title,
            tags: common.tags,
            created_at: common.created_at,
            updated_at: common.updated_at,
            file_path: common.file_path,
            file_size_bytes: common.file_size_bytes,
            mime_type: common.mime_type,
            favorite: common.favorite,
            width,
            height,
            model_id,
            generation_params,
            prompt,
        },
    )
}

pub fn build_audio_schema() -> (Schema, AudioFields) {
    let mut builder = Schema::builder();
    let common = add_common_fields(&mut builder);
    let duration_seconds = add_field(&mut builder, "duration_seconds", FloatField);
    let sample_rate = add_field(&mut builder, "sample_rate", Int64Field);
    let channels = add_field(&mut builder, "channels", Int64Field);
    let genre = add_field(&mut builder, "genre", StringField);
    let bpm = add_field(&mut builder, "bpm", Int64Field);
    let key_signature = add_field(&mut builder, "key_signature", StringField);
    let is_stem = add_field(&mut builder, "is_stem", BoolField);
    let stem_type = add_field(&mut builder, "stem_type", StringField);
    let lyrics_aligned = add_field(&mut builder, "lyrics_aligned", BoolField);
    let lyrics_text = add_field(&mut builder, "lyrics_text", TextField);
    let schema = builder.build();
    (
        schema,
        AudioFields {
            id: common.id,
            applet_id: common.applet_id,
            title: common.title,
            tags: common.tags,
            created_at: common.created_at,
            updated_at: common.updated_at,
            file_path: common.file_path,
            file_size_bytes: common.file_size_bytes,
            mime_type: common.mime_type,
            favorite: common.favorite,
            duration_seconds,
            sample_rate,
            channels,
            genre,
            bpm,
            key_signature,
            is_stem,
            stem_type,
            lyrics_aligned,
            lyrics_text,
        },
    )
}

pub fn build_video_schema() -> (Schema, VideoFields) {
    let mut builder = Schema::builder();
    let common = add_common_fields(&mut builder);
    let duration_seconds = add_field(&mut builder, "duration_seconds", FloatField);
    let width = add_field(&mut builder, "width", Int64Field);
    let height = add_field(&mut builder, "height", Int64Field);
    let frame_rate = add_field(&mut builder, "frame_rate", FloatField);
    let model_id = add_field(&mut builder, "model_id", StringField);
    let generation_mode = add_field(&mut builder, "generation_mode", StringField);
    let prompt = add_field(&mut builder, "prompt", TextField);
    let has_audio = add_field(&mut builder, "has_audio", BoolField);
    let schema = builder.build();
    (
        schema,
        VideoFields {
            id: common.id,
            applet_id: common.applet_id,
            title: common.title,
            tags: common.tags,
            created_at: common.created_at,
            updated_at: common.updated_at,
            file_path: common.file_path,
            file_size_bytes: common.file_size_bytes,
            mime_type: common.mime_type,
            favorite: common.favorite,
            duration_seconds,
            width,
            height,
            frame_rate,
            model_id,
            generation_mode,
            prompt,
            has_audio,
        },
    )
}

#[derive(Debug, Clone, Copy)]
struct CommonFields {
    id: Field,
    applet_id: Field,
    title: Field,
    tags: Field,
    created_at: Field,
    updated_at: Field,
    file_path: Field,
    file_size_bytes: Field,
    mime_type: Field,
    favorite: Field,
}

fn add_common_fields(builder: &mut tantivy::schema::SchemaBuilder) -> CommonFields {
    CommonFields {
        id: add_field(builder, "id", StringField),
        applet_id: add_field(builder, "applet_id", StringField),
        title: add_field(builder, "title", TextField),
        tags: add_field(builder, "tags", StringField),
        created_at: add_field(builder, "created_at", Int64Field),
        updated_at: add_field(builder, "updated_at", Int64Field),
        file_path: add_field(builder, "file_path", StoredField),
        file_size_bytes: add_field(builder, "file_size_bytes", Int64Field),
        mime_type: add_field(builder, "mime_type", StringField),
        favorite: add_field(builder, "favorite", BoolField),
    }
}

fn add_field(
    builder: &mut tantivy::schema::SchemaBuilder,
    name: &str,
    field_type: FieldType,
) -> Field {
    match field_type {
        StringField => builder.add_text_field(name, STRING | STORED),
        TextField => builder.add_text_field(name, TEXT | STORED),
        Int64Field => builder.add_i64_field(name, INDEXED | FAST | STORED),
        FloatField => builder.add_f64_field(name, INDEXED | FAST | STORED),
        BoolField => builder.add_bool_field(name, INDEXED | FAST | STORED),
        StoredField => builder.add_text_field(name, STORED),
        JsonField => builder.add_json_field(name, STORED | TEXT),
    }
}
