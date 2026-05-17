//! Audio decode and beat analysis.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;

use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Analysis output. Kept flat for straightforward JSON serialization.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BeatMap {
    pub bpm: f32,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub beats: Vec<u64>,
    pub downbeats: Vec<u64>,
    pub sections: Vec<u64>,
    #[serde(default = "default_method", skip_deserializing)]
    pub method: &'static str,
}

fn default_method() -> &'static str {
    "aubio-default"
}

/// Decode `path` with Symphonia, downmix to mono f32, then run aubio tempo
/// tracking. `target_sr` is advisory; if the source sample rate differs, the
/// input is linearly resampled before analysis.
pub fn analyse(path: &Path, target_sr: Option<u32>) -> Result<BeatMap> {
    let (samples, source_sr) =
        decode_to_mono_f32(path).with_context(|| format!("decode {}", path.display()))?;

    if samples.is_empty() {
        bail!("audio file decoded to zero samples");
    }

    let analysis_sr = target_sr.unwrap_or(source_sr);
    let samples_at_sr = if analysis_sr == source_sr {
        samples
    } else {
        linear_resample(&samples, source_sr, analysis_sr)
    };

    let duration_ms = ((samples_at_sr.len() as f64) * 1000.0 / analysis_sr as f64) as u64;
    let beats = run_aubio(&samples_at_sr, analysis_sr)?;
    let bpm = estimate_bpm(&beats);
    let downbeats = derive_downbeats(&beats);
    let sections = derive_sections(duration_ms);

    Ok(BeatMap {
        bpm,
        duration_ms,
        sample_rate: analysis_sr,
        beats,
        downbeats,
        sections,
        method: "aubio-default",
    })
}

fn decode_to_mono_f32(path: &Path) -> Result<(Vec<f32>, u32)> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
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

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
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
        let mut sb = SampleBuffer::<f32>::new(frames, spec);
        sb.copy_interleaved_ref(decoded);

        let channels = spec.channels.count();
        let interleaved = sb.samples();

        if channels == 1 {
            out.extend_from_slice(interleaved);
        } else {
            for chunk in interleaved.chunks_exact(channels) {
                let sum: f32 = chunk.iter().copied().sum();
                out.push(sum / channels as f32);
            }
        }
    }

    Ok((out, sr))
}

fn linear_resample(samples: &[f32], from_sr: u32, to_sr: u32) -> Vec<f32> {
    if from_sr == to_sr || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = to_sr as f64 / from_sr as f64;
    let out_len = (samples.len() as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let j = src.floor() as usize;
        let frac = (src - j as f64) as f32;
        let a = *samples.get(j).unwrap_or(&0.0);
        let b = *samples.get(j + 1).unwrap_or(&a);
        out.push(a + (b - a) * frac);
    }
    out
}

fn run_aubio(samples: &[f32], sr: u32) -> Result<Vec<u64>> {
    use aubio_rs::{OnsetMode, Tempo};

    const WIN: usize = 1024;
    const HOP: usize = 512;

    let mut tempo = Tempo::new(OnsetMode::SpecDiff, WIN, HOP, sr)
        .map_err(|e| anyhow!("aubio Tempo::new failed: {e:?}"))?;

    let mut beats_ms = Vec::<u64>::new();
    let mut out_buf = [0f32; 1];

    for chunk in samples.chunks_exact(HOP) {
        tempo
            .do_(chunk, &mut out_buf[..])
            .map_err(|e| anyhow!("aubio tempo.do_ failed: {e:?}"))?;

        if out_buf[0] > 0.0 {
            let pos_samples = tempo.get_last() as f64;
            let ms = (pos_samples * 1000.0 / sr as f64) as u64;
            if beats_ms.last().copied() != Some(ms) {
                beats_ms.push(ms);
            }
        }
    }

    Ok(beats_ms)
}

fn estimate_bpm(beats: &[u64]) -> f32 {
    if beats.len() < 2 {
        return 0.0;
    }
    let mut intervals: Vec<u64> = beats.windows(2).map(|w| w[1] - w[0]).collect();
    intervals.sort_unstable();
    let median = intervals[intervals.len() / 2];
    if median == 0 {
        0.0
    } else {
        60_000.0 / median as f32
    }
}

fn derive_downbeats(beats: &[u64]) -> Vec<u64> {
    beats.iter().step_by(4).copied().collect()
}

fn derive_sections(duration_ms: u64) -> Vec<u64> {
    if duration_ms == 0 {
        return vec![0];
    }
    vec![
        0,
        duration_ms / 4,
        duration_ms / 2,
        3 * duration_ms / 4,
        duration_ms,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bpm_on_empty_beats_is_zero() {
        assert_eq!(estimate_bpm(&[]), 0.0);
        assert_eq!(estimate_bpm(&[500]), 0.0);
    }

    #[test]
    fn bpm_on_120_bpm_grid() {
        let beats: Vec<u64> = (0..10).map(|i| i * 500).collect();
        let bpm = estimate_bpm(&beats);
        assert!((bpm - 120.0).abs() < 0.1, "got {bpm}");
    }

    #[test]
    fn downbeats_are_every_fourth_beat() {
        let beats: Vec<u64> = (0..16).map(|i| i * 100).collect();
        let downbeats = derive_downbeats(&beats);
        assert_eq!(downbeats, vec![0, 400, 800, 1200]);
    }

    #[test]
    fn sections_for_240s_track() {
        let sections = derive_sections(240_000);
        assert_eq!(sections, vec![0, 60_000, 120_000, 180_000, 240_000]);
    }
}
