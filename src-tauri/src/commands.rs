//! Tauri IPC commands and global shortcut lifecycle for SpotAI.

use crate::ai::providers::{
    default_cloud_models, delete_ollama_model, fetch_lmstudio_models as query_lmstudio_models,
    fetch_ollama_models, fetch_openai_compatible_models as query_openai_compatible_models,
    ollama_ps, pull_ollama_model, stream_prompt, AiHttpClient, ChatMessage, ModelInfo,
    OllamaPsModel, PromptRequest, ProviderError, DEFAULT_LMSTUDIO_HOST, DEFAULT_OLLAMA_HOST,
};
use crate::ai::stream::ActiveStream;
use crate::{native_input, secure_store};
use arboard::Clipboard;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

static CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
fn global_cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point).ok()? };
    Some((point.x, point.y))
}

/// Moves the window just below-right of the cursor (Raycast-style), clamped to
/// the monitor work area so it never renders off-screen.
fn position_near_cursor(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        let (Some((cursor_x, cursor_y)), Ok(Some(monitor))) =
            (global_cursor_position(), window.current_monitor())
        else {
            return;
        };
        let work = monitor.work_area();
        let size = window.outer_size().unwrap_or_default();
        let margin = 16_i32;
        let min_x = work.position.x as i32;
        let min_y = work.position.y as i32;
        let max_x = min_x + work.size.width as i32 - size.width as i32 - margin;
        let max_y = min_y + work.size.height as i32 - size.height as i32 - margin;
        let x = (cursor_x + margin).clamp(min_x, max_x.max(min_x));
        let y = (cursor_y + margin).clamp(min_y, max_y.max(min_y));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

#[derive(Default)]
pub struct ShortcutRegistration {
    pub active: Mutex<Option<Shortcut>>,
    pub error: Mutex<Option<String>>,
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
    position_near_cursor(&window);
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

pub fn register_global_shortcut(
    app: &AppHandle,
    status: &ShortcutRegistration,
    shortcut: Shortcut,
) -> Result<(), String> {
    let result = app
        .global_shortcut()
        .register(shortcut)
        .map_err(|error| format!("Could not register {shortcut}: {error}"));
    if result.is_ok() {
        *status.active.lock() = Some(shortcut);
    }
    *status.error.lock() = result.as_ref().err().cloned();
    result
}

/// Re-registers the global shortcut from a user-configurable string (e.g. "Alt+Space",
/// "Ctrl+Shift+Space"). Unregisters the previous shortcut first so updates apply cleanly.
#[tauri::command]
pub fn register_shortcut(
    app: AppHandle,
    status: State<'_, ShortcutRegistration>,
    shortcut: String,
) -> ShortcutStatus {
    let parsed = match shortcut.trim().parse::<Shortcut>() {
        Ok(parsed) => parsed,
        Err(_) => {
            let message = format!(
                "Invalid shortcut \"{shortcut}\". Use Tauri syntax, e.g. Alt+Space or Ctrl+Shift+Space."
            );
            *status.error.lock() = Some(message.clone());
            return ShortcutStatus {
                registered: false,
                error: Some(message),
            };
        }
    };

    let previous = status.active.lock().take();
    if let Some(previous) = previous {
        let _ = app.global_shortcut().unregister(previous);
    }
    match app.global_shortcut().register(parsed) {
        Ok(()) => {
            *status.active.lock() = Some(parsed);
            *status.error.lock() = None;
            ShortcutStatus {
                registered: true,
                error: None,
            }
        }
        Err(error) => {
            // Keep the previously working shortcut if the new one cannot be registered.
            if let Some(previous) = previous {
                if app.global_shortcut().register(previous).is_ok() {
                    *status.active.lock() = Some(previous);
                }
            }
            let message = format!("Could not register {shortcut}: {error}");
            *status.error.lock() = Some(message.clone());
            ShortcutStatus {
                registered: false,
                error: Some(message),
            }
        }
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
    let result = tauri::async_runtime::spawn_blocking(move || native_input::auto_insert(text))
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = result {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Err(error);
    }
    Ok(())
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
pub async fn fetch_openai_compatible_models(
    client: State<'_, AiHttpClient>,
    host: String,
) -> Result<Vec<ModelInfo>, String> {
    query_openai_compatible_models(&client.0, &host)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fetch_cloud_models() -> Vec<ModelInfo> {
    default_cloud_models()
}

/// Streams tokens on `llm-token`.
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
    system_prompt: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    history: Option<Vec<ChatMessage>>,
    image_data_url: Option<String>,
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
        _ if provider.trim().starts_with("custom:") => {
            let provider_id = provider.trim()[7..].to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                secure_store::get_custom_api_key(&provider_id)
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
        system_prompt: system_prompt
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        host: resolved_host,
        temperature,
        max_tokens,
        history: history.unwrap_or_default(),
        image_data_url: image_data_url
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
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
pub async fn save_custom_api_key(provider: String, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_store::save_custom_api_key(&provider, &key))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_custom_api_key(provider: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_store::delete_custom_api_key(&provider))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_custom_api_key_status(provider: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<String>, secure_store::SecureStoreError> {
            Ok(secure_store::get_custom_api_key(&provider)?.map(|key| secure_store::mask_key(&key)))
        },
    )
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
    // Short timeout so the health indicator reacts fast when Ollama is offline.
    match client.0.get(url).timeout(Duration::from_secs(2)).send().await {
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

/// Writes the settings JSON to an absolute path chosen by the user through the
/// save dialog. The content comes from the frontend (serialized settings).
#[tauri::command]
pub fn export_settings_to_file(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("A destination path is required".into());
    }
    std::fs::write(&path, content).map_err(|error| error.to_string())
}

/// Reads a settings JSON file picked by the user through the open dialog.
#[tauri::command]
pub fn import_settings_from_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

/// Generic file writer used by the chat Markdown export.
#[tauri::command]
pub fn write_text_to_file(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("A destination path is required".into());
    }
    std::fs::write(&path, content).map_err(|error| error.to_string())
}

/// Pulls a model into the local Ollama server.
#[tauri::command]
pub async fn ollama_pull_model(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
    name: String,
) -> Result<(), String> {
    pull_ollama_model(&client.0, host.as_deref().unwrap_or(DEFAULT_OLLAMA_HOST), &name)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes a model from the local Ollama server.
#[tauri::command]
pub async fn ollama_delete_model(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
    name: String,
) -> Result<(), String> {
    delete_ollama_model(&client.0, host.as_deref().unwrap_or(DEFAULT_OLLAMA_HOST), &name)
        .await
        .map_err(|error| error.to_string())
}

/// Lists models currently loaded in memory (RAM/VRAM usage) via `ollama ps`.
#[tauri::command]
pub async fn fetch_ollama_ps(
    client: State<'_, AiHttpClient>,
    host: Option<String>,
) -> Result<Vec<OllamaPsModel>, String> {
    ollama_ps(&client.0, host.as_deref().unwrap_or(DEFAULT_OLLAMA_HOST))
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedScreen {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

/// Captures every monitor as a PNG data URL (used by the region capture flow).
#[tauri::command]
pub async fn capture_screens() -> Result<Vec<CapturedScreen>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<CapturedScreen>, String> {
        use base64::Engine;
        let monitors = xcap::Monitor::all().map_err(|error| error.to_string())?;
        let mut screens = Vec::new();
        for monitor in monitors {
            let image = monitor.capture_image().map_err(|error| error.to_string())?;
            let mut buffer = Vec::new();
            {
                let mut cursor = std::io::Cursor::new(&mut buffer);
                image
                    .write_to(&mut cursor, image::ImageFormat::Png)
                    .map_err(|error| error.to_string())?;
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
            let to_string_err = |error: xcap::XCapError| error.to_string();
            screens.push(CapturedScreen {
                id: monitor.id().map_err(to_string_err)?.to_string(),
                name: monitor.name().map_err(to_string_err)?,
                x: monitor.x().map_err(to_string_err)?,
                y: monitor.y().map_err(to_string_err)?,
                width: monitor.width().map_err(to_string_err)?,
                height: monitor.height().map_err(to_string_err)?,
                data_url: format!("data:image/png;base64,{encoded}"),
            });
        }
        Ok(screens)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Fixed, always-on quick actions triggered by dedicated global shortcuts. These
/// are independent from the user-configurable toggle shortcut and read the
/// current clipboard text into the request.
const QUICK_ACTIONS: &[(&str, &str)] = &[
    ("Ctrl+Shift+T", "translate"),
    ("Ctrl+Shift+R", "refactor"),
    ("Ctrl+Shift+K", "summarize"),
];

static REGISTERED_QUICK_ACTIONS: OnceLock<Vec<(Shortcut, &'static str)>> = OnceLock::new();

/// Registers the dedicated quick-action shortcuts (called once at startup).
pub fn register_quick_actions(app: &AppHandle) {
    let mut registered = Vec::new();
    for (text, action) in QUICK_ACTIONS {
        if let Ok(shortcut) = text.parse::<Shortcut>() {
            if app.global_shortcut().register(shortcut).is_ok() {
                registered.push((shortcut, *action));
            }
        }
    }
    let _ = REGISTERED_QUICK_ACTIONS.set(registered);
}

/// Returns the quick action id matching a shortcut, if any.
pub fn quick_action_for(shortcut: &Shortcut) -> Option<&'static str> {
    REGISTERED_QUICK_ACTIONS
        .get()?
        .iter()
        .find(|(registered, _)| registered == shortcut)
        .map(|(_, action)| *action)
}

/// Fires a quick action: reads the clipboard, emits `quick-action` to the UI and
/// reveals the window with the prepared prompt.
pub fn dispatch_quick_action(app: &AppHandle, action: &str) {
    let text = Clipboard::new()
        .ok()
        .and_then(|mut clipboard| clipboard.get_text().ok())
        .unwrap_or_default();
    let _ = app.emit(
        "quick-action",
        serde_json::json!({ "action": action, "text": text }),
    );
    show_window_internal(app, true);
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