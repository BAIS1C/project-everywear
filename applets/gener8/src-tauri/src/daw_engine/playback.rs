//! Audio output via cpal.
//!
//! Phase 1 stub: actual cpal integration requires the `cpal` crate.
//! The struct exists now so the rest of the engine can compile.
//!
//! Ported unchanged from S3 Studio.

use serde::Serialize;

/// Handle to an active playback session.
pub struct PlaybackHandle {
    active: bool,
}

impl PlaybackHandle {
    pub fn new() -> Self {
        Self { active: true }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn stop(&mut self) {
        self.active = false;
    }
}

impl Drop for PlaybackHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Audio device info for the frontend settings panel.
#[derive(Clone, Debug, Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub buffer_size: u32,
}

/// List available audio output devices (stub).
pub fn list_output_devices() -> Vec<AudioDeviceInfo> {
    vec![AudioDeviceInfo {
        name: "System Default".to_string(),
        sample_rate: 48_000,
        channels: 2,
        buffer_size: 1024,
    }]
}
