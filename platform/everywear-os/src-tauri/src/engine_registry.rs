//! Engine Registry: runtime discovery of callable generation engines.
//!
//! Contract 1 from MIGRATION_ARCHITECTURE.md.
//!
//! Engines are NOT hardcoded. Each applet advertises capabilities upon
//! IPC connection. The shell builds this registry dynamically.
//!
//! Discovery protocol:
//! 1. Shell launches applet binary
//! 2. Applet connects IPC, authenticates with HMAC
//! 3. Applet sends AdvertiseCapabilities event
//! 4. Shell validates, adds to registry, sets availability = Ready
//! 5. On disconnect/crash: shell purge_applet, marks Unavailable
//! 6. On reconnect: applet re-advertises (full state reconciliation)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A registered engine: one applet can advertise multiple engines.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineEntry {
    pub engine_id: String,
    pub applet_id: String,
    pub capabilities: Vec<String>,
    pub input_schemas: HashMap<String, serde_json::Value>,
    pub output_schemas: HashMap<String, serde_json::Value>,
    pub vram_requirement_mb: u32,
    pub availability: EngineAvailability,
    pub lifecycle: EngineLifecycle,
    pub registered_at: u64, // Unix epoch millis (no chrono in registry)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineAvailability {
    Ready,
    Loading,
    Unavailable,
    NotInstalled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineLifecycle {
    Idle,
    Warm,
    Generating,
    Unloading,
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// Runtime registry of all known engines, keyed by engine_id.
pub struct EngineRegistry {
    engines: HashMap<String, EngineEntry>,
}

impl EngineRegistry {
    pub fn new() -> Self {
        Self {
            engines: HashMap::new(),
        }
    }

    /// Register (or re-register) an engine entry.
    /// If the engine_id already exists, the entry is replaced (reconnect case).
    pub fn register(&mut self, entry: EngineEntry) {
        info!(
            engine = %entry.engine_id,
            applet = %entry.applet_id,
            capabilities = ?entry.capabilities,
            vram_mb = entry.vram_requirement_mb,
            "Engine registered"
        );
        self.engines.insert(entry.engine_id.clone(), entry);
    }

    /// Remove a specific engine by ID.
    pub fn unregister(&mut self, engine_id: &str) {
        if let Some(removed) = self.engines.remove(engine_id) {
            info!(
                engine = %removed.engine_id,
                applet = %removed.applet_id,
                "Engine unregistered"
            );
        } else {
            warn!(engine = engine_id, "Attempted to unregister unknown engine");
        }
    }

    /// Find all engines that advertise a given capability.
    /// Returns only engines with availability == Ready.
    pub fn find_by_capability(&self, capability: &str) -> Vec<&EngineEntry> {
        self.engines
            .values()
            .filter(|e| {
                e.availability == EngineAvailability::Ready
                    && e.capabilities.iter().any(|c| c == capability)
            })
            .collect()
    }

    /// Get a specific engine by ID.
    pub fn get(&self, engine_id: &str) -> Option<&EngineEntry> {
        self.engines.get(engine_id)
    }

    /// Get a mutable reference to a specific engine.
    pub fn get_mut(&mut self, engine_id: &str) -> Option<&mut EngineEntry> {
        self.engines.get_mut(engine_id)
    }

    /// Remove all engines owned by a disconnected/crashed applet.
    pub fn purge_applet(&mut self, applet_id: &str) {
        let before = self.engines.len();
        self.engines.retain(|_, e| e.applet_id != applet_id);
        let removed = before - self.engines.len();
        if removed > 0 {
            info!(
                applet = applet_id,
                engines_removed = removed,
                "Purged engines for disconnected applet"
            );
        }
    }

    /// Mark all engines for an applet as Unavailable (pre-purge, or transient).
    pub fn mark_applet_unavailable(&mut self, applet_id: &str) {
        for entry in self.engines.values_mut() {
            if entry.applet_id == applet_id {
                entry.availability = EngineAvailability::Unavailable;
            }
        }
    }

    /// Update lifecycle state for an engine (Idle -> Warm -> Generating etc.)
    pub fn set_lifecycle(&mut self, engine_id: &str, lifecycle: EngineLifecycle) {
        if let Some(entry) = self.engines.get_mut(engine_id) {
            entry.lifecycle = lifecycle;
        }
    }

    /// Update availability for an engine.
    pub fn set_availability(&mut self, engine_id: &str, availability: EngineAvailability) {
        if let Some(entry) = self.engines.get_mut(engine_id) {
            entry.availability = availability;
        }
    }

    /// List all registered engines (for diagnostics / platform_status).
    pub fn all(&self) -> Vec<&EngineEntry> {
        self.engines.values().collect()
    }

    /// Count of registered engines.
    pub fn len(&self) -> usize {
        self.engines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.engines.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build an EngineEntry from an AdvertiseCapabilities payload.
/// Called by the shell when processing an applet's capability advertisement.
pub fn engine_entry_from_advertisement(
    applet_id: &str,
    payload: &serde_json::Value,
) -> Result<EngineEntry, String> {
    let engine_id = payload
        .get("engine_id")
        .and_then(|v| v.as_str())
        .ok_or("missing engine_id")?
        .to_string();

    let capabilities: Vec<String> = payload
        .get("capabilities")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if capabilities.is_empty() {
        return Err("engine must advertise at least one capability".into());
    }

    let input_schemas: HashMap<String, serde_json::Value> = payload
        .get("input_schemas")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let output_schemas: HashMap<String, serde_json::Value> = payload
        .get("output_schemas")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let vram_requirement_mb = payload
        .get("vram_requirement_mb")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let now_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(EngineEntry {
        engine_id,
        applet_id: applet_id.to_string(),
        capabilities,
        input_schemas,
        output_schemas,
        vram_requirement_mb,
        availability: EngineAvailability::Ready,
        lifecycle: EngineLifecycle::Idle,
        registered_at: now_millis,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(engine_id: &str, applet_id: &str, caps: &[&str]) -> EngineEntry {
        EngineEntry {
            engine_id: engine_id.into(),
            applet_id: applet_id.into(),
            capabilities: caps.iter().map(|s| s.to_string()).collect(),
            input_schemas: HashMap::new(),
            output_schemas: HashMap::new(),
            vram_requirement_mb: 4096,
            availability: EngineAvailability::Ready,
            lifecycle: EngineLifecycle::Idle,
            registered_at: 0,
        }
    }

    #[test]
    fn register_and_find() {
        let mut reg = EngineRegistry::new();
        reg.register(make_entry(
            "ace-step",
            "gener8",
            &["audio_gen", "music_gen"],
        ));
        reg.register(make_entry("z-image", "1magen", &["txt2img", "img2img"]));

        let audio = reg.find_by_capability("audio_gen");
        assert_eq!(audio.len(), 1);
        assert_eq!(audio[0].engine_id, "ace-step");

        let img = reg.find_by_capability("txt2img");
        assert_eq!(img.len(), 1);
        assert_eq!(img[0].engine_id, "z-image");

        assert!(reg.find_by_capability("nonexistent").is_empty());
    }

    #[test]
    fn unregister() {
        let mut reg = EngineRegistry::new();
        reg.register(make_entry("ace-step", "gener8", &["audio_gen"]));
        assert_eq!(reg.len(), 1);
        reg.unregister("ace-step");
        assert_eq!(reg.len(), 0);
    }

    #[test]
    fn purge_applet_removes_all_engines() {
        let mut reg = EngineRegistry::new();
        reg.register(make_entry("ace-step", "gener8", &["audio_gen"]));
        reg.register(make_entry("ace-step-v2", "gener8", &["audio_gen_v2"]));
        reg.register(make_entry("z-image", "1magen", &["txt2img"]));

        reg.purge_applet("gener8");
        assert_eq!(reg.len(), 1);
        assert!(reg.get("z-image").is_some());
    }

    #[test]
    fn unavailable_engines_excluded_from_capability_search() {
        let mut reg = EngineRegistry::new();
        reg.register(make_entry("ace-step", "gener8", &["audio_gen"]));
        reg.set_availability("ace-step", EngineAvailability::Unavailable);

        assert!(reg.find_by_capability("audio_gen").is_empty());
    }

    #[test]
    fn from_advertisement_payload() {
        let payload = serde_json::json!({
            "engine_id": "ace-step-v1.5",
            "capabilities": ["audio_gen", "music_gen"],
            "input_schemas": { "audio_gen": { "type": "object" } },
            "output_schemas": {},
            "vram_requirement_mb": 4096
        });

        let entry = engine_entry_from_advertisement("gener8", &payload).unwrap();
        assert_eq!(entry.engine_id, "ace-step-v1.5");
        assert_eq!(entry.applet_id, "gener8");
        assert_eq!(entry.capabilities.len(), 2);
        assert_eq!(entry.vram_requirement_mb, 4096);
        assert_eq!(entry.availability, EngineAvailability::Ready);
    }
}
