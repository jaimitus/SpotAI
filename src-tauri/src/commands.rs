//! Tauri IPC commands and global shortcut lifecycle for SpotAI.

use crate::ai::providers::{
    default_cloud_models, fetch_lmstudio_models as query_lmstudio_models, fetch_ollama_models,
    stream_prompt, AiHttpClient, ModelInfo, PromptRequest, ProviderError, DEFAULT_LMSTUDIO_HOST,
    DEFAULT_OLLAMA_HOST,
};
use crate::ai::stream::ActiveStream;
use crate::{native_input, secure_store};
use arboard::Clipboard;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

static CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct ShortcutRegistration {
    error: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    registered: bool,
    error: Option<String>,
}

fn reveal_window(app: &AppHandle, context: Option<String>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The main window is not available".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if let Some(text) = context {
        let _ = app.emit_to("main", "context-captured", text);
    }
    let _ = app.emit_to("main", "window-shown", ());
    Ok(())
}

pub fn show_window_internal(app: &AppHandle, capture_selection: bool) {
    if !capture_selection {
        if let Err(error) = reveal_window(app, native_input::clipboard_text()) {
            tracing::error!(%error, "failed to reveal SpotAI");
        }
        return;
    }
    if CAPTURE_IN_FLIGHT.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = native_input::capture_selected_text();
        if let Err(error) = reveal_window(&app, context) {
            tracing::error!(%error, "failed to reveal SpotAI after text capture");
        }
        CAPTURE_IN_FLIGHT.store(false, Ordering::Release);
    });
}

pub fn toggle_from_shortcut(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_window_internal(app, true);
    }
}

pub fn register_global_shortcut(app: &AppHandle, status: &ShortcutRegistration) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let result = app
        .global_shortcut()
        .register(shortcut)
        .map_err(|error| format!("Could not register Alt+Space: {error}"));
    *status.error.lock() = result.as_ref().err().cloned();
    result
}

#[tauri::command]
pub fn get_shortcut_status(status: State<'_, ShortcutRegistration>) -> ShortcutStatus {
    let error = status.error.lock().clone();
    ShortcutStatus {
        registered: error.is_none(),
        error,
    }
}

#[tauri::command]
pub fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    Ok(clipboard.get_text().unwrap_or_default())
}

#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<(), String> {
    Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn auto_insert_text(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        native_input::auto_insert(text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fetch_local_models(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    fetch_ollama_models(&client.0, host.as_deref().unwrap_or(DEFAULT_OLLAMA_HOST))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn fetch_lmstudio_models(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    query_lmstudio_models(
        &client.0,
        host.as_deref().unwrap_or(DEFAULT_LMSTUDIO_HOST),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fetch_cloud_models() -> Vec<ModelInfo> {
    default_cloud_models()
}

/// Streams tokens on `llm-token`. The signature matches the requested backend technical specification exactly.
#[tauri::command]
pub async fn send_prompt_stream(
    app: AppHandle,
    client: State<'_, AiHttpClient>,
    active: State<'_, ActiveStream>,
    provider: String,
    model: String,
    prompt: String,
    context_text: Option<String>,
    api_key: Option<String>,
    host: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let resolved_key = match api_key.map(|key| key.trim().to_owned()) {
        Some(key) if !key.is_empty() => Some(key),
        _ if matches!(
            provider.trim().to_ascii_lowercase().as_str(),
            "openai" | "anthropic" | "groq" | "deepseek" | "claude"
        ) => {
            let key_provider = if provider.eq_ignore_ascii_case("claude") {
                "anthropic".to_string()
            } else {
                provider.clone()
            };
            tauri::async_runtime::spawn_blocking(move || {
                secure_store::get_api_key(&key_provider)
            })
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?
        }
        _ => None,
    };

    let resolved_request_id = request_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
                .to_string()
        });

    let resolved_host = match host.map(|h| h.trim().to_string()).filter(|h| !h.is_empty()) {
        Some(h) => Some(h),
        None => match provider.trim().to_ascii_lowercase().as_str() {
            "ollama" => Some(DEFAULT_OLLAMA_HOST.to_string()),
            "lmstudio" | "lm-studio" => Some(DEFAULT_LMSTUDIO_HOST.to_string()),
            _ => None,
        },
    };

    let request = PromptRequest {
        provider,
        model,
        prompt,
        context_text,
        api_key: resolved_key,
        system_prompt: None,
        host: resolved_host,
        temperature: Some(0.7),
        max_tokens: Some(4096),
        request_id: resolved_request_id,
    };

    let cancel = active.begin();
    let result = stream_prompt(&client.0, app, request, cancel.clone()).await;
    active.clear_if_current(&cancel);
    match result {
        Ok(()) | Err(ProviderError::Cancelled) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn cancel_stream(active: State<'_, ActiveStream>) {
    active.stop();
}

#[tauri::command]
pub async fn save_api_keys(keys: secure_store::ApiKeys) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_store::save_updates(&keys))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_api_key_status() -> Result<secure_store::ApiKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(secure_store::key_status)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_api_key(provider: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_store::delete_api_key(&provider))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn toggle_window(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The main window is not available".to_string())?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        reveal_window(&app, None)?;
        Ok(true)
    }
}

#[tauri::command]
pub fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_window(app: AppHandle) -> Result<(), String> {
    reveal_window(&app, None)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub ollama: bool,
    pub ollama_version: Option<String>,
}

#[tauri::command]
pub async fn check_ollama_health(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
) -> Result<HealthStatus, String> {
    let host = host.unwrap_or_else(|| DEFAULT_OLLAMA_HOST.into());
    let url = format!("{}/api/version", host.trim().trim_end_matches('/'));
    match client.0.get(url).send().await {
        Ok(response) if response.status().is_success() => {
            let version = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|value| value.get("version")?.as_str().map(str::to_owned));
            Ok(HealthStatus {
                ollama: true,
                ollama_version: version,
            })
        }
        _ => Ok(HealthStatus {
            ollama: false,
            ollama_version: None,
        }),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Ok(())
    }
}