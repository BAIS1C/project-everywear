//! Discourse forum integration: OAuth2 PKCE and activity/API access.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use rand::RngCore;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::info;

const DEFAULT_DISCOURSE_BASE: &str = "https://forum.strandsnation.xyz";
const DEFAULT_REDIRECT_URI: &str = "everywear://discourse-callback";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseUser {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub trust_level: u8,
    pub unread_notifications: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseTopic {
    pub id: u64,
    pub title: String,
    pub slug: String,
    pub posts_count: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseTopicList {
    pub topics: Vec<DiscourseTopic>,
    pub total: usize,
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
pub struct DiscoursePostDetail {
    pub id: u64,
    pub topic_id: Option<u64>,
    pub topic_slug: Option<String>,
    pub author: String,
    pub raw: Option<String>,
    pub cooked: Option<String>,
    pub created_at: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePostRequest {
    pub title: Option<String>,
    pub raw: String,
    pub topic_id: Option<u64>,
    pub category: Option<u64>,
}

#[derive(Debug, Clone)]
struct PkceState {
    state: String,
    verifier: String,
}

pub struct DiscourseClient {
    http: reqwest::Client,
    base_url: String,
    client_id: String,
    redirect_uri: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    username: Option<String>,
    everywear_user_id: Option<String>,
    everywear_email: Option<String>,
    pending_pkce: Option<PkceState>,
}

impl DiscourseClient {
    pub fn new() -> Self {
        Self::with_base_url(
            std::env::var("EVERYWEAR_DISCOURSE_BASE")
                .unwrap_or_else(|_| DEFAULT_DISCOURSE_BASE.to_string()),
        )
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client_id: std::env::var("EVERYWEAR_DISCOURSE_CLIENT_ID")
                .unwrap_or_else(|_| "everywear-os".into()),
            redirect_uri: std::env::var("EVERYWEAR_DISCOURSE_REDIRECT_URI")
                .unwrap_or_else(|_| DEFAULT_REDIRECT_URI.into()),
            access_token: None,
            refresh_token: None,
            username: None,
            everywear_user_id: None,
            everywear_email: None,
            pending_pkce: None,
        }
    }

    pub fn set_everywear_identity(&mut self, user: Option<&crate::auth::UserClaim>) {
        self.everywear_user_id = user.map(|claim| claim.sub.clone());
        self.everywear_email = user.and_then(|claim| claim.email.clone());
    }

    /// Set session from stored profile data.
    pub fn restore_session(&mut self, username: &str, token: &str) {
        self.username = Some(username.to_string());
        self.access_token = Some(token.to_string());
        info!(username, "Discourse session restored");
    }

    /// Generate the OAuth2 PKCE URL to open in the system browser.
    pub fn oauth_url(&mut self) -> String {
        let verifier = random_url_token(48);
        let state = random_url_token(24);
        let challenge = pkce_challenge(&verifier);
        self.pending_pkce = Some(PkceState {
            state: state.clone(),
            verifier,
        });

        format!(
            "{}/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
            self.base_url,
            percent_encode(&self.client_id),
            percent_encode(&self.redirect_uri),
            percent_encode("read write"),
            percent_encode(&state),
            percent_encode(&challenge),
        )
    }

    /// Exchange OAuth callback code for an access token.
    pub async fn complete_oauth(&mut self, code: &str, state: &str) -> Result<DiscourseUser> {
        let pkce = self
            .pending_pkce
            .take()
            .ok_or_else(|| anyhow!("OAuth flow was not started"))?;
        if pkce.state != state {
            return Err(anyhow!("OAuth state mismatch"));
        }

        let token: TokenResponse = self
            .http
            .post(format!("{}/oauth2/token", self.base_url))
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", self.client_id.as_str()),
                ("code", code),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("code_verifier", pkce.verifier.as_str()),
            ])
            .send()
            .await
            .context("Discourse OAuth token request failed")?
            .error_for_status()
            .context("Discourse OAuth token exchange failed")?
            .json()
            .await
            .context("Discourse OAuth token response was not JSON")?;

        self.access_token = Some(token.access_token);
        self.refresh_token = token.refresh_token;
        if let Some(username) = token.username {
            self.username = Some(username);
        }

        let user = self
            .get_user()
            .await?
            .ok_or_else(|| anyhow!("Discourse did not return a current user"))?;
        info!(username = %user.username, "Discourse OAuth completed");
        Ok(user)
    }

    pub async fn refresh_access_token(&mut self) -> Result<()> {
        let refresh = self
            .refresh_token
            .as_deref()
            .ok_or_else(|| anyhow!("no Discourse refresh token"))?;
        let token: TokenResponse = self
            .http
            .post(format!("{}/oauth2/token", self.base_url))
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        self.access_token = Some(token.access_token);
        self.refresh_token = token.refresh_token.or_else(|| Some(refresh.to_string()));
        Ok(())
    }

    pub async fn get_user(&self) -> Result<Option<DiscourseUser>> {
        if self.access_token.is_none() {
            return Ok(None);
        }
        let value = self.get_json("/session/current.json").await?;
        let current = value.get("current_user").unwrap_or(&value);
        let username = current
            .get("username")
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| self.username.as_deref().unwrap_or("unknown"))
            .to_string();
        Ok(Some(DiscourseUser {
            username,
            name: current
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            avatar_url: current
                .get("avatar_template")
                .or_else(|| current.get("avatar_url"))
                .and_then(|value| value.as_str())
                .map(|avatar| expand_avatar_url(&self.base_url, avatar)),
            trust_level: current
                .get("trust_level")
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u8,
            unread_notifications: current
                .get("unread_notifications")
                .or_else(|| current.get("unread_notifications_count"))
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u32,
        }))
    }

    pub async fn list_topics(
        &self,
        category_id: Option<u64>,
        page: Option<u32>,
    ) -> Result<DiscourseTopicList> {
        let path = if let Some(category_id) = category_id {
            format!("/c/{category_id}.json?page={}", page.unwrap_or(0))
        } else {
            format!("/latest.json?page={}", page.unwrap_or(0))
        };
        let value = self.get_json(&path).await?;
        let topics = value
            .pointer("/topic_list/topics")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(topic_from_value)
            .collect::<Vec<_>>();
        let total = topics.len();
        Ok(DiscourseTopicList { topics, total })
    }

    pub async fn read_post(&self, post_id: u64) -> Result<DiscoursePostDetail> {
        let value = self.get_json(&format!("/posts/{post_id}.json")).await?;
        Ok(post_detail_from_value(value))
    }

    pub async fn create_post(&self, request: CreatePostRequest) -> Result<DiscoursePostDetail> {
        let value = self.post_json("/posts.json", &request).await?;
        Ok(post_detail_from_value(value))
    }

    /// Get latest posts feed.
    pub async fn latest_posts(&self, limit: usize) -> Result<Vec<DiscoursePost>> {
        if self.access_token.is_none() {
            return Ok(vec![]);
        }
        let value = self.get_json("/posts.json").await?;
        let posts = value
            .get("latest_posts")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .take(limit)
            .map(|post| post_from_value(&self.base_url, post))
            .collect();
        Ok(posts)
    }

    pub async fn notifications(&self) -> Result<Vec<DiscourseNotification>> {
        if self.access_token.is_none() {
            return Ok(vec![]);
        }
        let value = self.get_json("/notifications.json").await?;
        let notifications = value
            .get("notifications")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(notification_from_value)
            .collect();
        Ok(notifications)
    }

    pub fn is_connected(&self) -> bool {
        self.access_token.is_some()
    }

    pub fn disconnect(&mut self) {
        self.access_token = None;
        self.refresh_token = None;
        self.username = None;
        self.pending_pkce = None;
        info!("Discourse session cleared");
    }

    async fn get_json(&self, path: &str) -> Result<serde_json::Value> {
        self.http
            .get(format!("{}{}", self.base_url, path))
            .headers(self.auth_headers()?)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .context("Discourse response was not JSON")
    }

    async fn post_json<T: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<serde_json::Value> {
        self.http
            .post(format!("{}{}", self.base_url, path))
            .headers(self.auth_headers()?)
            .json(body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .context("Discourse response was not JSON")
    }

    fn auth_headers(&self) -> Result<HeaderMap> {
        let token = self
            .access_token
            .as_deref()
            .ok_or_else(|| anyhow!("DISCOURSE_NOT_AUTHENTICATED"))?;
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}"))?,
        );
        if let Some(user_id) = &self.everywear_user_id {
            headers.insert("X-Everywear-User-Id", HeaderValue::from_str(user_id)?);
        }
        if let Some(email) = &self.everywear_email {
            headers.insert("X-Everywear-Email", HeaderValue::from_str(email)?);
        }
        Ok(headers)
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    username: Option<String>,
}

