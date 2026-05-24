//! Supabase auth integration for Everywear OS shell.
//!
//! The shell owns the user session. Auth flow:
//!   1. EWDS frontend calls Supabase `signInWithOtp` / `signInWithPassword`
//!   2. On session, frontend calls `active_tier()` RPC for canonical tier
//!   3. Frontend invokes `push_auth_state` Tauri command with JWT + tier
//!   4. This module parses the JWT (unverified Phase 1), extracts user
//!      claims, updates AppState.user_session and AppState.licence_tier
//!   5. On applet launch, shell reads licence_tier for upgrade pack gating
//!   6. Shell broadcasts signed TierSync to connected applets via IPC
//!
//! Authority split (per 2026-04-21 architecture lock):
//!   - Hub (Supabase) is the ONLY writer of tier
//!   - Shell is read-only sync broker + launch gate
//!   - Applets enforce internally via HMAC-verified TierSync
//!
//! Phase 1: unverified JWT parse (same threat model as s-gener8:
//!   shell binds localhost, CORS blocks cross-origin).
//! Phase 2 (tracked): JWKS-based ES256 verification against
//!   `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`.

use base64::Engine as _;
use model_manager::LicenceTier;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// User claim (extracted from Supabase JWT)
// ---------------------------------------------------------------------------

/// Parsed user identity from a Supabase JWT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserClaim {
    /// Supabase user UUID (`sub` claim).
    pub sub: String,
    /// Everywear handle (from `user_metadata.handle` or `handle` claim).
    pub handle: Option<String>,
    /// Email address.
    pub email: Option<String>,
    /// Human display name from Supabase user metadata, when present.
    pub display_name: Option<String>,
    /// JWT expiry (unix timestamp).
    pub exp: i64,
}

impl UserClaim {
    /// Filesystem-safe key for per-user directories.
    pub fn folder_key(&self) -> String {
        if let Some(h) = self.handle.as_deref() {
            let cleaned: String = h
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .take(64)
                .collect();
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
        sanitise_for_path(&self.sub)
    }
}

fn sanitise_for_path(uid: &str) -> String {
    let cleaned: String = uid
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "unknown".into()
    } else {
        cleaned
    }
}

// ---------------------------------------------------------------------------
// JWT parsing (Phase 1: unverified)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum AuthError {
    Missing,
    Malformed,
    Expired,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Missing => write!(f, "no authorization token"),
            AuthError::Malformed => write!(f, "malformed JWT"),
            AuthError::Expired => write!(f, "token expired"),
        }
    }
}

impl std::error::Error for AuthError {}

#[derive(Deserialize)]
struct RawClaims {
    sub: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    exp: Option<i64>,
    #[serde(default)]
    user_metadata: Option<serde_json::Value>,
    #[serde(default)]
    handle: Option<String>,
}

fn metadata_string(metadata: Option<&serde_json::Value>, keys: &[&str]) -> Option<String> {
    let metadata = metadata?;
    keys.iter()
        .filter_map(|key| metadata.get(*key))
        .filter_map(|value| value.as_str())
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

/// Strip "Bearer " prefix from an Authorization header value.
pub fn strip_bearer(authz: Option<&str>) -> Result<&str, AuthError> {
    let header = authz.ok_or(AuthError::Missing)?;
    let token = header.strip_prefix("Bearer ").unwrap_or(header);
    if token.is_empty() {
        return Err(AuthError::Missing);
    }
    Ok(token)
}

/// Parse a Supabase JWT without signature verification.
/// Extracts sub (user UUID), handle, email, exp.
pub fn parse_jwt_unverified(token: &str) -> Result<UserClaim, AuthError> {
    let payload_b64 = token.split('.').nth(1).ok_or(AuthError::Malformed)?;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload_b64))
        .map_err(|_| AuthError::Malformed)?;
    let raw: RawClaims =
        serde_json::from_slice(&payload_bytes).map_err(|_| AuthError::Malformed)?;

    let sub = raw.sub.ok_or(AuthError::Malformed)?;
    let exp = raw.exp.unwrap_or(0);

    // Soft expiry check with 60s skew tolerance
    if exp > 0 {
        let now = chrono::Utc::now().timestamp();
        if now > exp + 60 {
            return Err(AuthError::Expired);
        }
    }

    // Handle: try top-level claim first, then user_metadata.handle
    let handle = raw
        .handle
        .or_else(|| metadata_string(raw.user_metadata.as_ref(), &["handle", "username"]));
    let display_name = metadata_string(
        raw.user_metadata.as_ref(),
        &["display_name", "name", "full_name"],
    );

    Ok(UserClaim {
        sub,
        handle,
        email: raw.email,
        display_name,
        exp,
    })
}

