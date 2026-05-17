//! Waveform decode and peak computation.
//!
//! Ported unchanged from S3 Studio.

use anyhow::{anyhow, bail, Context, Result};
use std::path::Path;

use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::DecodedAudio;

/// Decode an audio file to f32 samples, preserving channel layout.
pub fn decode_audio_file(path: &Path) -> Result<DecodedAudio> {
    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("symphonia probe failed")?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no decodable track"))?;
    let track_id = track.id;
    let sr = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("symphonia codec make failed")?;
    let mut out = Vec::<f32>::new();
    let mut channels = 0u32;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        let spec: SignalSpec = *decoded.spec();
        let frames = decoded.frames() as u64;
        if frames == 0 {
            continue;
        }
        channels = spec.channels.count() as u32;
        let mut sb = SampleBuffer::<f32>::new(frames, spec);
        sb.copy_interleaved_ref(decoded);
        out.extend_from_slice(sb.samples());
    }
    if channels == 0 {
        bail!("audio file decoded to zero frames");
    }
    let total_frames = out.len() as u64 / channels as u64;
    let duration_ms = total_frames * 1000 / sr as u64;
    Ok(DecodedAudio {
        samples: out,
        sample_rate: sr,
        channels,
        duration_ms,
    })
}

/// Compute waveform peaks for display. Returns `width_px` (min, max) pairs.
pub fn compute_peaks(
    audio: &DecodedAudio,
    width_px: u32,
    start_ms: u64,
    end_ms: u64,
) -> Vec<(f32, f32)> {
    if width_px == 0 || start_ms >= end_ms || audio.samples.is_empty() {
        return vec![(0.0, 0.0); width_px as usize];
    }
    let ch = audio.channels.max(1) as usize;
    let sr = audio.sample_rate as f64;
    let start_frame = (start_ms as f64 * sr / 1000.0) as usize;
    let end_frame = (end_ms as f64 * sr / 1000.0) as usize;
    let total_frames = audio.samples.len() / ch;
    let start_frame = start_frame.min(total_frames);
    let end_frame = end_frame.min(total_frames);
    let visible_frames = end_frame.saturating_sub(start_frame);
    if visible_frames == 0 {
        return vec![(0.0, 0.0); width_px as usize];
    }
    let frames_per_px = visible_frames as f64 / width_px as f64;
    let mut peaks = Vec::with_capacity(width_px as usize);
    for px in 0..width_px {
        let frame_start = start_frame + (px as f64 * frames_per_px) as usize;
        let frame_end = start_frame + ((px + 1) as f64 * frames_per_px) as usize;
        let frame_end = frame_end.min(total_frames);
        let mut lo = 0.0f32;
        let mut hi = 0.0f32;
        for f in frame_start..frame_end {
            let mut sum = 0.0f32;
            for c in 0..ch {
                let idx = f * ch + c;
                if idx < audio.samples.len() {
                    sum += audio.samples[idx];
                }
            }
            let sample = sum / ch as f32;
            lo = lo.min(sample);
            hi = hi.max(sample);
        }
        peaks.push((lo, hi));
    }
    peaks
}

/// Compute RMS levels per track for metering.
pub fn compute_meters(samples: &[f32], channels: u32) -> MeterReading {
    let ch = channels.max(1) as usize;
    if samples.is_empty() {
        return MeterReading::default();
    }
    let frames = samples.len() / ch;
    let mut sum_l = 0.0f64;
    let mut sum_r = 0.0f64;
    let mut peak_l = 0.0f32;
    let mut peak_r = 0.0f32;
    for f in 0..frames {
        let l = samples[f * ch];
        let r = if ch > 1 { samples[f * ch + 1] } else { l };
        sum_l += (l as f64) * (l as f64);
        sum_r += (r as f64) * (r as f64);
        peak_l = peak_l.max(l.abs());
        peak_r = peak_r.max(r.abs());
    }
    let rms_l = (sum_l / frames as f64).sqrt() as f32;
    let rms_r = (sum_r / frames as f64).sqrt() as f32;
    MeterReading {
        rms_l,
        rms_r,
        peak_l,
        peak_r,
    }
}

/// Meter reading for a single track or the master bus.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct MeterReading {
    pub rms_l: f32,
    pub rms_r: f32,
    pub peak_l: f32,
    pub peak_r: f32,
}
