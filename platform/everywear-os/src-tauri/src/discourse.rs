//! Discourse forum integration: OAuth SSO and activity feed.
//!
//! Provides single sign-on with the Strands Nation Discourse instance
//! so users are logged into the community from within Everywear OS.
//!
//! Flow:
//! 1. User clicks "Connect Discourse" in profile panel
//! 2. Shell opens Discourse OAuth URL in system browser
//! 3. Discourse redirects back with auth code
//! 4. Shell exchanges code for session token
//! 5. Token stored in profile.db, used for API calls
//!
//! Features:
//! - SSO login/logout
//! - Activity feed (latest posts, notifications)
//! - Unread notification count badge
//! - Direct link to topics from shell UI

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::info;

const DISCOURSE_BASE: &str = "https://forum.strandsnation.xyz";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseUser {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub trust_level: u8,
    pub unread_notifications: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoursePost {
    pub id: u64,
    pub topic_title: String,
    pub topic_url: String,
    pub author: String,
    pub excerpt: String,
    pub created_at: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseNotification {
    pub id: u64,
    pub notification_type: String,
    pub read: bool,
    pub topic_title: Option<String>,
    pub topic_url: Option<String>,
    pub created_at: String,
}

pub struct DiscourseClient {
    session_token: Option<String>,
    username: Option<String>,
}

impl DiscourseClient {
    pub fn new() -> Self {
        Self {
            session_token: None,
            username: None,
        }
    }

    /// Set session from stored profile data.
    pub fn restore_session(&mut self, username: &str, token: &str) {
        self.username = Some(username.to_string());
        self.session_token = Some(token.to_string());
        info!(username, "Discourse session restored");
    }

    /// Generate the OAuth URL to open in the system browser.
    pub fn oauth_url(&self) -> String {
        format!("{DISCOURSE_BASE}/session/sso_provider?return_url=everywear://discourse-callback")
    }

    /// Exchange OAuth callback payload for session token.
    pub async fn complete_oauth(&mut self, sso_payload: &str, sig: &str) -> Result<DiscourseUser> {
        // TODO: implement actual Discourse SSO exchange
        // For now return a stub user
        let user = DiscourseUser {
            username: "somo_kasane".into(),
            name: Some("Somo Kasane".into()),
            avatar_url: None,
            trust_level: 3,
            unread_notifications: 0,
        };
        self.username = Some(user.username.clone());
        self.session_token = Some("stub-session-token".into());
        info!(username = %user.username, "Discourse OAuth completed");
        Ok(user)
    }

    /// Get current user info.
    pub async fn get_user(&self) -> Result<Option<DiscourseUser>> {
        let token = match &self.session_token {
            Some(t) => t,
            None => return Ok(None),
        };
        let username = self.username.as_deref().unwrap_or("unknown");

        // TODO: GET {DISCOURSE_BASE}/u/{username}.json with Api-Key header
        Ok(Some(DiscourseUser {
            username: username.into(),
            name: Some("Somo Kasane".into()),
            avatar_url: None,
            trust_level: 3,
            unread_notifications: 2,
        }))
    }

    /// Get latest posts feed.
    pub async fn latest_posts(&self, limit: usize) -> Result<Vec<DiscoursePost>> {
        if self.session_token.is_none() {
            return Ok(vec![]);
        }
        // TODO: GET {DISCOURSE_BASE}/posts.json with session header
        Ok(vec![])
    }

    /// Get unread notifications.
    pub async fn notifications(&self) -> Result<Vec<DiscourseNotification>> {
        if self.session_token.is_none() {
            return Ok(vec![]);
        }
        // TODO: GET {DISCOURSE_BASE}/notifications.json
        Ok(vec![])
    }

    pub fn is_connected(&self) -> bool {
        self.session_token.is_some()
    }

    pub fn disconnect(&mut self) {
        self.session_token = None;
        self.username = None;
        info!("Discourse session cleared");
    }
}
