//! Shell side of the applet IPC channel.
//!
//! The shell binds a localhost listener, passes `EVERYWEAR_CMD_PORT` to the
//! child, then accepts a single newline-delimited JSON stream. New applets use
//! `IpcEnvelope`; legacy raw `Command`/`Response` messages are still supported.

use crate::envelope::{IpcEnvelope, IpcKind};
use crate::protocol::{Command, CommandKind, Response, ENV_CMD_PORT};
use anyhow::{anyhow, bail, Context, Result};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};

type SharedWriter = Arc<Mutex<OwnedWriteHalf>>;

/// Shell's end of the command channel to a single applet.
pub struct ShellChannel {
    listener: TcpListener,
    port: u16,
    writer: Option<SharedWriter>,
    legacy_rx: Option<mpsc::Receiver<Response>>,
    response_rx: Option<mpsc::Receiver<IpcEnvelope>>,
    event_rx: Option<mpsc::Receiver<IpcEnvelope>>,
    seq: u64,
    ipc_secret: Option<String>,
    envelope_mode: bool,
}

impl ShellChannel {
    /// Bind a listener on localhost with an OS-assigned port.
    pub async fn bind() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("failed to bind IPC listener on localhost")?;

        let port = listener
            .local_addr()
            .context("failed to get listener address")?
            .port();

        info!(port, "IPC listener bound");

        Ok(Self {
            listener,
            port,
            writer: None,
            legacy_rx: None,
            response_rx: None,
            event_rx: None,
            seq: 1,
            ipc_secret: None,
            envelope_mode: false,
        })
    }

    /// The port number to pass to the child process.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The env key-value pair to set on the child process.
    pub fn env_pair(&self) -> (&'static str, String) {
        (ENV_CMD_PORT, self.port.to_string())
    }

    /// Set the per-launch HMAC secret used to verify the first advertisement.
    pub fn set_ipc_secret(&mut self, secret: impl Into<String>) {
        self.ipc_secret = Some(secret.into());
    }

    /// Wait for the applet to connect. Call this after spawning the child.
    pub async fn accept(&mut self, timeout: std::time::Duration) -> Result<()> {
        let accept_fut = self.listener.accept();
        let (stream, addr) = tokio::time::timeout(timeout, accept_fut)
            .await
            .context("applet did not connect within timeout")?
            .context("accept failed")?;

        info!(%addr, "Applet connected to IPC channel");

        let (reader_half, writer_half) = stream.into_split();
        let writer = Arc::new(Mutex::new(writer_half));
        let (legacy_tx, legacy_rx) = mpsc::channel(32);
        let (response_tx, response_rx) = mpsc::channel(32);
        let (event_tx, event_rx) = mpsc::channel(64);

        tokio::spawn(async move {
            let mut reader = BufReader::new(reader_half);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        info!("Applet IPC reader reached EOF");
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        route_inbound_line(trimmed, &legacy_tx, &response_tx, &event_tx).await;
                    }
                    Err(error) => {
                        warn!(%error, "Applet IPC read failed");
                        break;
                    }
                }
            }
        });

        self.writer = Some(writer);
        self.legacy_rx = Some(legacy_rx);
        self.response_rx = Some(response_rx);
        self.event_rx = Some(event_rx);
        Ok(())
    }

    /// Send a legacy command and wait for a legacy response.
    pub async fn send(&mut self, cmd: &Command, timeout: std::time::Duration) -> Result<Response> {
        let mut msg = serde_json::to_string(cmd).context("failed to serialize command")?;
        msg.push('\n');
        self.write_line(&msg).await?;

        let rx = self
            .legacy_rx
            .as_mut()
            .context("legacy response queue unavailable; call accept() first")?;

        loop {
            let response = recv_timeout(rx, timeout)
                .await
                .context("applet did not send a legacy response within timeout")?;
            if response.id == cmd.id {
                return Ok(response);
            }

            warn!(
                expected = %cmd.id,
                got = %response.id,
                "Ignoring legacy response ID mismatch"
            );
        }
    }

    /// Send an envelope command and wait for its envelope response.
    pub async fn send_envelope_command(
        &mut self,
        command: CommandKind,
        timeout: std::time::Duration,
    ) -> Result<Response> {
        let payload =
            serde_json::to_value(command).context("failed to serialize command payload")?;
        let envelope = IpcEnvelope::command(payload).with_seq(self.next_seq());
        let request_id = envelope.id.clone();

        self.write_envelope(&envelope).await?;

        let rx = self
            .response_rx
            .as_mut()
            .context("envelope response queue unavailable; call accept() first")?;

        loop {
            let response_envelope = recv_timeout(rx, timeout)
                .await
                .context("applet did not send an envelope response within timeout")?;
            if response_envelope.id != request_id {
                warn!(
                    expected = %request_id,
                    got = %response_envelope.id,
                    "Ignoring envelope response ID mismatch"
                );
                continue;
            }

            return serde_json::from_value(response_envelope.payload)
                .context("failed to parse envelope response payload");
        }
    }

    /// Wait for a signed AdvertiseCapabilities event from the applet.
    pub async fn await_advertisement(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<serde_json::Value> {
        let rx = self
            .event_rx
            .as_mut()
            .context("event queue unavailable; call accept() first")?;

        loop {
            let envelope = recv_timeout(rx, timeout)
                .await
                .context("applet did not advertise capabilities within timeout")?;
            let command: CommandKind = match serde_json::from_value(envelope.payload.clone()) {
                Ok(command) => command,
                Err(_) => {
                    debug!(payload = ?envelope.payload, "Ignoring non-command event payload");
                    continue;
                }
            };

            if let CommandKind::AdvertiseCapabilities { capabilities } = command {
                self.verify_signed_advertisement(&envelope)?;
                self.envelope_mode = true;
                return Ok(capabilities);
            }
        }
    }

    /// Take the event queue so the shell can run a lifecycle event pump.
    pub fn take_event_rx(&mut self) -> Option<mpsc::Receiver<IpcEnvelope>> {
        self.event_rx.take()
    }

    /// Convenience: send UnloadModel and wait for ack.
    pub async fn unload_model(&mut self, timeout: std::time::Duration) -> Result<Response> {
        if self.envelope_mode {
            self.send_envelope_command(CommandKind::UnloadModel, timeout)
                .await
        } else {
            let cmd = Command::new(CommandKind::UnloadModel);
            self.send(&cmd, timeout).await
        }
    }

    /// Convenience: send Shutdown and wait for ack.
    pub async fn shutdown(&mut self, timeout: std::time::Duration) -> Result<Response> {
        if self.envelope_mode {
            self.send_envelope_command(CommandKind::Shutdown, timeout)
                .await
        } else {
            let cmd = Command::new(CommandKind::Shutdown);
            self.send(&cmd, timeout).await
        }
    }

    async fn write_envelope(&self, envelope: &IpcEnvelope) -> Result<()> {
        let mut line = serde_json::to_string(envelope).context("failed to serialize envelope")?;
        line.push('\n');
        self.write_line(&line).await
    }

    async fn write_line(&self, line: &str) -> Result<()> {
        let writer = self
            .writer
            .as_ref()
            .context("no applet connected; call accept() first")?;
        let mut writer = writer.lock().await;
        writer
            .write_all(line.as_bytes())
            .await
            .context("failed to send IPC message")?;
        writer.flush().await.context("failed to flush IPC message")
    }

    fn next_seq(&mut self) -> u64 {
        let seq = self.seq;
        self.seq = self.seq.saturating_add(1);
        seq
    }

    fn verify_signed_advertisement(&self, envelope: &IpcEnvelope) -> Result<()> {
        let secret = self
            .ipc_secret
            .as_deref()
            .context("cannot verify advertisement without IPC secret")?;
        let hmac = envelope
            .hmac
            .as_deref()
            .context("advertisement missing HMAC signature")?;
        let payload = serde_json::to_vec(&envelope.payload)
            .context("failed to serialize advertisement payload for HMAC")?;

        verify_hmac(secret.as_bytes(), &payload, hmac)
    }
}

