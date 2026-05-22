use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCrashReport {
    pub id: String,
    pub timestamp: String,
    pub process: String,
    pub thread: String,
    pub message: String,
    pub location: Option<String>,
    pub backtrace: Option<String>,
}

fn pending_crash_report_path() -> PathBuf {
    everywear_paths::data_dir("diagnostics").join("pending-crash-report.json")
}

pub fn install_panic_crash_report_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic payload was not a string".to_string());
        let location = info.location().map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        });
        let current_thread = std::thread::current();
        let thread = current_thread.name().unwrap_or("unnamed").to_string();
        let report = PendingCrashReport {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            process: std::env::args()
                .next()
                .unwrap_or_else(|| "everywear-os".to_string()),
            thread,
            message,
            location,
            backtrace: Some(std::backtrace::Backtrace::force_capture().to_string()),
        };

        let path = pending_crash_report_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&report) {
            let _ = std::fs::write(&path, json);
        }
        eprintln!(
            "Everywear OS panic captured for next-launch crash reporting: {}",
            path.display()
        );
        default_hook(info);
    }));
}

#[tauri::command]
pub async fn take_pending_crash_report() -> Result<Option<PendingCrashReport>, String> {
    let path = pending_crash_report_path();
    if !path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read pending crash report: {error}"))?;
    let report = serde_json::from_str::<PendingCrashReport>(&contents)
        .map_err(|error| format!("failed to parse pending crash report: {error}"))?;
    let _ = std::fs::remove_file(&path);
    Ok(Some(report))
}
