//! Applet side of the command channel.
//!
//! Usage in the applet's startup:
//! 1. Check for `EVERYWEAR_CMD_PORT` env var
//! 2. If present, `AppletListener::connect()` to the shell
//! 3. Spawn a task that calls `listener.run(handler)` to process commands
//!
//! The handler is an async closure/fn that receives each `Command` and
//! returns a `Response`. This keeps the protocol logic here; the applet
//! only implements the actual model unload / shutdown logic.

use crate::protocol::{Command, CommandKind, Response, ResponseStatus, ENV_CMD_PORT};
use anyhow::{Context, Result};
use std::future::Future;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tracing::{info, warn};

/// Applet's end of the command channel.
pub struct AppletListener {
    stream: TcpStream,
}

impl AppletListener {
    /// Read the port from the environment and connect to the shell.
    /// Returns `None` if the env var is not set (standalone mode).
    pub async fn connect_from_env() -> Result<Option<Self>> {
        let port_str = match std::env::var(ENV_CMD_PORT) {
            Ok(p) => p,
            Err(_) => {
                info!(
                    "No {} env var; running in standalone mode (no shell IPC)",
                    ENV_CMD_PORT
                );
                return Ok(None);
            }
        };

        let port: u16 = port_str
            .parse()
            .context("invalid EVERYWEAR_CMD_PORT value")?;

        let stream = TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .with_context(|| format!("failed to connect to shell IPC on port {port}"))?;

        info!(port, "Connected to shell IPC channel");
        Ok(Some(Self { stream }))
    }

    /// Run the command loop. Calls `handler` for each incoming command.
    /// Exits when the connection closes or the handler signals shutdown.
    ///
    /// The handler receives a `Command` and returns a `Response`.
    /// For `Shutdown` commands, the handler should perform cleanup and
    /// return `Response::ok()`; this function will then return `true`
    /// to indicate the applet should exit.
    pub async fn run<F, Fut>(self, handler: F) -> Result<bool>
    where
        F: Fn(Command) -> Fut,
        Fut: Future<Output = Response>,
    {
        let (reader_half, mut writer_half) = self.stream.into_split();
        let mut reader = BufReader::new(reader_half);
        let mut line = String::new();
        let mut should_exit = false;

        loop {
            line.clear();
            let n = reader
                .read_line(&mut line)
                .await
                .context("IPC read failed")?;

            if n == 0 {
                // Connection closed by shell
                info!("Shell closed IPC connection");
                break;
            }

            let cmd: Command = match serde_json::from_str(line.trim()) {
                Ok(c) => c,
                Err(e) => {
                    warn!(error = %e, raw = %line.trim(), "Failed to parse IPC command");
                    continue;
                }
            };

            let is_shutdown = matches!(cmd.kind, CommandKind::Shutdown);

            info!(id = %cmd.id, kind = ?cmd.kind, "Received IPC command");
            let resp = handler(cmd).await;

            let mut msg = serde_json::to_string(&resp).context("failed to serialize response")?;
            msg.push('\n');

            writer_half
                .write_all(msg.as_bytes())
                .await
                .context("IPC write failed")?;
            writer_half.flush().await.context("IPC flush failed")?;

            if is_shutdown && resp.status == ResponseStatus::Ok {
                should_exit = true;
                break;
            }
        }

        Ok(should_exit)
    }
}
