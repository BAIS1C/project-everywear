//! Audio output via cpal.

use super::mixer::{mix_block, SAMPLE_RATE};
use super::project::Track;
use super::transport::LoopRange;
use super::DecodedAudio;
use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Handle to an active playback session.
pub struct PlaybackHandle {
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    active: bool,
}

impl PlaybackHandle {
    pub fn start(
        tracks: Vec<Track>,
        audio_cache: HashMap<PathBuf, Arc<DecodedAudio>>,
        start_position_ms: u64,
        loop_range: LoopRange,
    ) -> Result<Self> {
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
        let (ready_tx, ready_rx) =
            std::sync::mpsc::sync_channel::<std::result::Result<(), String>>(1);
        let thread = std::thread::Builder::new()
            .name("gener8-daw-audio".into())
            .spawn(move || {
                let result = run_audio_stream(tracks, audio_cache, start_position_ms, loop_range);
                match result {
                    Ok(stream) => {
                        let _ = ready_tx.send(Ok(()));
                        let _ = stop_rx.recv();
                        drop(stream);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                }
            })
            .context("failed to spawn DAW audio thread")?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(anyhow!(error)),
            Err(error) => return Err(anyhow!("DAW audio thread did not start: {error}")),
        }

        Ok(Self {
            stop_tx: Some(stop_tx),
            thread: Some(thread),
            active: true,
        })
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.active = false;
    }
}

impl Drop for PlaybackHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

struct PlaybackSource {
    tracks: Vec<Track>,
    audio_cache: HashMap<PathBuf, Arc<DecodedAudio>>,
    position_samples: u64,
    loop_range: LoopRange,
    has_solo: bool,
}

impl PlaybackSource {
    fn new(
        tracks: Vec<Track>,
        audio_cache: HashMap<PathBuf, Arc<DecodedAudio>>,
        start_position_ms: u64,
        loop_range: LoopRange,
    ) -> Self {
        let has_solo = tracks.iter().any(|track| track.solo);
        Self {
            tracks,
            audio_cache,
            position_samples: start_position_ms.saturating_mul(SAMPLE_RATE as u64) / 1000,
            loop_range,
            has_solo,
        }
    }

    fn next_block(&mut self, frames: usize) -> Vec<f32> {
        let mut position_ms = self.position_samples.saturating_mul(1000) / SAMPLE_RATE as u64;
        if self.loop_range.enabled
            && self.loop_range.end_ms > self.loop_range.start_ms
            && position_ms >= self.loop_range.end_ms
        {
            position_ms = self.loop_range.start_ms;
            self.position_samples = position_ms.saturating_mul(SAMPLE_RATE as u64) / 1000;
        }

        let block = mix_block(
            &self.tracks,
            &self.audio_cache,
            position_ms,
            frames,
            self.has_solo,
        );
        self.position_samples = self.position_samples.saturating_add(frames as u64);
        block
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

/// List available audio output devices.
pub fn list_output_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    devices
        .filter_map(|device| {
            let name = device.name().unwrap_or_else(|_| "Unknown output".into());
            let config = device.default_output_config().ok()?;
            let buffer_size = match config.buffer_size() {
                cpal::SupportedBufferSize::Range { min, max } => (*min).max((*max).min(1024)),
                cpal::SupportedBufferSize::Unknown => 1024,
            };
            Some(AudioDeviceInfo {
                name,
                sample_rate: config.sample_rate().0,
                channels: config.channels() as u32,
                buffer_size,
            })
        })
        .collect()
}

fn select_output_config(device: &cpal::Device) -> Result<(cpal::StreamConfig, cpal::SampleFormat)> {
    if let Ok(configs) = device.supported_output_configs() {
        for range in configs {
            if range.channels() < 2 {
                continue;
            }
            let min = range.min_sample_rate().0;
            let max = range.max_sample_rate().0;
            if min <= SAMPLE_RATE && SAMPLE_RATE <= max {
                let sample_format = range.sample_format();
                let config = range
                    .with_sample_rate(cpal::SampleRate(SAMPLE_RATE))
                    .config();
                return Ok((config, sample_format));
            }
        }
    }

    let fallback = device
        .default_output_config()
        .context("default output config unavailable")?;
    if fallback.sample_rate().0 != SAMPLE_RATE {
        tracing::warn!(
            device_sample_rate = fallback.sample_rate().0,
            mixer_sample_rate = SAMPLE_RATE,
            "Audio device does not advertise 48 kHz; playback may require OS resampling"
        );
    }
    let sample_format = fallback.sample_format();
    Ok((fallback.config(), sample_format))
}

fn run_audio_stream(
    tracks: Vec<Track>,
    audio_cache: HashMap<PathBuf, Arc<DecodedAudio>>,
    start_position_ms: u64,
    loop_range: LoopRange,
) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| anyhow!("no default audio output device available"))?;
    let (config, sample_format) = select_output_config(&device)?;
    let channels = config.channels as usize;

    let source = Arc::new(Mutex::new(PlaybackSource::new(
        tracks,
        audio_cache,
        start_position_ms,
        loop_range,
    )));
    let err_fn = |err| tracing::warn!(error = %err, "DAW audio stream error");

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let source = source.clone();
            device.build_output_stream(
                &config,
                move |data: &mut [f32], _| write_f32(data, channels, &source),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let source = source.clone();
            device.build_output_stream(
                &config,
                move |data: &mut [i16], _| write_i16(data, channels, &source),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let source = source.clone();
            device.build_output_stream(
                &config,
                move |data: &mut [u16], _| write_u16(data, channels, &source),
                err_fn,
                None,
            )?
        }
        other => return Err(anyhow!("unsupported output sample format: {other:?}")),
    };

    stream.play().context("failed to start DAW audio stream")?;
    Ok(stream)
}

fn write_f32(data: &mut [f32], channels: usize, source: &Arc<Mutex<PlaybackSource>>) {
    let block = next_interleaved_block(data.len(), channels, source);
    for (out, sample) in data.iter_mut().zip(block.into_iter()) {
        *out = sample.clamp(-1.0, 1.0);
    }
}

fn write_i16(data: &mut [i16], channels: usize, source: &Arc<Mutex<PlaybackSource>>) {
    let block = next_interleaved_block(data.len(), channels, source);
    for (out, sample) in data.iter_mut().zip(block.into_iter()) {
        *out = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
    }
}

fn write_u16(data: &mut [u16], channels: usize, source: &Arc<Mutex<PlaybackSource>>) {
    let block = next_interleaved_block(data.len(), channels, source);
    for (out, sample) in data.iter_mut().zip(block.into_iter()) {
        let normalized = sample.clamp(-1.0, 1.0) * 0.5 + 0.5;
        *out = (normalized * u16::MAX as f32) as u16;
    }
}

fn next_interleaved_block(
    sample_count: usize,
    channels: usize,
    source: &Arc<Mutex<PlaybackSource>>,
) -> Vec<f32> {
    let channels = channels.max(1);
    let frames = sample_count / channels;
    let stereo = source
        .lock()
        .map(|mut src| src.next_block(frames))
        .unwrap_or_else(|_| vec![0.0; frames * 2]);

    if channels == 2 {
        return stereo;
    }

    let mut output = vec![0.0; sample_count];
    for frame in 0..frames {
        let l = stereo[frame * 2];
        let r = stereo[frame * 2 + 1];
        for ch in 0..channels {
            output[frame * channels + ch] = match ch {
                0 => l,
                1 => r,
                _ => (l + r) * 0.5,
            };
        }
    }
    output
}
