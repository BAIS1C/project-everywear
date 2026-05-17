//! IPC envelope: wraps all messages with correlation, sequencing, source
//! identification, and optional HMAC authentication.
//!
//! All IPC messages use this envelope. No raw Command/Response on the wire
//! in the new protocol mode. Legacy (pre-envelope) messages are still accepted
//! by the adapter in `protocol.rs`.

use serde::{Deserialize, Serialize};

/// Every IPC message, regardless of direction, is wrapped in this envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcEnvelope {
    /// UUID v4 for request-response correlation.
    pub id: String,

    /// Monotonic sequence number per direction. Shell and applet each maintain
    /// their own counter starting at 0.
    pub seq: u64,

    /// Who sent this message.
    pub source: IpcSource,

    /// What category of message this is.
    pub kind: IpcKind,

    /// The actual message content. Deserialized into CommandKind or EventKind
    /// based on the `kind` discriminant.
    pub payload: serde_json::Value,

    /// HMAC-SHA256 signature. Required on first connect (handshake) and on
    /// privilege-changing commands (TierSync, AuthContext). Optional on regular
    /// messages after handshake for performance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hmac: Option<String>,
}

/// Identifies who sent the message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IpcSource {
    Shell,
    Applet { applet_id: String },
}

/// Discriminates the message category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IpcKind {
    /// Request expecting a response (shell -> applet or applet -> shell).
    Command,
    /// Reply to a command.
    Response,
    /// Asynchronous notification: heartbeats, job results, status updates,
    /// capability advertisements. No response expected.
    Event,
}

impl IpcEnvelope {
    /// Create a new command envelope from the shell.
    pub fn command(payload: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            seq: 0, // Caller increments via send()
            source: IpcSource::Shell,
            kind: IpcKind::Command,
            payload,
            hmac: None,
        }
    }

    /// Create a new event envelope (no response expected).
    pub fn event(source: IpcSource, payload: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            seq: 0,
            source,
            kind: IpcKind::Event,
            payload,
            hmac: None,
        }
    }

    /// Create a response envelope correlated to the given request ID.
    pub fn response(request_id: &str, source: IpcSource, payload: serde_json::Value) -> Self {
        Self {
            id: request_id.to_string(),
            seq: 0,
            source,
            kind: IpcKind::Response,
            payload,
            hmac: None,
        }
    }

    /// Attach an HMAC signature to this envelope.
    pub fn with_hmac(mut self, hmac: String) -> Self {
        self.hmac = Some(hmac);
        self
    }

    /// Set the sequence number (called by the transport layer before sending).
    pub fn with_seq(mut self, seq: u64) -> Self {
        self.seq = seq;
        self
    }
}

/// Compute HMAC-SHA256 for a payload using the shared IPC secret.
///
/// Used for:
/// - First-connect handshake (applet proves it was spawned by this shell)
/// - TierSync messages (prevents local privilege escalation)
/// - AuthContext relay
#[cfg(feature = "hmac")]
pub fn compute_hmac(secret: &[u8], data: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(data);
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

/// Verify an HMAC-SHA256 signature using constant-time comparison.
///
/// Uses `hmac::Mac::verify_slice` which is guaranteed constant-time,
/// preventing timing side-channel attacks on the IPC secret.
#[cfg(feature = "hmac")]
pub fn verify_hmac(secret: &[u8], data: &[u8], expected: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(data);

    // Decode the hex-encoded expected signature, then verify in constant time
    match hex::decode(expected) {
        Ok(expected_bytes) => mac.verify_slice(&expected_bytes).is_ok(),
        Err(_) => false,
    }
}
