//! Strands Chain wallet: local keypair management and chain interaction.
//!
//! Architecture:
//! - Ed25519 keypair generated locally, stored encrypted in profile.db
//! - Address derived from public key (Strands Chain format)
//! - Future: TON-compatible addressing for cross-chain bridge
//! - Transaction signing happens client-side (private key never leaves device)
//!
//! Current status: STUB. Core types and keypair generation are implemented.
//! Chain RPC, token balances, NFT queries, and transaction broadcast are
//! placeholder methods that return mock data until Strands Chain testnet launches.

use anyhow::Result;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tracing::info;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: String,
    pub public_key_hex: String,
    pub balance: WalletBalance,
    pub connected: bool,
    pub chain_id: String,
    pub network: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    /// STRANDS token balance (native gas token)
    pub strands: f64,
    /// Founders Pass NFT count
    pub founders_passes: u32,
    /// Other token balances (key: symbol, value: amount)
    pub tokens: Vec<TokenBalance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBalance {
    pub symbol: String,
    pub name: String,
    pub amount: f64,
    pub decimals: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub token: String,
    pub timestamp: String,
    pub status: TxStatus,
    pub block: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TxStatus {
    Pending,
    Confirmed,
    Failed,
}

// ─── Wallet Manager ─────────────────────────────────────────────────────────

pub struct WalletManager {
    signing_key: Option<SigningKey>,
    address: Option<String>,
}

impl WalletManager {
    pub fn new() -> Self {
        Self {
            signing_key: None,
            address: None,
        }
    }

    /// Generate a new Ed25519 keypair for the wallet.
    pub fn generate_keypair(&mut self) -> Result<WalletInfo> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let pubkey_bytes = verifying_key.to_bytes();
        let pubkey_hex = hex::encode(pubkey_bytes);

        // Strands Chain address: "str1" prefix + first 40 hex chars of pubkey
        let address = format!("str1{}", &pubkey_hex[..40]);

        info!(address = %address, "Generated new wallet keypair");

        self.signing_key = Some(signing_key);
        self.address = Some(address.clone());

        Ok(WalletInfo {
            address,
            public_key_hex: pubkey_hex,
            balance: WalletBalance::default_empty(),
            connected: true,
            chain_id: "strands-testnet-1".into(),
            network: "Strands Chain Testnet".into(),
        })
    }

    /// Import existing keypair from bytes (encrypted storage recovery).
    pub fn import_keypair(&mut self, secret_bytes: &[u8; 32]) -> Result<WalletInfo> {
        let signing_key = SigningKey::from_bytes(secret_bytes);
        let verifying_key = signing_key.verifying_key();
        let pubkey_hex = hex::encode(verifying_key.to_bytes());
        let address = format!("str1{}", &pubkey_hex[..40]);

        self.signing_key = Some(signing_key);
        self.address = Some(address.clone());

        Ok(WalletInfo {
            address,
            public_key_hex: pubkey_hex,
            balance: WalletBalance::default_empty(),
            connected: true,
            chain_id: "strands-testnet-1".into(),
            network: "Strands Chain Testnet".into(),
        })
    }

    /// Get current wallet info (STUB: returns mock balance).
    pub fn get_info(&self) -> Option<WalletInfo> {
        let address = self.address.as_ref()?;
        let pubkey_hex = self
            .signing_key
            .as_ref()
            .map(|sk| hex::encode(sk.verifying_key().to_bytes()))
            .unwrap_or_default();

        Some(WalletInfo {
            address: address.clone(),
            public_key_hex: pubkey_hex,
            balance: WalletBalance::mock(),
            connected: true,
            chain_id: "strands-testnet-1".into(),
            network: "Strands Chain Testnet".into(),
        })
    }

    /// Get transaction history (STUB: returns empty).
    pub fn get_transactions(&self, _limit: usize) -> Vec<Transaction> {
        // TODO: query Strands Chain RPC for transaction history
        vec![]
    }

    /// Disconnect wallet (clear keys from memory).
    pub fn disconnect(&mut self) {
        self.signing_key = None;
        self.address = None;
        info!("Wallet disconnected");
    }

    pub fn is_connected(&self) -> bool {
        self.signing_key.is_some()
    }

    pub fn address(&self) -> Option<&str> {
        self.address.as_deref()
    }
}

impl WalletBalance {
    fn default_empty() -> Self {
        Self {
            strands: 0.0,
            founders_passes: 0,
            tokens: vec![],
        }
    }

    /// Mock balance for development/testnet.
    fn mock() -> Self {
        Self {
            strands: 1000.0,
            founders_passes: 1,
            tokens: vec![TokenBalance {
                symbol: "BLANK".into(),
                name: "Blank Token".into(),
                amount: 500.0,
                decimals: 18,
            }],
        }
    }
}
