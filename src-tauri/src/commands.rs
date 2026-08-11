//! Tauri IPC commands and global shortcut lifecycle for SpotAI.

use crate::ai::providers::{
    complete_text, default_cloud_models, delete_ollama_model, fetch_lmstudio_models as query_lmstudio_models,
    fetch_ollama_models, fetch_openai_compatible_models as query_openai_compatible_models,
    ollama_ps, pull_ollama_model, stream_prompt, AiHttpClient, ChatMessage, ModelInfo,
    OllamaPsModel, PromptRequest, ProviderError, DEFAULT_LMSTUDIO_HOST, DEFAULT_OLLAMA_HOST,
};
use crate::ai::stream::ActiveStream;
use crate::{native_input, rag, secure_store, voice, whisper};
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
    top_p: Option<f32>,
    top_k: Option<u32>,
    repeat_penalty: Option<f32>,
    seed: Option<u64>,
    num_ctx: Option<u32>,
    num_predict: Option<u32>,
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
        top_p,
        top_k,
        repeat_penalty,
        seed,
        num_ctx,
        num_predict,
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

/// Begin microphone capture and return immediately.
#[tauri::command]
pub fn start_voice_capture(
    app: AppHandle,
    state: State<'_, voice::VoiceState>,
) -> Result<(), String> {
    voice::start_capture(&state, app)
}

/// Stop microphone capture and return the recorded audio file path + metadata.
#[tauri::command]
pub fn stop_voice_capture(
    state: State<'_, voice::VoiceState>,
) -> Result<VoiceCaptureResult, String> {
    let (path, duration_secs, engine) = voice::stop_capture(&state)?;
    Ok(VoiceCaptureResult {
        path: path.to_string_lossy().to_string(),
        duration_secs,
        engine,
    })
}

