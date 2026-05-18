//! Gener8 DAW Engine: GPU-first audio timeline for stem editing.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - No Tauri dependency; no AppHandle, no invoke() IPC
//!   - Commands are plain methods on DawEngine (called by shim routes)
//!   - beats::BeatsCache import path: crate::beats (not crate::beats)

pub mod commands;
pub mod mixer;
pub mod playback;
pub mod project;
pub mod transport;
pub mod waveform;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::beats;
pub use project::{DawProject, Region, Track};
pub use transport::{LoopRange, TransportState};

/// Handle to a running DAW engine instance. Held in `AppState` behind
/// `Arc<Mutex<Option<DawEngine>>>` for load-on-demand lifecycle.
pub struct DawEngine {
    project: DawProject,
    transport: TransportState,
    /// Decoded audio cache: audio_path -> mono f32 samples + sample rate.
    decode_cache: HashMap<PathBuf, Arc<DecodedAudio>>,
    /// Waveform peak cache: (audio_path, width_px, start_ms, end_ms) -> peaks.
    peak_cache: HashMap<PeakCacheKey, Vec<(f32, f32)>>,
    /// Shared beats cache from the main app.
    beats_cache: Arc<beats::BeatsCache>,
    /// Playback handle. `None` when paused/stopped; `Some` when playing.
    playback_handle: Option<playback::PlaybackHandle>,
    /// Undo stack: serialised project snapshots.
    undo_stack: Vec<String>,
    /// Redo stack: serialised project snapshots.
    redo_stack: Vec<String>,
}

/// Decoded audio buffer for a single file.
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_ms: u64,
}

#[derive(Clone, Hash, Eq, PartialEq)]
struct PeakCacheKey {
    path: PathBuf,
    width_px: u32,
    start_ms: u64,
    end_ms: u64,
}

impl DawEngine {
    /// Create a new engine with an empty project.
    pub fn new(beats_cache: Arc<beats::BeatsCache>) -> Self {
        Self {
            project: DawProject::new(),
            transport: TransportState::new(),
            decode_cache: HashMap::new(),
            peak_cache: HashMap::new(),
            beats_cache,
            playback_handle: None,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    /// Create an engine and load a project from disk.
    pub fn with_project(project: DawProject, beats_cache: Arc<beats::BeatsCache>) -> Self {
        Self {
            project,
            transport: TransportState::new(),
            decode_cache: HashMap::new(),
            peak_cache: HashMap::new(),
            beats_cache,
            playback_handle: None,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn project(&self) -> &DawProject {
        &self.project
    }
    pub fn project_mut(&mut self) -> &mut DawProject {
        &mut self.project
    }
    pub fn transport(&self) -> &TransportState {
        &self.transport
    }
    pub fn transport_mut(&mut self) -> &mut TransportState {
        &mut self.transport
    }

    /// Snapshot the current project state for undo. Call before any mutation.
    pub fn push_undo(&mut self) {
        if let Ok(json) = serde_json::to_string(&self.project) {
            self.undo_stack.push(json);
            self.redo_stack.clear();
        }
    }

    /// Revert to the previous project state.
    pub fn undo(&mut self) -> bool {
        if let Some(snapshot) = self.undo_stack.pop() {
            if let Ok(current) = serde_json::to_string(&self.project) {
                self.redo_stack.push(current);
            }
            if let Ok(restored) = serde_json::from_str(&snapshot) {
                self.project = restored;
                self.peak_cache.clear();
                return true;
            }
        }
        false
    }

    /// Re-apply a previously undone change.
    pub fn redo(&mut self) -> bool {
        if let Some(snapshot) = self.redo_stack.pop() {
            if let Ok(current) = serde_json::to_string(&self.project) {
                self.undo_stack.push(current);
            }
            if let Ok(restored) = serde_json::from_str(&snapshot) {
                self.project = restored;
                self.peak_cache.clear();
                return true;
            }
        }
        false
    }

    /// Decode an audio file and cache the result.
    pub fn decode_audio(&mut self, path: &PathBuf) -> anyhow::Result<Arc<DecodedAudio>> {
        if let Some(cached) = self.decode_cache.get(path) {
            return Ok(cached.clone());
        }
        let decoded = waveform::decode_audio_file(path)?;
        let arc = Arc::new(decoded);
        self.decode_cache.insert(path.clone(), arc.clone());
        Ok(arc)
    }

    /// Compute waveform peaks for display.
    pub fn get_waveform_peaks(
        &mut self,
        path: &PathBuf,
        width_px: u32,
        start_ms: u64,
        end_ms: u64,
    ) -> anyhow::Result<Vec<(f32, f32)>> {
        let key = PeakCacheKey {
            path: path.clone(),
            width_px,
            start_ms,
            end_ms,
        };
        if let Some(cached) = self.peak_cache.get(&key) {
            return Ok(cached.clone());
        }
        let audio = self.decode_audio(path)?;
        let peaks = waveform::compute_peaks(&audio, width_px, start_ms, end_ms);
        self.peak_cache.insert(key, peaks.clone());
        Ok(peaks)
    }

    /// Stop playback and release the audio device.
    pub fn stop_playback(&mut self) {
        self.playback_handle = None;
        self.transport.stop();
    }

    /// Start playback through the system output device.
    pub fn start_playback(&mut self) -> anyhow::Result<()> {
        self.playback_handle = None;
        let handle = playback::PlaybackHandle::start(
            self.project.tracks.clone(),
            self.decode_cache.clone(),
            self.transport.position_ms(),
            self.transport.loop_range.clone(),
        )?;
        self.playback_handle = Some(handle);
        self.transport.play();
        Ok(())
    }

    pub fn pause_playback(&mut self) {
        self.playback_handle = None;
        self.transport.pause();
    }

    /// Flush all caches (decode, peaks).
    pub fn flush_caches(&mut self) {
        self.decode_cache.clear();
        self.peak_cache.clear();
    }
}
