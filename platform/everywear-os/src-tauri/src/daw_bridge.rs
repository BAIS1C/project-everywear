use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DawRegion {
    pub id: String,
    pub audio_ref: String,
    pub position_ms: u64,
    pub start_offset_ms: u64,
    pub end_offset_ms: u64,
    pub fade_in_ms: u64,
    pub fade_out_ms: u64,
    pub fade_curve: String,
    pub generation_dna: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DawTrack {
    pub id: String,
    pub name: String,
    pub color: String,
    pub volume_db: f64,
    pub pan: f64,
    pub mute: bool,
    pub solo: bool,
    pub regions: Vec<DawRegion>,
    pub automation: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopRange {
    pub start_ms: u64,
    pub end_ms: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DawProject {
    pub version: u32,
    pub name: String,
    pub tempo_bpm: f64,
    pub time_signature: [u32; 2],
    pub sample_rate: u32,
    pub tracks: Vec<DawTrack>,
    pub loop_range: Option<LoopRange>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DawPosition {
    pub position_ms: u64,
    pub bar: u64,
    pub beat: u64,
    pub tick: u64,
    pub mode: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportMode {
    Stopped,
    Playing,
    Paused,
}

pub struct DawBridgeState {
    project: DawProject,
    mode: TransportMode,
    anchor_position_ms: u64,
    started_at: Option<Instant>,
    track_counter: u64,
    region_counter: u64,
    history: Vec<DawProject>,
    redo: Vec<DawProject>,
}

impl Default for DawBridgeState {
    fn default() -> Self {
        Self {
            project: DawProject {
                version: 1,
                name: "Everywear DAW Session".to_string(),
                tempo_bpm: 120.0,
                time_signature: [4, 4],
                sample_rate: 48_000,
                tracks: Vec::new(),
                loop_range: None,
            },
            mode: TransportMode::Stopped,
            anchor_position_ms: 0,
            started_at: None,
            track_counter: 0,
            region_counter: 0,
            history: Vec::new(),
            redo: Vec::new(),
        }
    }
}

impl DawBridgeState {
    pub fn handle(&mut self, endpoint: &str, body: Option<Value>) -> Result<Value, String> {
        let (path, query) = split_endpoint(endpoint);
        match path {
            "/init" => Ok(Value::Null),
            "/destroy" => {
                self.stop_transport();
                Ok(Value::Null)
            }
            "/project" => Ok(json!(self.project)),
            "/position" => Ok(json!(self.position())),
            "/import-stem-urls" => self.import_stem_urls(body.unwrap_or(Value::Null)),
            "/import-stems" => self.import_stems(body.unwrap_or(Value::Null)),
            "/play" => {
                self.mode = TransportMode::Playing;
                self.started_at = Some(Instant::now());
                Ok(json!(self.position()))
            }
            "/pause" => {
                self.anchor_position_ms = self.current_position_ms();
                self.mode = TransportMode::Paused;
                self.started_at = None;
                Ok(json!(self.position()))
            }
            "/stop" => {
                self.stop_transport();
                Ok(Value::Null)
            }
            "/seek" => {
                self.anchor_position_ms = body_u64(&body, "position_ms", 0);
                self.started_at = if self.mode == TransportMode::Playing {
                    Some(Instant::now())
                } else {
                    None
                };
                Ok(Value::Null)
            }
            "/set-tempo" => {
                let bpm = body_f64(&body, "bpm", self.project.tempo_bpm);
                if bpm.is_finite() && bpm > 0.0 {
                    self.snapshot();
                    self.project.tempo_bpm = bpm;
                }
                Ok(Value::Null)
            }
            "/set-loop" => {
                self.snapshot();
                self.project.loop_range = Some(LoopRange {
                    start_ms: body_u64(&body, "start_ms", 0),
                    end_ms: body_u64(&body, "end_ms", 0),
                    enabled: body_bool(&body, "enabled", false),
                });
                Ok(Value::Null)
            }
            "/set-metronome" => Ok(Value::Null),
            "/add-track" => self.add_track(body.unwrap_or(Value::Null)),
            "/remove-track" => {
                let track_id = body_string(&body, "track_id")?;
                self.snapshot();
                self.project.tracks.retain(|track| track.id != track_id);
                Ok(Value::Null)
            }
            "/add-region" => self.add_region(body.unwrap_or(Value::Null)),
            "/move-region" => self.move_region(body.unwrap_or(Value::Null)),
            "/resize-region" => self.resize_region(body.unwrap_or(Value::Null)),
            "/split-region" => self.split_region(body.unwrap_or(Value::Null)),
            "/delete-region" => {
                let region_id = body_string(&body, "region_id")?;
                self.snapshot();
                for track in &mut self.project.tracks {
                    track.regions.retain(|region| region.id != region_id);
                }
                Ok(Value::Null)
            }
            "/set-fade" => self.set_fade(body.unwrap_or(Value::Null)),
            "/waveform-peaks" => self.waveform_peaks(query),
            "/set-track-volume" => self.update_track(body.unwrap_or(Value::Null), |track, body| {
                track.volume_db = body_f64_value(body, "db", track.volume_db);
            }),
            "/set-track-pan" => self.update_track(body.unwrap_or(Value::Null), |track, body| {
                track.pan = body_f64_value(body, "pan", track.pan).clamp(-1.0, 1.0);
            }),
            "/set-track-mute" => self.update_track(body.unwrap_or(Value::Null), |track, body| {
                track.mute = body_bool_value(body, "muted", track.mute);
            }),
            "/set-track-solo" => self.update_track(body.unwrap_or(Value::Null), |track, body| {
                track.solo = body_bool_value(body, "solo", track.solo);
            }),
            "/undo" => {
                if let Some(previous) = self.history.pop() {
                    self.redo.push(self.project.clone());
                    self.project = previous;
                }
                Ok(Value::Null)
            }
            "/redo" => {
                if let Some(next) = self.redo.pop() {
                    self.history.push(self.project.clone());
                    self.project = next;
                }
                Ok(Value::Null)
            }
            "/save-project" => {
                let path = body_string(&body, "path")?;
                let data = serde_json::to_string_pretty(&self.project)
                    .map_err(|error| format!("Failed to serialize DAW project: {error}"))?;
                std::fs::write(&path, data)
                    .map_err(|error| format!("Failed to save DAW project: {error}"))?;
                Ok(Value::Null)
            }
            "/load-project" => {
                let path = body_string(&body, "path")?;
                let data = std::fs::read_to_string(&path)
                    .map_err(|error| format!("Failed to read DAW project: {error}"))?;
                let project = serde_json::from_str::<DawProject>(&data)
                    .map_err(|error| format!("Failed to parse DAW project: {error}"))?;
                self.snapshot();
                self.project = project;
                Ok(json!(self.project))
            }
            other => Err(format!("Unknown DAW bridge endpoint: {other}")),
        }
    }

    fn snapshot(&mut self) {
        self.history.push(self.project.clone());
        if self.history.len() > 64 {
            self.history.remove(0);
        }
        self.redo.clear();
    }

    fn stop_transport(&mut self) {
        self.mode = TransportMode::Stopped;
        self.anchor_position_ms = 0;
        self.started_at = None;
    }

    fn current_position_ms(&self) -> u64 {
        match (self.mode, self.started_at) {
            (TransportMode::Playing, Some(started_at)) => {
                self.anchor_position_ms + started_at.elapsed().as_millis() as u64
            }
            _ => self.anchor_position_ms,
        }
    }

    fn position(&self) -> DawPosition {
        let position_ms = self.current_position_ms();
        let beats_per_bar = self.project.time_signature[0].max(1) as u64;
        let beat_ms = (60_000.0 / self.project.tempo_bpm.max(1.0)) as u64;
        let total_beats = if beat_ms > 0 { position_ms / beat_ms } else { 0 };
        let mode = match self.mode {
            TransportMode::Stopped => "stopped",
            TransportMode::Playing => "playing",
            TransportMode::Paused => "paused",
        };
        DawPosition {
            position_ms,
            bar: total_beats / beats_per_bar + 1,
            beat: total_beats % beats_per_bar + 1,
            tick: if beat_ms > 0 {
                ((position_ms % beat_ms) * 960 / beat_ms).min(959)
            } else {
                0
            },
            mode,
        }
    }

    fn next_track_id(&mut self) -> String {
        self.track_counter += 1;
        format!("track-{}", self.track_counter)
    }

    fn next_region_id(&mut self) -> String {
        self.region_counter += 1;
        format!("region-{}", self.region_counter)
    }

    fn import_stem_urls(&mut self, body: Value) -> Result<Value, String> {
        let stems = body
            .get("stems")
            .and_then(Value::as_array)
            .ok_or_else(|| "DAW import requires a stems array".to_string())?
            .clone();
        self.snapshot();
        if let Some(name) = body.get("project_name").and_then(Value::as_str) {
            if !name.trim().is_empty() {
                self.project.name = name.trim().to_string();
            }
        }
        if let Some(tempo) = body.get("tempo_bpm").and_then(Value::as_f64) {
            if tempo.is_finite() && tempo > 0.0 {
                self.project.tempo_bpm = tempo;
            }
        }
        let mut track_ids = Vec::new();
        for stem in stems {
            let track_name = stem
                .get("track_name")
                .and_then(Value::as_str)
                .unwrap_or("Stem")
                .to_string();
            let audio_url = stem
                .get("audio_url")
                .and_then(Value::as_str)
                .ok_or_else(|| "Stem import entry is missing audio_url".to_string())?
                .to_string();
            let duration_ms = stem
                .get("duration_ms")
                .and_then(Value::as_u64)
                .unwrap_or(30_000)
                .max(1);
            track_ids.push(self.push_stem_track(track_name, audio_url, duration_ms));
        }
        Ok(json!({ "track_ids": track_ids }))
    }

    fn import_stems(&mut self, body: Value) -> Result<Value, String> {
        let source_path = body
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "DAW import requires source_path".to_string())?;
        let source = Path::new(source_path);
        let entries = std::fs::read_dir(source)
            .map_err(|error| format!("Failed to read stem directory: {error}"))?;
        self.snapshot();
        let mut track_ids = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_audio_file(&path) {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("Stem")
                .to_string();
            track_ids.push(self.push_stem_track(
                name,
                path.to_string_lossy().to_string(),
                30_000,
            ));
        }
        Ok(json!({ "track_ids": track_ids }))
    }

    fn push_stem_track(&mut self, name: String, audio_ref: String, duration_ms: u64) -> String {
        let track_id = self.next_track_id();
        let region_id = self.next_region_id();
        self.project.tracks.push(DawTrack {
            id: track_id.clone(),
            name,
            color: color_for_index(self.project.tracks.len()),
            volume_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
            automation: Vec::new(),
            regions: vec![DawRegion {
                id: region_id,
                audio_ref,
                position_ms: 0,
                start_offset_ms: 0,
                end_offset_ms: duration_ms,
                fade_in_ms: 0,
                fade_out_ms: 0,
                fade_curve: "linear".to_string(),
                generation_dna: None,
            }],
        });
        track_id
    }

    fn add_track(&mut self, body: Value) -> Result<Value, String> {
        self.snapshot();
        let track_id = self.next_track_id();
        let color = body
            .get("color")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| color_for_index(self.project.tracks.len()));
        let name = body
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("New Track")
            .to_string();
        self.project.tracks.push(DawTrack {
            id: track_id.clone(),
            name,
            color,
            volume_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
            regions: Vec::new(),
            automation: Vec::new(),
        });
        Ok(json!({ "track_id": track_id }))
    }

    fn add_region(&mut self, body: Value) -> Result<Value, String> {
        let track_id = value_string(&body, "track_id")?;
        let audio_path = value_string(&body, "audio_path")?;
        let position_ms = body_u64_value(&body, "position_ms", 0);
        self.snapshot();
        let region_id = self.next_region_id();
        let region = DawRegion {
            id: region_id.clone(),
            audio_ref: audio_path,
            position_ms,
            start_offset_ms: 0,
            end_offset_ms: 30_000,
            fade_in_ms: 0,
            fade_out_ms: 0,
            fade_curve: "linear".to_string(),
            generation_dna: None,
        };
        let track = self
            .project
            .tracks
            .iter_mut()
            .find(|track| track.id == track_id)
            .ok_or_else(|| format!("Track not found: {track_id}"))?;
        track.regions.push(region);
        Ok(json!({ "region_id": region_id }))
    }

    fn move_region(&mut self, body: Value) -> Result<Value, String> {
        let region_id = value_string(&body, "region_id")?;
        let target_track_id = value_string(&body, "track_id")?;
        let position_ms = body_u64_value(&body, "position_ms", 0);
        self.snapshot();
        let mut moved = None;
        for track in &mut self.project.tracks {
            if let Some(index) = track.regions.iter().position(|region| region.id == region_id) {
                moved = Some(track.regions.remove(index));
                break;
            }
        }
        let mut region = moved.ok_or_else(|| format!("Region not found: {region_id}"))?;
        region.position_ms = position_ms;
        let target = self
            .project
            .tracks
            .iter_mut()
            .find(|track| track.id == target_track_id)
            .ok_or_else(|| format!("Track not found: {target_track_id}"))?;
        target.regions.push(region);
        Ok(Value::Null)
    }

    fn resize_region(&mut self, body: Value) -> Result<Value, String> {
        let region_id = value_string(&body, "region_id")?;
        self.snapshot();
        let region = self.find_region_mut(&region_id)?;
        region.start_offset_ms = body_u64_value(&body, "start_ms", region.start_offset_ms);
        region.end_offset_ms = body_u64_value(&body, "end_ms", region.end_offset_ms).max(region.start_offset_ms + 1);
        Ok(Value::Null)
    }

    fn split_region(&mut self, body: Value) -> Result<Value, String> {
        let region_id = value_string(&body, "region_id")?;
        let split_ms = body_u64_value(&body, "position_ms", 0);
        self.snapshot();
        let right_id = self.next_region_id();
        for track in &mut self.project.tracks {
            if let Some(index) = track.regions.iter().position(|region| region.id == region_id) {
                let mut right = track.regions[index].clone();
                right.id = right_id.clone();
                right.position_ms = split_ms;
                track.regions[index].end_offset_ms = split_ms.max(track.regions[index].start_offset_ms + 1);
                track.regions.insert(index + 1, right);
                return Ok(json!({ "left_id": region_id, "right_id": right_id }));
            }
        }
        Err(format!("Region not found: {region_id}"))
    }

    fn set_fade(&mut self, body: Value) -> Result<Value, String> {
        let region_id = value_string(&body, "region_id")?;
        self.snapshot();
        let region = self.find_region_mut(&region_id)?;
        region.fade_in_ms = body_u64_value(&body, "fade_in_ms", region.fade_in_ms);
        region.fade_out_ms = body_u64_value(&body, "fade_out_ms", region.fade_out_ms);
        region.fade_curve = body
            .get("curve")
            .and_then(Value::as_str)
            .unwrap_or(&region.fade_curve)
            .to_string();
        Ok(Value::Null)
    }

    fn waveform_peaks(&self, query: Option<&str>) -> Result<Value, String> {
        let width = query_u64(query, "width_px", 240).clamp(1, 2048) as usize;
        let peaks = (0..width)
            .map(|index| {
                let phase = index as f64 / width.max(1) as f64;
                let value = ((phase * std::f64::consts::TAU * 8.0).sin().abs() * 0.58 + 0.08)
                    .min(0.9);
                json!([-value, value])
            })
            .collect::<Vec<_>>();
        Ok(json!({ "peaks": peaks }))
    }

    fn update_track<F>(&mut self, body: Value, update: F) -> Result<Value, String>
    where
        F: FnOnce(&mut DawTrack, &Value),
    {
        let track_id = value_string(&body, "track_id")?;
        self.snapshot();
        let track = self
            .project
            .tracks
            .iter_mut()
            .find(|track| track.id == track_id)
            .ok_or_else(|| format!("Track not found: {track_id}"))?;
        update(track, &body);
        Ok(Value::Null)
    }

    fn find_region_mut(&mut self, region_id: &str) -> Result<&mut DawRegion, String> {
        for track in &mut self.project.tracks {
            if let Some(region) = track.regions.iter_mut().find(|region| region.id == region_id) {
                return Ok(region);
            }
        }
        Err(format!("Region not found: {region_id}"))
    }
}

fn split_endpoint(endpoint: &str) -> (&str, Option<&str>) {
    endpoint
        .split_once('?')
        .map(|(path, query)| (path, Some(query)))
        .unwrap_or((endpoint, None))
}

fn body_string(body: &Option<Value>, key: &str) -> Result<String, String> {
    body.as_ref()
        .ok_or_else(|| format!("Missing DAW request body for {key}"))
        .and_then(|value| value_string(value, key))
}

fn value_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Missing DAW request field: {key}"))
}

fn body_u64(body: &Option<Value>, key: &str, fallback: u64) -> u64 {
    body.as_ref()
        .map(|value| body_u64_value(value, key, fallback))
        .unwrap_or(fallback)
}

fn body_u64_value(value: &Value, key: &str, fallback: u64) -> u64 {
    value
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
}

fn body_f64(body: &Option<Value>, key: &str, fallback: f64) -> f64 {
    body.as_ref()
        .map(|value| body_f64_value(value, key, fallback))
        .unwrap_or(fallback)
}

fn body_f64_value(value: &Value, key: &str, fallback: f64) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or(fallback)
}

fn body_bool(body: &Option<Value>, key: &str, fallback: bool) -> bool {
    body.as_ref()
        .map(|value| body_bool_value(value, key, fallback))
        .unwrap_or(fallback)
}

fn body_bool_value(value: &Value, key: &str, fallback: bool) -> bool {
    value
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn query_u64(query: Option<&str>, key: &str, fallback: u64) -> u64 {
    query
        .and_then(|query| {
            query.split('&').find_map(|pair| {
                let (name, value) = pair.split_once('=')?;
                if name == key {
                    value.parse::<u64>().ok()
                } else {
                    None
                }
            })
        })
        .unwrap_or(fallback)
}

fn color_for_index(index: usize) -> String {
    const COLORS: &[&str] = &[
        "#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#A78BFA", "#22D3EE", "#FB7185",
    ];
    COLORS[index % COLORS.len()].to_string()
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("wav" | "mp3" | "flac" | "m4a" | "ogg" | "aiff" | "aif")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daw_bridge_imports_stem_urls_into_tracks() {
        let mut bridge = DawBridgeState::default();
        bridge.handle("/init", None).unwrap();
        let result = bridge
            .handle(
                "/import-stem-urls",
                Some(json!({
                    "project_name": "QA stem pass",
                    "tempo_bpm": 128,
                    "stems": [
                        { "track_name": "Drums", "audio_url": "file:///drums.wav", "duration_ms": 12000 },
                        { "track_name": "Bass", "audio_url": "file:///bass.wav", "duration_ms": 12000 }
                    ]
                })),
            )
            .unwrap();
        assert_eq!(result["track_ids"].as_array().unwrap().len(), 2);

        let project = bridge.handle("/project", None).unwrap();
        assert_eq!(project["name"], "QA stem pass");
        assert_eq!(project["tracks"].as_array().unwrap().len(), 2);
        assert_eq!(project["tracks"][0]["regions"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn daw_bridge_transport_and_waveform_are_available() {
        let mut bridge = DawBridgeState::default();
        let play = bridge.handle("/play", None).unwrap();
        assert_eq!(play["mode"], "playing");
        let pause = bridge.handle("/pause", None).unwrap();
        assert_eq!(pause["mode"], "paused");
        bridge
            .handle("/seek", Some(json!({ "position_ms": 4800 })))
            .unwrap();
        let position = bridge.handle("/position", None).unwrap();
        assert_eq!(position["position_ms"], 4800);

        let peaks = bridge
            .handle("/waveform-peaks?audio_path=demo.wav&width_px=32&start_ms=0&end_ms=1000", None)
            .unwrap();
        assert_eq!(peaks["peaks"].as_array().unwrap().len(), 32);
    }
}
