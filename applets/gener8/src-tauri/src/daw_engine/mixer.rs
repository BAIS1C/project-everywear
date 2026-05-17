//! N-channel stem mixer.
//!
//! Phase 1: CPU mixing. Sums N tracks into a stereo master bus with
//! per-track gain (dB), pan, mute, solo. Applies region fade envelopes.
//!
//! Ported unchanged from S3 Studio.

use super::project::{FadeCurve, Region, Track};
use super::DecodedAudio;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Output sample rate. Locked to 48 kHz.
pub const SAMPLE_RATE: u32 = 48_000;

/// Default block size for mixing (1024 frames = ~21ms at 48 kHz).
pub const BLOCK_SIZE: usize = 1024;

/// Convert decibels to linear gain.
fn db_to_gain(db: f64) -> f32 {
    if db <= -96.0 {
        0.0
    } else {
        10.0f32.powf(db as f32 / 20.0)
    }
}

/// Apply equal-power pan law.
fn pan_gains(pan: f64) -> (f32, f32) {
    let pan = pan.clamp(-1.0, 1.0) as f32;
    let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
    (angle.cos(), angle.sin())
}

/// Compute the fade gain at a given position within a region.
fn fade_gain(region: &Region, position_in_region_ms: u64) -> f32 {
    let dur = region.duration_ms();
    if dur == 0 {
        return 1.0;
    }
    if region.fade_in_ms > 0 && position_in_region_ms < region.fade_in_ms {
        let t = position_in_region_ms as f32 / region.fade_in_ms as f32;
        return apply_fade_curve(t, &region.fade_curve);
    }
    let time_before_end = dur.saturating_sub(position_in_region_ms);
    if region.fade_out_ms > 0 && time_before_end < region.fade_out_ms {
        let t = time_before_end as f32 / region.fade_out_ms as f32;
        return apply_fade_curve(t, &region.fade_curve);
    }
    1.0
}

fn apply_fade_curve(t: f32, curve: &FadeCurve) -> f32 {
    match curve {
        FadeCurve::Linear => t,
        FadeCurve::Exponential => t * t,
        FadeCurve::SCurve => {
            let t2 = t * t;
            3.0 * t2 - 2.0 * t2 * t
        }
    }
}

/// Mix a block of audio from all tracks at the given timeline position.
pub fn mix_block(
    tracks: &[Track],
    audio_cache: &HashMap<PathBuf, Arc<DecodedAudio>>,
    position_ms: u64,
    block_size: usize,
    has_solo: bool,
) -> Vec<f32> {
    let mut master = vec![0.0f32; block_size * 2];
    let block_duration_ms = (block_size as f64 * 1000.0 / SAMPLE_RATE as f64) as u64;
    for track in tracks {
        if track.mute {
            continue;
        }
        if has_solo && !track.solo {
            continue;
        }
        let gain = db_to_gain(track.volume_db);
        let (pan_l, pan_r) = pan_gains(track.pan);
        for region in &track.regions {
            let region_end = region.end_position_ms();
            if position_ms >= region_end || position_ms + block_duration_ms <= region.position_ms {
                continue;
            }
            let audio_path = region
                .resolved_path
                .as_ref()
                .map(|p| p.clone())
                .unwrap_or_else(|| PathBuf::from(&region.audio_ref));
            let audio = match audio_cache.get(&audio_path) {
                Some(a) => a,
                None => continue,
            };
            let src_ch = audio.channels.max(1) as usize;
            let src_sr = audio.sample_rate as f64;
            for frame_idx in 0..block_size {
                let frame_ms =
                    position_ms + (frame_idx as f64 * 1000.0 / SAMPLE_RATE as f64) as u64;
                if frame_ms < region.position_ms || frame_ms >= region_end {
                    continue;
                }
                let pos_in_region_ms = frame_ms - region.position_ms;
                let audio_ms = region.start_offset_ms + pos_in_region_ms;
                let src_frame = (audio_ms as f64 * src_sr / 1000.0) as usize;
                let src_idx = src_frame * src_ch;
                if src_idx >= audio.samples.len() {
                    continue;
                }
                let sample = if src_ch == 1 {
                    audio.samples[src_idx]
                } else {
                    let l = audio.samples[src_idx];
                    let r = if src_idx + 1 < audio.samples.len() {
                        audio.samples[src_idx + 1]
                    } else {
                        l
                    };
                    (l + r) * 0.5
                };
                let fade = fade_gain(region, pos_in_region_ms);
                let out_idx = frame_idx * 2;
                master[out_idx] += sample * gain * pan_l * fade;
                master[out_idx + 1] += sample * gain * pan_r * fade;
            }
        }
    }
    master
}

/// Render the entire project to a stereo f32 buffer (for export/mixdown).
pub fn render_full(
    tracks: &[Track],
    audio_cache: &HashMap<PathBuf, Arc<DecodedAudio>>,
    duration_ms: u64,
) -> Vec<f32> {
    let total_frames = (duration_ms as f64 * SAMPLE_RATE as f64 / 1000.0) as usize;
    let has_solo = tracks.iter().any(|t| t.solo);
    let mut output = Vec::with_capacity(total_frames * 2);
    let mut pos_ms = 0u64;
    let block_dur_ms = (BLOCK_SIZE as f64 * 1000.0 / SAMPLE_RATE as f64) as u64;
    while pos_ms < duration_ms {
        let remaining_frames =
            ((duration_ms - pos_ms) as f64 * SAMPLE_RATE as f64 / 1000.0) as usize;
        let this_block = remaining_frames.min(BLOCK_SIZE);
        let block = mix_block(tracks, audio_cache, pos_ms, this_block, has_solo);
        output.extend_from_slice(&block[..this_block * 2]);
        pos_ms += block_dur_ms;
    }
    output
}