/// Returns the current voice capture state so the UI can stay in sync with
/// the backend (e.g. when a start raced with the Alt+V shortcut).
#[tauri::command]
pub fn voice_state(state: State<'_, voice::VoiceState>) -> voice::VoiceStatus {
    voice::voice_status(&state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCaptureResult {
    pub path: String,
    pub duration_secs: f64,
    pub engine: voice::VoiceEngine,
}

/// Update the voice engine preference (Native / Whisper).
#[tauri::command]
pub fn set_voice_engine(
    state: State<'_, voice::VoiceState>,
    engine: String,
) -> Result<(), String> {
    *state.engine.lock() = voice::VoiceEngine::from_str(&engine);
    Ok(())
}

/// Sets the language Whisper should transcribe in ("auto" = detect from the
/// audio). The tiny multilingual model misdetects languages on short clips,
/// so pinning a language (e.g. "es") makes dictation reliable.
#[tauri::command]
pub fn set_voice_language(
    state: State<'_, voice::VoiceState>,
    language: String,
) -> Result<(), String> {
    let trimmed = language.trim().to_ascii_lowercase();
    // Only store codes whisper actually understands, so `voice_state` never
    // reports a language that would be silently ignored at transcription time.
    let known = matches!(trimmed.as_str(), "en" | "es" | "de" | "pt" | "fr");
    *state.language.lock() = if trimmed.is_empty() || trimmed == "auto" || !known {
        None
    } else {
        Some(trimmed)
    };
    Ok(())
}

/// Lists every available microphone so Settings can offer a device picker.
#[tauri::command]
pub fn list_microphones() -> Vec<voice::MicDevice> {
    voice::list_microphones()
}

/// Persists the microphone chosen in Settings; voice capture will record
/// from it instead of the OS default. Pass an empty string to use the default.
#[tauri::command]
pub fn set_selected_microphone(
    state: State<'_, voice::VoiceState>,
    mic: String,
) -> Result<(), String> {
    let trimmed = mic.trim().to_string();
    *state.selected_mic.lock() = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    Ok(())
}

/// Returns whether the local Whisper binary + model are installed.
#[tauri::command]
pub fn get_whisper_status(
    app: AppHandle,
    state: State<'_, whisper::WhisperState>,
) -> whisper::WhisperStatus {
    whisper::status(&app, &state)
}

/// Downloads the whisper-cli binary and the ACTIVE model (emits
/// `whisper-progress`). The binary is reused when switching models.
#[tauri::command]
pub async fn install_whisper(
    app: AppHandle,
    state: State<'_, whisper::WhisperState>,
) -> Result<(), String> {
    whisper::install(app, state.inner()).await
}

/// Switches the active Whisper model ("tiny" / "base" / "small"). Fast — it
/// never downloads; when the chosen model file is missing the returned status
/// reports `installed: false` so the Settings panel can offer the download.
#[tauri::command]
pub fn set_whisper_model(
    app: AppHandle,
    state: State<'_, whisper::WhisperState>,
    model: String,
) -> Result<whisper::WhisperStatus, String> {
    whisper::set_model(&state, &model)?;
    Ok(whisper::status(&app, &state))
}

/// Transcribes a recorded WAV file with whisper-cli and emits a
/// `voice-transcribed` event with the result (or a descriptive error).
#[tauri::command]
pub async fn transcribe_voice_wav(
    app: AppHandle,
    state: State<'_, voice::VoiceState>,
    path: String,
) -> Result<(), String> {
    let app_for_thread = app.clone();
    // Pin the recognition language chosen in Settings (None = auto-detect).
    let language = state.language.lock().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        whisper::transcribe(&app_for_thread, std::path::Path::new(&path), language.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = app.emit(
        "voice-transcribed",
        serde_json::json!({
            "text": result.as_ref().ok(),
            "error": result.as_ref().err(),
        }),
    );
    Ok(())
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

/// Reveals a local file in the OS file manager (Explorer on Windows) with the
/// file selected. Used by the RAG citation badge to jump to the source file.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.trim()))
            .spawn()
            .map_err(|error| format!("Failed to open Explorer: {error}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| format!("Failed to reveal file: {error}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = path;
        Err("Reveal in folder is not supported on Linux".to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Ok(())
    }
}

/// RAG: Index multiple files for semantic search
#[tauri::command]
pub async fn rag_index_files(
    rag_state: tauri::State<'_, rag::RagState>,
    file_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, usize>, String> {
    let paths: Vec<std::path::PathBuf> = file_paths.iter().map(std::path::PathBuf::from).collect();
    rag_state.index_files(&paths).await
}

/// RAG: Query indexed documents with semantic search
#[tauri::command]
pub async fn rag_query(
    rag_state: tauri::State<'_, rag::RagState>,
    query: String,
    top_k: Option<usize>,
) -> Result<rag::RagQueryResult, String> {
    let top_k = top_k.unwrap_or(5);
    rag_state.query(&query, top_k).await
}

/// RAG: Get statistics about indexed documents
#[tauri::command]
pub async fn rag_get_stats(
    rag_state: tauri::State<'_, rag::RagState>,
) -> Result<rag::RagStats, String> {
    rag_state.get_stats().await
}

/// RAG: List every indexed document (used for suggested questions / badges)
#[tauri::command]
pub async fn rag_get_documents(
    rag_state: tauri::State<'_, rag::RagState>,
) -> Result<Vec<rag::RagDocument>, String> {
    rag_state.get_documents().await
}

/// RAG: Remove a document from the index
#[tauri::command]
pub async fn rag_remove_document(
    rag_state: tauri::State<'_, rag::RagState>,
    doc_path: String,
) -> Result<(), String> {
    rag_state.remove_document(&doc_path).await
}

/// A model-suggested action: a question (`?`) the user can ask about their
/// documents, or a concrete action (`!`) such as summarize / list deadlines.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedAction {
    pub kind: String,
    pub text: String,
}

/// Parse the model's raw suggestion output into structured actions. The model
/// is instructed to emit one line per suggestion: `?` for a question and `!`
/// for an action. Lines without a marker are treated as questions; unparseable
/// lines are dropped.
pub fn parse_suggested_actions(raw: &str) -> Vec<SuggestedAction> {
    let mut actions = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Skip common wrapper lines the model may add around the list.
        let without_list = trimmed.trim_start_matches(['-', '*', '•', '\u{2022}']).trim();
        let (kind, text) = if let Some(rest) = without_list.strip_prefix('!') {
            ("action", rest.trim())
        } else if let Some(rest) = without_list.strip_prefix('?') {
            ("question", rest.trim())
        } else {
            // Bare lines are ambiguous; only keep them when they end with a
            // question mark so noise from the model intro is filtered out.
            if without_list.ends_with('?') {
                ("question", without_list)
            } else {
                continue;
            }
        };
        if text.is_empty() {
            continue;
        }
        actions.push(SuggestedAction {
            kind: kind.to_string(),
            text: text.to_string(),
        });
    }
    actions
}

/// AI-generated suggested actions: the model reads the top chunks of the
/// indexed documents (or a single one when `document_path` is given, e.g. when
/// the user selected a document in the RAG panel) and proposes questions and
/// concrete actions related to their actual content. Uses the same
/// provider/streaming stack as prompts.
#[tauri::command]
pub async fn suggest_document_actions(
    client: State<'_, AiHttpClient>,
    rag_state: tauri::State<'_, rag::RagState>,
    provider: String,
    model: String,
    host: Option<String>,
    api_key: Option<String>,
    system_prompt: Option<String>,
    language: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    document_path: Option<String>,
) -> Result<Vec<SuggestedAction>, String> {
    if model.trim().is_empty() {
        return Ok(Vec::new());
    }

    let docs = rag_state.get_documents().await?;
    if docs.is_empty() {
        return Ok(Vec::new());
    }

    // Pull the most relevant chunks of the selected document only, or of every
    // indexed document when none is selected, so the model reasons over real
    // content, not just file names.
    let mut context_parts = Vec::new();
    for doc in docs.iter().take(5) {
        if let Some(selected) = document_path.as_deref() {
            if selected != doc.path {
                continue;
            }
        }
        let results = rag_state
            .search(&format!("overview of {}", doc.name), 4)
            .await?;
        for result in results {
            context_parts.push(format!("[{}]\n{}", doc.name, result.content));
        }
    }
    let context = context_parts.join("\n\n");
    if context.trim().is_empty() {
        return Ok(Vec::new());
    }

    let lang = language.as_deref().unwrap_or("en");
    let prompt = format!(
        "Read the reference documents inside <context> and propose useful next steps.\n\n\
         Rules:\n\
         - Write every suggestion in the language code '{lang}' (the user's interface language).\n\
         - Propose exactly 5 suggestions that mix questions and concrete actions.\n\
         - Questions start with '? ' and actions start with '! '.\n\
         - One suggestion per line. No numbering, no headers, no commentary.\n\
         - Make each suggestion specific to the document content: deadlines, decisions, risks, \n\
           key facts, comparisons, or follow-up work."
    );

    let request = PromptRequest {
        provider,
        model,
        prompt,
        context_text: Some(context),
        api_key,
        system_prompt,
        host,
        temperature,
        max_tokens,
        history: Vec::new(),
        image_data_url: None,
        request_id: format!("suggest_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)),
        top_p: None,
        top_k: None,
        repeat_penalty: None,
        seed: None,
        num_ctx: None,
        num_predict: None,
    };

    let raw = complete_text(&client.0, &request, "You are SpotAI. You analyze user documents and propose helpful next questions and actions.")
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_suggested_actions(&raw))
}

/// CLI Injection: Analyze command safety and generate shell command
#[tauri::command]
pub fn analyze_command_safety(command: String) -> Result<native_input::ShellCommand, String> {
    let (safety_level, _warnings) = native_input::SafetyLevel::analyze(&command);
    
    // Determine shell and arguments based on command type
    let (shell, args, description) = if cfg!(target_os = "windows") {
        if command.contains("powershell") || command.contains("Get-") || command.contains("Set-") {
            ("powershell.exe".to_string(), vec!["-Command".to_string(), command.clone()], "PowerShell command".to_string())
        } else {
            ("cmd.exe".to_string(), vec!["/C".to_string(), command.clone()], "CMD command".to_string())
        }
    } else {
        ("bash".to_string(), vec!["-c".to_string(), command.clone()], "Bash command".to_string())
    };
    
    Ok(native_input::ShellCommand {
        command,
        shell,
        args,
        description,
        safety_level,
    })
}

/// CLI Injection: Execute command with user confirmation
#[tauri::command]
pub async fn execute_shell_command(
    cmd: native_input::ShellCommand,
) -> Result<String, String> {
    // Block dangerous commands automatically
    if cmd.safety_level == native_input::SafetyLevel::Dangerous {
        return Err(format!(
            "⚠️ Dangerous command blocked: {}\n\nThis command could cause irreversible damage to your system.",
            cmd.command
        ));
    }
    
    // For caution-level commands, we require explicit confirmation (handled in frontend)
    // The frontend should show a confirmation dialog before calling this
    
    native_input::execute_command(&cmd)
}

#[cfg(test)]
mod tests {
    use super::parse_suggested_actions;

    #[test]
    fn parses_questions_and_actions() {
        let raw = "? What is the deadline of this contract?\n! Summarize the key clauses\n? Who are the parties?\n";
        let actions = parse_suggested_actions(raw);
        assert_eq!(actions.len(), 3);
        assert_eq!(actions[0].kind, "question");
        assert_eq!(actions[0].text, "What is the deadline of this contract?");
        assert_eq!(actions[1].kind, "action");
        assert_eq!(actions[1].text, "Summarize the key clauses");
        assert_eq!(actions[2].kind, "question");
    }

    #[test]
    fn strips_bullets_and_model_noise() {
        let raw = "Here are some suggestions:\n- ? Point one?\n- ! Do the thing\nJust filler without marker\n";
        let actions = parse_suggested_actions(raw);
        assert_eq!(actions.len(), 2, "filler lines without markers are dropped");
        assert_eq!(actions[0].kind, "question");
        assert_eq!(actions[1].kind, "action");
    }

    #[test]
    fn bare_question_lines_are_kept_but_bare_statements_dropped() {
        let raw = "A bare question?\nA bare statement\n";
        let actions = parse_suggested_actions(raw);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, "question");
        assert_eq!(actions[0].text, "A bare question?");
    }

    #[test]
    fn empty_input_yields_no_actions() {
        assert!(parse_suggested_actions("").is_empty());
        assert!(parse_suggested_actions("\n\n  \n").is_empty());
    }
}