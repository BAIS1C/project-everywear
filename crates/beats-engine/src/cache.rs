//! Two-tier beats cache: in-memory LRU over an on-disk JSON store.

use anyhow::{Context, Result};
use lru::LruCache;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::engine::BeatMap;

const MEM_CAPACITY: usize = 256;
const DEFAULT_DISK_MAX_MB: u64 = 100;
const CACHE_FORMAT_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CachedBeats {
    version: u32,
    abs_path: String,
    mtime_ms: u64,
    sample_rate: u32,
    beatmap: BeatMap,
}

pub struct BeatsCache {
    dir: PathBuf,
    mem: Mutex<LruCache<String, BeatMap>>,
    disk_max_bytes: u64,
}

impl BeatsCache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let disk_max_bytes = std::env::var("S3_BEATS_CACHE_MAX_MB")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_DISK_MAX_MB)
            .saturating_mul(1_048_576);

        Self {
            dir,
            mem: Mutex::new(LruCache::new(NonZeroUsize::new(MEM_CAPACITY).unwrap())),
            disk_max_bytes,
        }
    }

    pub fn get(&self, abs_path: &Path, sample_rate: u32) -> Option<BeatMap> {
        let mtime_ms = file_mtime_ms(abs_path)?;
        let key = cache_key(abs_path, mtime_ms, sample_rate);

        if let Some(hit) = self.mem.lock().ok().and_then(|mut m| m.get(&key).cloned()) {
            return Some(hit);
        }

        let path = self.dir.join(format!("{key}.json"));
        let bytes = fs::read(&path).ok()?;
        let record: CachedBeats = serde_json::from_slice(&bytes).ok()?;

        if record.version != CACHE_FORMAT_VERSION
            || record.mtime_ms != mtime_ms
            || record.sample_rate != sample_rate
        {
            return None;
        }

        if let Ok(mut m) = self.mem.lock() {
            m.put(key.clone(), record.beatmap.clone());
        }
        Some(record.beatmap)
    }

    pub fn put(&self, abs_path: &Path, sample_rate: u32, map: &BeatMap) -> Result<()> {
        let mtime_ms = file_mtime_ms(abs_path)
            .context("source file disappeared between analysis and cache write")?;
        let key = cache_key(abs_path, mtime_ms, sample_rate);

        let record = CachedBeats {
            version: CACHE_FORMAT_VERSION,
            abs_path: abs_path.display().to_string(),
            mtime_ms,
            sample_rate,
            beatmap: map.clone(),
        };

        let path = self.dir.join(format!("{key}.json"));
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(&record)?)
            .with_context(|| format!("write {}", tmp.display()))?;
        fs::rename(&tmp, &path)
            .with_context(|| format!("rename {} to {}", tmp.display(), path.display()))?;

        if let Ok(mut m) = self.mem.lock() {
            m.put(key, map.clone());
        }

        self.evict_if_over_quota();
        Ok(())
    }

    fn evict_if_over_quota(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        let mut files: Vec<(PathBuf, u64, SystemTime)> = entries
            .flatten()
            .filter_map(|e| {
                let md = e.metadata().ok()?;
                if !md.is_file() {
                    return None;
                }
                let path = e.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    return None;
                }
                Some((path, md.len(), md.modified().ok()?))
            })
            .collect();

        let total: u64 = files.iter().map(|(_, size, _)| *size).sum();
        if total <= self.disk_max_bytes {
            return;
        }

        files.sort_by_key(|(_, _, mtime)| *mtime);
        let mut running = total;
        for (path, size, _) in files {
            if running <= self.disk_max_bytes {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                running = running.saturating_sub(size);
            }
        }
    }
}

fn cache_key(abs_path: &Path, mtime_ms: u64, sample_rate: u32) -> String {
    let mut h = Sha256::new();
    h.update(abs_path.display().to_string().as_bytes());
    let digest = h.finalize();
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{hex}_mt{mtime_ms}_sr{sample_rate}")
}

fn file_mtime_ms(path: &Path) -> Option<u64> {
    let md = fs::metadata(path).ok()?;
    let mtime = md.modified().ok()?;
    let dur = mtime.duration_since(UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmpdir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!(
            "everywear-beats-test-{}-{stamp}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn tmpfile(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(bytes).unwrap();
        p
    }

    fn sample_map() -> BeatMap {
        BeatMap {
            bpm: 120.0,
            duration_ms: 4_000,
            sample_rate: 44_100,
            beats: vec![0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500],
            downbeats: vec![0, 2_000],
            sections: vec![0, 1_000, 2_000, 3_000, 4_000],
            method: "aubio-default",
        }
    }

    #[test]
    fn miss_then_hit() {
        let work = tmpdir();
        let audio = tmpfile(&work, "track.wav", b"not-real-audio");
        let cache = BeatsCache::new(work.join("cache"));

        assert!(cache.get(&audio, 44_100).is_none());
        cache.put(&audio, 44_100, &sample_map()).unwrap();

        let hit = cache.get(&audio, 44_100).expect("cache hit");
        assert!((hit.bpm - 120.0).abs() < f32::EPSILON);
        assert_eq!(hit.beats.len(), 8);
        let _ = fs::remove_dir_all(work);
    }

    #[test]
    fn mtime_invalidates() {
        let work = tmpdir();
        let audio = tmpfile(&work, "track.wav", b"v1");
        let cache = BeatsCache::new(work.join("cache"));
        cache.put(&audio, 44_100, &sample_map()).unwrap();
        assert!(cache.get(&audio, 44_100).is_some());

        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(&audio, b"v2").unwrap();
        assert!(cache.get(&audio, 44_100).is_none());
        let _ = fs::remove_dir_all(work);
    }

    #[test]
    fn sample_rate_partitions_cache() {
        let work = tmpdir();
        let audio = tmpfile(&work, "track.wav", b"fixed");
        let cache = BeatsCache::new(work.join("cache"));

        cache.put(&audio, 44_100, &sample_map()).unwrap();
        assert!(cache.get(&audio, 44_100).is_some());
        assert!(cache.get(&audio, 22_050).is_none());
        let _ = fs::remove_dir_all(work);
    }
}