// ---------------------------------------------------------------------------
// Tier claim (pushed from frontend after active_tier() RPC)
// ---------------------------------------------------------------------------

/// Incoming auth + tier state from the EWDS frontend.
/// Frontend calls Supabase `active_tier()` RPC and pushes the result here.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthStateUpdate {
    /// Raw JWT from Supabase session (for user claim extraction).
    #[serde(default)]
    pub access_token: Option<String>,
    /// Canonical tier string from `active_tier()` RPC.
    pub tier: String,
    /// JWT expiry (optional, for staleness detection).
    #[serde(default)]
    pub exp: Option<i64>,
}

/// Result of an auth state update.
#[derive(Debug, Clone, Serialize)]
pub struct AuthReport {
    pub user_id: Option<String>,
    pub handle: Option<String>,
    pub email: Option<String>,
    pub tier: &'static str,
    pub is_paid: bool,
    pub is_pro: bool,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Called by EWDS frontend on every auth hydration (login, token refresh).
/// Updates the shell's user session and licence tier.
#[tauri::command]
pub async fn push_auth_state(
    state: tauri::State<'_, crate::AppState>,
    update: AuthStateUpdate,
) -> Result<AuthReport, String> {
    // Parse tier
    let tier = LicenceTier::from_tier_str(&update.tier).ok_or_else(|| {
        format!(
            "unknown tier '{}'; expected demo/gener8/gener8_pro/creator_studio",
            update.tier
        )
    })?;

    // Parse JWT for user claims (if provided)
    let user_claim = if let Some(ref token) = update.access_token {
        match parse_jwt_unverified(token) {
            Ok(claim) => {
                info!(
                    user = %claim.sub,
                    handle = ?claim.handle,
                    tier = tier.as_str(),
                    "Auth state updated"
                );
                Some(claim)
            }
            Err(e) => {
                warn!(error = %e, "JWT parse failed; updating tier without user claims");
                None
            }
        }
    } else {
        None
    };

    // Update AppState
    {
        let mut tier_lock = state.licence_tier.lock().await;
        *tier_lock = tier;
    }
    {
        let mut session_lock = state.user_session.lock().await;
        *session_lock = user_claim.clone();
    }
    if let Some(claim) = user_claim.as_ref() {
        let profile = state.profile.lock().await;
        if let Err(error) = profile.sync_auth_identity(claim) {
            warn!(error = %error, "failed to sync auth identity into local profile");
        }
    }

    Ok(AuthReport {
        user_id: user_claim.as_ref().map(|c| c.sub.clone()),
        handle: user_claim.as_ref().and_then(|c| c.handle.clone()),
        email: user_claim.as_ref().and_then(|c| c.email.clone()),
        tier: tier.as_str(),
        is_paid: tier.is_paid(),
        is_pro: tier.is_pro(),
    })
}

/// Returns current auth context for applet webviews.
/// Applets call this via Tauri invoke to get user + tier without
/// needing their own Supabase client.
#[tauri::command]
pub async fn get_auth_context(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let session = state.user_session.lock().await;
    let tier = state.licence_tier.lock().await;

    match session.as_ref() {
        Some(claim) => Ok(Some(serde_json::json!({
            "id": claim.sub,
            "email": claim.email,
            "username": claim.handle.as_deref().unwrap_or(""),
            "tier": tier.as_str(),
            "is_paid": tier.is_paid(),
            "is_pro": tier.is_pro(),
        }))),
        None => Ok(None),
    }
}

/// Returns the current licence tier report.
#[tauri::command]
pub async fn check_licence(state: tauri::State<'_, crate::AppState>) -> Result<AuthReport, String> {
    let tier = *state.licence_tier.lock().await;
    let session = state.user_session.lock().await;

    Ok(AuthReport {
        user_id: session.as_ref().map(|c| c.sub.clone()),
        handle: session.as_ref().and_then(|c| c.handle.clone()),
        email: session.as_ref().and_then(|c| c.email.clone()),
        tier: tier.as_str(),
        is_paid: tier.is_paid(),
        is_pro: tier.is_pro(),
    })
}

/// Called on logout. Resets to Demo tier and clears user session.
#[tauri::command]
pub async fn clear_auth(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    {
        let mut tier_lock = state.licence_tier.lock().await;
        *tier_lock = LicenceTier::Demo;
    }
    {
        let mut session_lock = state.user_session.lock().await;
        *session_lock = None;
    }
    info!("Auth cleared, tier reset to Demo");
    Ok(())
}
