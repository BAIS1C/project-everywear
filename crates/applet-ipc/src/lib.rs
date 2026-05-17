//! applet-ipc: command channel between Everywear OS shell and applet processes.
//!
//! Architecture: TCP on localhost with an OS-assigned port. The shell binds
//! a listener, passes the port as `EVERYWEAR_CMD_PORT=<port>` to the child
//! process, and holds the connection. The applet connects back on startup.
//!
//! Why TCP over named pipes / Unix sockets:
//! - Cross-platform (Windows + Linux + macOS) with zero conditional compilation
//! - tokio::net::TcpListener is already in the dependency tree
//! - Localhost-only; no network exposure (binds 127.0.0.1)
//! - OS assigns port 0 to avoid collisions between concurrent applets
//!
//! Two protocol modes:
//! - **Legacy (v1):** raw `Command`/`Response` newline-delimited JSON.
//!   Still used by 1magen standalone. Fully supported.
//! - **Envelope (v2):** all messages wrapped in `IpcEnvelope` with
//!   correlation IDs, sequence numbers, source tagging, and optional
//!   HMAC authentication. Supports async events (job results, heartbeats,
//!   capability advertisements) alongside request-response.

pub mod applet;
pub mod envelope;
pub mod protocol;
pub mod shell;

// Legacy (v1) re-exports
pub use protocol::{Command, CommandKind, ModelPath, Response, ResponseStatus};
pub use protocol::{ENV_CMD_PORT, ENV_IPC_SECRET};

// Envelope (v2) re-exports
pub use envelope::{IpcEnvelope, IpcKind, IpcSource};

// Channel re-exports
pub use applet::AppletListener;
pub use shell::ShellChannel;
