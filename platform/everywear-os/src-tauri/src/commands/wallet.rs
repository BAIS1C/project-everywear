use crate::{state::AppState, wallet};

#[tauri::command]
pub async fn wallet_generate(
    state: tauri::State<'_, AppState>,
) -> Result<wallet::WalletInfo, String> {
    let mut w = state.wallet.lock().await;
    w.generate_keypair().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wallet_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<wallet::WalletInfo>, String> {
    let w = state.wallet.lock().await;
    Ok(w.get_info())
}

#[tauri::command]
pub async fn wallet_transactions(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<wallet::Transaction>, String> {
    let w = state.wallet.lock().await;
    Ok(w.get_transactions(limit.unwrap_or(20)))
}

#[tauri::command]
pub async fn wallet_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut w = state.wallet.lock().await;
    w.disconnect();
    Ok(())
}
