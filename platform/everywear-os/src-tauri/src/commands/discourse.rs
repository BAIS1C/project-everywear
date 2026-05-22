use crate::{discourse, state::AppState};

// ─── Discourse Commands ─────────────────────────────────────────────────────

#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_oauth_url(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mut client = state.discourse.lock().await;
    Ok(client.oauth_url())
}

// CLAUDE_INTERFACE: This command completes Discourse OAuth callback handling.
// Command: "discourse_complete_oauth"
// Args: { code: string, state: string }
// Returns: { username, name?, avatar_url?, trust_level, unread_notifications }
// Error: "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_complete_oauth(
    state: tauri::State<'_, AppState>,
    code: String,
    oauth_state: String,
) -> Result<discourse::DiscourseUser, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .complete_oauth(&code, &oauth_state)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_user(
    state: tauri::State<'_, AppState>,
) -> Result<Option<discourse::DiscourseUser>, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.get_user().await.map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_latest(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<discourse::DiscoursePost>, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .latest_posts(limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_get_topics"
// Args: { category_id?: number, page?: number }
// Returns: { topics: Array<{id, title, slug, posts_count, created_at}>, total: number }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_get_topics(
    state: tauri::State<'_, AppState>,
    category_id: Option<u64>,
    page: Option<u32>,
) -> Result<discourse::DiscourseTopicList, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .list_topics(category_id, page)
        .await
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_read_post"
// Args: { post_id: number }
// Returns: { id, topic_id?, topic_slug?, author, raw?, cooked?, created_at }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_read_post(
    state: tauri::State<'_, AppState>,
    post_id: u64,
) -> Result<discourse::DiscoursePostDetail, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.read_post(post_id).await.map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_create_post"
// Args: { request: { title?: string, raw: string, topic_id?: number, category?: number } }
// Returns: { id, topic_id?, topic_slug?, author, raw?, cooked?, created_at }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_create_post(
    state: tauri::State<'_, AppState>,
    request: discourse::CreatePostRequest,
) -> Result<discourse::DiscoursePostDetail, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.create_post(request).await.map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_refresh_token(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.discourse.lock().await;
    client
        .refresh_access_token()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
pub async fn discourse_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.discourse.lock().await;
    client.disconnect();
    Ok(())
}

