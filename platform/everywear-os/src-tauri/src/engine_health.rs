//! Engine endpoint health prober (slice 1, 2026-06-10).
//!
//! Today engine ports and health checks are ad-hoc: ace-server on 8080
//! (/props), the LTX sidecar on 8787 (/health), the video-encoder sidecar
//! on 9877 (/health), and a Gener8 shim that DAW expects on 3001 but which
//! nothing serves (standing blocker). Each consumer probes its own port
//! with its own timeout and failure semantics.
//!
//! Slice 1 centralises the truth: one shell-owned prober sweeps the known
//! endpoints every 10 seconds and emits a single `engine-health` event.
//! Consumers (shell status cards, applet offline banners, launch gate)
//! migrate onto the event in slice 2; slice 3 replaces the static seed
//! below with ports declared in applet.toml [engine] and capability
//! advertisements.

use serde::Serialize;
use std::time::Duration;
use tauri::Emitter;
use tracing::debug;

#[derive(Debug, Clone, Serialize)]
pub struct EngineEndpoint {
    pub id: &'static str,
    pub applet_id: &'static str,
    pub port: u16,
    pub health_path: &'static str,
    /// "sidecar" = a local engine process the shell can expect to manage;
    /// "expected" = declared/probed by an applet but nothing is known to
    /// serve it yet. Expected endpoints are reported honestly as down.
    pub kind: &'static str,
}

/// Static seed (slice 1 only). Do not add ports anywhere else; add them here
/// until manifest-driven registration lands.
pub const KNOWN_ENDPOINTS: &[EngineEndpoint] = &[
    EngineEndpoint {
        id: "ace-server",
        applet_id: "gener8-4ever",
        port: 8080,
        health_path: "/props",
        kind: "sidecar",
    },
    EngineEndpoint {
        id: "ltx-sidecar",
        applet_id: "3nvizen",
        port: 8787,
        health_path: "/health",
        kind: "sidecar",
    },
    EngineEndpoint {
        id: "video-encoder",
        applet_id: "vid",
        port: 9877,
        health_path: "/health",
        kind: "sidecar",
    },
    // DAW probes a Gener8 shim here; nothing serves it today (standing
    // blocker, PROJECT_STATE 2026-06-10 01:26). Reported honestly as down
    // until the shim exists or DAW is repointed at a real engine.
    EngineEndpoint {
        id: "gener8-shim",
        applet_id: "daw",
        port: 3001,
        health_path: "/api/engine/pack-status?pack_id=better_models",
        kind: "expected",
    },
];

#[derive(Debug, Clone, Serialize)]
pub struct EndpointHealth {
    pub id: &'static str,
    pub applet_id: &'static str,
    pub port: u16,
    pub kind: &'static str,
    pub online: bool,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineHealthPayload {
    pub checked_at_ms: u64,
    pub endpoints: Vec<EndpointHealth>,
}

/// Spawn the background prober. One sweep every 10s, 2s timeout per probe,
/// one `engine-health` event per sweep. Localhost-only by construction.
pub fn spawn_engine_health_prober(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::error!(%error, "engine health prober failed to build HTTP client");
                return;
            }
        };

        loop {
            let mut endpoints = Vec::with_capacity(KNOWN_ENDPOINTS.len());
            for ep in KNOWN_ENDPOINTS {
                let url = format!("http://127.0.0.1:{}{}", ep.port, ep.health_path);
                let started = std::time::Instant::now();
                let online = matches!(
                    client.get(&url).send().await,
                    Ok(resp) if resp.status().is_success()
                );
                endpoints.push(EndpointHealth {
                    id: ep.id,
                    applet_id: ep.applet_id,
                    port: ep.port,
                    kind: ep.kind,
                    online,
                    latency_ms: if online {
                        Some(started.elapsed().as_millis() as u64)
                    } else {
                        None
                    },
                });
            }
            debug!(?endpoints, "engine health sweep");
            let checked_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let _ = app.emit(
                "engine-health",
                &EngineHealthPayload {
                    checked_at_ms,
                    endpoints,
                },
            );
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}
