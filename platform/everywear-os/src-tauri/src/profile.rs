//! Profile and identity layer for Everywear OS.
//!
//! Stores the user's local identity, display preferences, and
//! linked external accounts (Discourse, Strands Chain wallet).
//! All data persisted in a local SQLite database.

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub email: Option<String>,
    pub avatar_path: Option<String>,
    pub bio: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Linked accounts
    pub discourse_username: Option<String>,
    pub discourse_session_valid: bool,
    pub wallet_address: Option<String>,
    pub wallet_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileUpdate {
    pub display_name: Option<String>,
    pub alias: Option<String>,
    pub email: Option<String>,
    pub avatar_path: Option<String>,
    pub bio: Option<String>,
}

pub struct ProfileManager {
    db_path: PathBuf,
}

impl ProfileManager {
    pub fn new() -> Self {
        let db_path = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("everywear")
            .join("profile.db");

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let mgr = Self { db_path };
        mgr.init_db().ok();
        mgr
    }

    fn init_db(&self) -> Result<()> {
        let conn = Connection::open(&self.db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS profile (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                alias TEXT,
                email TEXT,
                avatar_path TEXT,
                bio TEXT,
                discourse_username TEXT,
                discourse_session_token TEXT,
                wallet_address TEXT,
                wallet_pubkey BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    /// Get the current user profile, or create a default one.
    pub fn get_profile(&self) -> Result<UserProfile> {
        let conn = Connection::open(&self.db_path)?;
        let mut stmt = conn.prepare(
            "SELECT id, display_name, alias, email, avatar_path, bio,
                    discourse_username, discourse_session_token, wallet_address,
                    created_at, updated_at
             FROM profile LIMIT 1",
        )?;

        let result = stmt.query_row([], |row| {
            let discourse_token: Option<String> = row.get(7)?;
            let wallet_addr: Option<String> = row.get(8)?;
            Ok(UserProfile {
                id: row.get(0)?,
                display_name: row.get(1)?,
                alias: row.get(2)?,
                email: row.get(3)?,
                avatar_path: row.get(4)?,
                bio: row.get(5)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                discourse_username: row.get(6)?,
                discourse_session_valid: discourse_token.is_some(),
                wallet_address: wallet_addr.clone(),
                wallet_connected: wallet_addr.is_some(),
            })
        });

        match result {
            Ok(profile) => Ok(profile),
            Err(_) => {
                // First launch: create default profile
                let id = uuid::Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute(
                    "INSERT INTO profile (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![id, "Everywear User", now, now],
                )?;
                info!("Created default profile");
                Ok(UserProfile {
                    id,
                    display_name: "Everywear User".into(),
                    alias: None,
                    email: None,
                    avatar_path: None,
                    bio: None,
                    created_at: now.clone(),
                    updated_at: now,
                    discourse_username: None,
                    discourse_session_valid: false,
                    wallet_address: None,
                    wallet_connected: false,
                })
            }
        }
    }

    /// Update profile fields.
    pub fn update_profile(&self, update: ProfileUpdate) -> Result<UserProfile> {
        let conn = Connection::open(&self.db_path)?;
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(name) = &update.display_name {
            conn.execute(
                "UPDATE profile SET display_name = ?1, updated_at = ?2",
                rusqlite::params![name, now],
            )?;
        }
        if let Some(alias) = &update.alias {
            conn.execute(
                "UPDATE profile SET alias = ?1, updated_at = ?2",
                rusqlite::params![alias, now],
            )?;
        }
        if let Some(email) = &update.email {
            conn.execute(
                "UPDATE profile SET email = ?1, updated_at = ?2",
                rusqlite::params![email, now],
            )?;
        }
        if let Some(avatar) = &update.avatar_path {
            conn.execute(
                "UPDATE profile SET avatar_path = ?1, updated_at = ?2",
                rusqlite::params![avatar, now],
            )?;
        }
        if let Some(bio) = &update.bio {
            conn.execute(
                "UPDATE profile SET bio = ?1, updated_at = ?2",
                rusqlite::params![bio, now],
            )?;
        }

        self.get_profile()
    }

    /// Store Discourse session after OAuth.
    pub fn link_discourse(&self, username: &str, session_token: &str) -> Result<()> {
        let conn = Connection::open(&self.db_path)?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE profile SET discourse_username = ?1, discourse_session_token = ?2, updated_at = ?3",
            rusqlite::params![username, session_token, now],
        )?;
        info!(username, "Discourse account linked");
        Ok(())
    }

    /// Store wallet address after connection.
    pub fn link_wallet(&self, address: &str, pubkey: &[u8]) -> Result<()> {
        let conn = Connection::open(&self.db_path)?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE profile SET wallet_address = ?1, wallet_pubkey = ?2, updated_at = ?3",
            rusqlite::params![address, pubkey, now],
        )?;
        info!(address, "Wallet linked");
        Ok(())
    }

    /// Get a user preference by key.
    pub fn get_pref(&self, key: &str) -> Option<String> {
        let conn = Connection::open(&self.db_path).ok()?;
        conn.query_row(
            "SELECT value FROM preferences WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .ok()
    }

    /// Set a user preference.
    pub fn set_pref(&self, key: &str, value: &str) -> Result<()> {
        let conn = Connection::open(&self.db_path)?;
        conn.execute(
            "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }
}
