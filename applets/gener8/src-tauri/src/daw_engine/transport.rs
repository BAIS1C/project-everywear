//! Transport state machine: play / pause / stop / seek / loop.
//!
//! Ported unchanged from S3 Studio.

use serde::{Deserialize, Serialize};
use std::time::Instant;

/// Playback mode.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackMode {
    Stopped,
    Playing,
    Paused,
}

/// Loop range for the transport.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopRange {
    pub start_ms: u64,
    pub end_ms: u64,
    pub enabled: bool,
}

/// Full transport state. Owned by `DawEngine`, mutated by commands.
pub struct TransportState {
    mode: PlaybackMode,
    position_ms: u64,
    play_started_at: Option<Instant>,
    pub tempo_bpm: f64,
    pub time_signature: [u32; 2],
    pub metronome: bool,
    pub loop_range: LoopRange,
}

impl TransportState {
    pub fn new() -> Self {
        Self {
            mode: PlaybackMode::Stopped,
            position_ms: 0,
            play_started_at: None,
            tempo_bpm: 120.0,
            time_signature: [4, 4],
            metronome: false,
            loop_range: LoopRange {
                start_ms: 0,
                end_ms: 0,
                enabled: false,
            },
        }
    }

    pub fn mode(&self) -> &PlaybackMode {
        &self.mode
    }

    /// Current playback position, accounting for elapsed wall-clock time.
    pub fn position_ms(&self) -> u64 {
        match (&self.mode, self.play_started_at) {
            (PlaybackMode::Playing, Some(started)) => {
                let elapsed = started.elapsed().as_millis() as u64;
                let raw = self.position_ms + elapsed;
                if self.loop_range.enabled
                    && self.loop_range.end_ms > self.loop_range.start_ms
                    && raw >= self.loop_range.end_ms
                {
                    let loop_len = self.loop_range.end_ms - self.loop_range.start_ms;
                    let overshoot = raw - self.loop_range.start_ms;
                    self.loop_range.start_ms + (overshoot % loop_len)
                } else {
                    raw
                }
            }
            _ => self.position_ms,
        }
    }

    pub fn play(&mut self) -> u64 {
        if self.mode != PlaybackMode::Playing {
            self.mode = PlaybackMode::Playing;
            self.play_started_at = Some(Instant::now());
        }
        self.position_ms()
    }

    pub fn pause(&mut self) -> u64 {
        if self.mode == PlaybackMode::Playing {
            self.position_ms = self.position_ms();
            self.play_started_at = None;
            self.mode = PlaybackMode::Paused;
        }
        self.position_ms
    }

    pub fn stop(&mut self) {
        self.position_ms = 0;
        self.play_started_at = None;
        self.mode = PlaybackMode::Stopped;
    }

    pub fn seek(&mut self, position_ms: u64) {
        self.position_ms = position_ms;
        if self.mode == PlaybackMode::Playing {
            self.play_started_at = Some(Instant::now());
        }
    }

    pub fn set_loop(&mut self, start_ms: u64, end_ms: u64, enabled: bool) {
        if self.mode == PlaybackMode::Playing {
            self.position_ms = self.position_ms();
            self.play_started_at = Some(Instant::now());
        }
        self.loop_range = LoopRange {
            start_ms,
            end_ms,
            enabled,
        };
    }

    /// Convert the current position to bar:beat:tick notation.
    pub fn position_bbt(&self) -> (u32, u32, u32) {
        let pos_ms = self.position_ms();
        if self.tempo_bpm <= 0.0 {
            return (1, 1, 0);
        }
        let ms_per_beat = 60_000.0 / self.tempo_bpm;
        let total_beats = pos_ms as f64 / ms_per_beat;
        let beats_per_bar = self.time_signature[0] as f64;
        let bar = (total_beats / beats_per_bar).floor() as u32 + 1;
        let beat_in_bar = (total_beats % beats_per_bar).floor() as u32 + 1;
        let tick = ((total_beats.fract()) * 960.0) as u32; // 960 PPQN
        (bar, beat_in_bar, tick)
    }
}

/// Serialisable position snapshot for event streams.
#[derive(Clone, Debug, Serialize)]
pub struct PositionEvent {
    pub position_ms: u64,
    pub bar: u32,
    pub beat: u32,
    pub tick: u32,
    pub mode: PlaybackMode,
}

impl From<&TransportState> for PositionEvent {
    fn from(t: &TransportState) -> Self {
        let (bar, beat, tick) = t.position_bbt();
        Self {
            position_ms: t.position_ms(),
            bar,
            beat,
            tick,
            mode: t.mode().clone(),
        }
    }
}