fn topic_from_value(value: serde_json::Value) -> DiscourseTopic {
    DiscourseTopic {
        id: value
            .get("id")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
        title: value
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        slug: value
            .get("slug")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        posts_count: value
            .get("posts_count")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
        created_at: value
            .get("created_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

fn post_detail_from_value(value: serde_json::Value) -> DiscoursePostDetail {
    DiscoursePostDetail {
        id: value
            .get("id")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
        topic_id: value.get("topic_id").and_then(|value| value.as_u64()),
        topic_slug: value
            .get("topic_slug")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        author: value
            .get("username")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        raw: value
            .get("raw")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        cooked: value
            .get("cooked")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        created_at: value
            .get("created_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

fn post_from_value(base_url: &str, value: serde_json::Value) -> DiscoursePost {
    let topic_id = value
        .get("topic_id")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let topic_slug = value
        .get("topic_slug")
        .and_then(|value| value.as_str())
        .unwrap_or("topic");
    DiscoursePost {
        id: value
            .get("id")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
        topic_title: value
            .get("topic_title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        topic_url: format!("{}/t/{}/{}", base_url, topic_slug, topic_id),
        author: value
            .get("username")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        excerpt: value
            .get("cooked")
            .or_else(|| value.get("excerpt"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        created_at: value
            .get("created_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        category: value
            .get("category_slug")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

fn notification_from_value(value: serde_json::Value) -> DiscourseNotification {
    DiscourseNotification {
        id: value
            .get("id")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
        notification_type: value
            .get("notification_type")
            .and_then(|value| value.as_i64())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into()),
        read: value
            .get("read")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        topic_title: value
            .get("topic_title")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        topic_url: value
            .get("topic_url")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        created_at: value
            .get("created_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

fn random_url_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn expand_avatar_url(base_url: &str, avatar: &str) -> String {
    let sized = avatar.replace("{size}", "96");
    if sized.starts_with("http") {
        sized
    } else {
        format!("{base_url}{sized}")
    }
}

fn percent_encode(input: &str) -> String {
    input
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn serve_once(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0; 2048];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).expect("write");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn list_topics_maps_mock_response() {
        let base = serve_once(
            r#"{"topic_list":{"topics":[{"id":7,"title":"Hello","slug":"hello","posts_count":2,"created_at":"2026-05-18T00:00:00Z"}]}}"#,
        );
        let mut client = DiscourseClient::with_base_url(base);
        client.restore_session("somo", "token");

        let topics = client.list_topics(None, None).await.expect("topics");
        assert_eq!(topics.total, 1);
        assert_eq!(topics.topics[0].title, "Hello");
    }

    #[tokio::test]
    async fn read_post_maps_mock_response() {
        let base = serve_once(
            r#"{"id":9,"topic_id":7,"topic_slug":"hello","username":"somo","raw":"Raw post","created_at":"2026-05-18T00:00:00Z"}"#,
        );
        let mut client = DiscourseClient::with_base_url(base);
        client.restore_session("somo", "token");

        let post = client.read_post(9).await.expect("post");
        assert_eq!(post.id, 9);
        assert_eq!(post.author, "somo");
        assert_eq!(post.raw.as_deref(), Some("Raw post"));
    }
}