async fn route_inbound_line(
    line: &str,
    legacy_tx: &mpsc::Sender<Response>,
    response_tx: &mpsc::Sender<IpcEnvelope>,
    event_tx: &mpsc::Sender<IpcEnvelope>,
) {
    if let Ok(envelope) = serde_json::from_str::<IpcEnvelope>(line) {
        match envelope.kind {
            IpcKind::Response => {
                let _ = response_tx.send(envelope).await;
            }
            IpcKind::Event => {
                let _ = event_tx.send(envelope).await;
            }
            IpcKind::Command => {
                warn!(payload = ?envelope.payload, "Applet sent unexpected command envelope");
            }
        }
        return;
    }

    match serde_json::from_str::<Response>(line) {
        Ok(response) => {
            let _ = legacy_tx.send(response).await;
        }
        Err(error) => {
            warn!(%error, raw = line, "Failed to parse inbound applet IPC line");
        }
    }
}

async fn recv_timeout<T>(rx: &mut mpsc::Receiver<T>, timeout: std::time::Duration) -> Result<T> {
    tokio::time::timeout(timeout, rx.recv())
        .await
        .map_err(|_| anyhow!("receive timed out"))?
        .ok_or_else(|| anyhow!("IPC channel closed"))
}

#[cfg(feature = "hmac")]
fn verify_hmac(secret: &[u8], payload: &[u8], expected: &str) -> Result<()> {
    if crate::envelope::verify_hmac(secret, payload, expected) {
        Ok(())
    } else {
        bail!("advertisement HMAC verification failed")
    }
}

#[cfg(not(feature = "hmac"))]
fn verify_hmac(_secret: &[u8], _payload: &[u8], _expected: &str) -> Result<()> {
    bail!("applet-ipc hmac feature is required to verify signed advertisements")
}
