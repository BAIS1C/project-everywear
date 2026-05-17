//! DAW project data model.
//!
//! Ported unchanged from S3 Studio.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Unique identifier for tracks, regions, automation points.
pub type Id = String;

fn default_tempo() -> f64 {
    120.0
}
fn default_time_sig() -> [u32; 2] {
    [4, 4]
}
fn default_sample_rate() -> u32 {
    48_000
}

/// Top-level DAW project.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DawProject {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_tempo")]
    pub tempo_bpm: f64,
    #[serde(default = "default_time_sig")]
    pub time_signature: [u32; 2],
    #[serde(default = "default_sample_rate")]
    pub sample_rate: u32,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub tempo_automation: Vec<AutomationPoint>,
    #[serde(default)]
    pub loop_range: Option<LoopRange>,
    #[serde(default)]
    pub generation_history: Vec<String>,
}

fn default_version() -> u32 {
    1
}

impl DawProject {
    pub fn new() -> Self {
        Self {
            version: 1,
            name: String::from("Untitled"),
            tempo_bpm: 120.0,
            time_signature: [4, 4],
            sample_rate: 48_000,
            tracks: Vec::new(),
            tempo_automation: Vec::new(),
            loop_range: None,
            generation_history: Vec::new(),
        }
    }

    pub fn add_track(&mut self, name: String, color: String) -> Id {
        let id = uuid_v4();
        self.tracks.push(Track {
            id: id.clone(),
            name,
            color,
            volume_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
            regions: Vec::new(),
            automation: Vec::new(),
        });
        id
    }

    pub fn remove_track(&mut self, track_id: &str) -> bool {
        let len = self.tracks.len();
        self.tracks.retain(|t| t.id != track_id);
        self.tracks.len() < len
    }

    pub fn find_track(&self, track_id: &str) -> Option<&Track> {
        self.tracks.iter().find(|t| t.id == track_id)
    }

    pub fn find_track_mut(&mut self, track_id: &str) -> Option<&mut Track> {
        self.tracks.iter_mut().find(|t| t.id == track_id)
    }

    pub fn find_region(&self, region_id: &str) -> Option<(&Track, &Region)> {
        for track in &self.tracks {
            if let Some(region) = track.regions.iter().find(|r| r.id == region_id) {
                return Some((track, region));
            }
        }
        None
    }

    pub fn find_region_mut(&mut self, region_id: &str) -> Option<&mut Region> {
        for track in &mut self.tracks {
            if let Some(region) = track.regions.iter_mut().find(|r| r.id == region_id) {
                return Some(region);
            }
        }
        None
    }
}

/// A single track in the arrangement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Track {
    pub id: Id,
    pub name: String,
    pub color: String,
    pub volume_db: f64,
    pub pan: f64,
    pub mute: bool,
    pub solo: bool,
    pub regions: Vec<Region>,
    #[serde(default)]
    pub automation: Vec<AutomationLane>,
}

/// An audio region placed on the timeline.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Region {
    pub id: Id,
    pub audio_ref: String,
    #[serde(skip)]
    pub resolved_path: Option<PathBuf>,
    pub position_ms: u64,
    #[serde(default)]
    pub start_offset_ms: u64,
    pub end_offset_ms: u64,
    #[serde(default)]
    pub fade_in_ms: u64,
    #[serde(default)]
    pub fade_out_ms: u64,
    #[serde(default = "default_fade_curve")]
    pub fade_curve: FadeCurve,
    #[serde(default)]
    pub generation_dna: Option<String>,
}

impl Region {
    pub fn duration_ms(&self) -> u64 {
        self.end_offset_ms.saturating_sub(self.start_offset_ms)
    }

    pub fn end_position_ms(&self) -> u64 {
        self.position_ms + self.duration_ms()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FadeCurve {
    Linear,
    Exponential,
    SCurve,
}

fn default_fade_curve() -> FadeCurve {
    FadeCurve::Linear
}

/// An automation lane on a track.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AutomationLane {
    pub param: String,
    pub points: Vec<AutomationPoint>,
}

/// A single automation breakpoint.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AutomationPoint {
    pub time_ms: u64,
    pub value: f64,
}

/// Loop boundaries.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopRange {
    pub start_ms: u64,
    pub end_ms: u64,
    pub enabled: bool,
}

/// Simple v4 UUID generator using random bytes.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tid = std::thread::current().id();
    let hash = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        nanos.hash(&mut h);
        tid.hash(&mut h);
        h.finish()
    };
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (nanos & 0xFFFF_FFFF) as u32,
        ((nanos >> 32) & 0xFFFF) as u16,
        (hash & 0x0FFF) as u16,
        (0x8000 | (hash >> 12) & 0x3FFF) as u16,
        (hash >> 26) & 0xFFFF_FFFF_FFFF,
    )
}
