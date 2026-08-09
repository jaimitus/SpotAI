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

/// Recognised modifier names in the shortcut string. Order matters: longer
/// names ("Super", "Meta") must be matched before shorter ones to avoid
/// accidental partial matches in `parse_shortcut`.
const MODIFIER_NAMES: &[&str] = &["super", "meta", "ctrl", "control", "alt", "shift"];

#[derive(Default)]
pub struct ShortcutRegistration {
    /// Currently registered shortcut, if any. Used to unregister on update.
    current: Mutex<Option<Shortcut>>,
    /// Last registration error, surfaced to the UI via `get_shortcut_status`.
    error: Mutex<Option<String>>,
}

impl ShortcutRegistration {
    /// Returns a clone of the currently registered shortcut, or `None` if
    /// nothing has been registered yet. Used by the global shortcut handler
    /// to decide whether an incoming event should toggle the window.
    pub fn current(&self) -> Option<Shortcut> {
        self.current.lock().clone()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    registered: bool,
    error: Option<String>,
    /// The shortcut that is currently registered, in the same string format
    /// the UI uses (e.g. "Alt+Space"). This lets the UI reconcile its
    /// in-memory settings with the backend truth after a restart.
    shortcut: Option<String>,
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
    let result = apply_shortcut(app, status, shortcut);
    *status.error.lock() = result.as_ref().err().cloned();
    result
}

#[tauri::command]
pub fn get_shortcut_status(status: State<'_, ShortcutRegistration>) -> ShortcutStatus {
    let error = status.error.lock().clone();
    let current = status.current.lock().clone();
    ShortcutStatus {
        registered: error.is_none(),
        error,
        shortcut: current.as_ref().map(shortcut_to_string),
    }
}

#[tauri::command]
pub fn set_global_shortcut(
    app: AppHandle,
    status: State<'_, ShortcutRegistration>,
    shortcut: String,
) -> Result<String, String> {
    let parsed = parse_shortcut(&shortcut)?;
    apply_shortcut(&app, &status, parsed)?;
    *status.error.lock() = None;
    Ok(shortcut)
}

/// Low-level helper that swaps the registered shortcut on the OS and updates
/// the bookkeeping state. Callers are responsible for surfacing errors via
/// `status.error` and clearing that field on success.
fn apply_shortcut(
    app: &AppHandle,
    status: &ShortcutRegistration,
    shortcut: Shortcut,
) -> Result<(), String> {
    // If we already have a different shortcut registered, drop it first so the
    // OS does not accumulate listeners. Same shortcut is a no-op for `register`.
    let previous = status.current.lock().clone();
    if let Some(prev) = previous {
        if prev != shortcut {
            let _ = app.global_shortcut().unregister(prev);
        }
    }
    app.global_shortcut()
        .register(shortcut)
        .map_err(|error| format!("Could not register shortcut: {error}"))?;
    *status.current.lock() = Some(shortcut);
    Ok(())
}

/// Parses a user-facing shortcut string like "Alt+Space", "Ctrl+Shift+K",
/// "Super+Alt+KeyP" into a `Shortcut`. The token list is `+`-separated and
/// tokens are case-insensitive. At least one non-modifier key is required.
fn parse_shortcut(input: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for raw_token in input.split('+') {
        let token = raw_token.trim();
        if token.is_empty() {
            continue;
        }
        let lower = token.to_ascii_lowercase();
        if let Some(stripped) = lower.strip_prefix("mod") {
            // Allow "Mod4" / "mod5" style super/meta keys for completeness.
            if let Some(digit) = stripped.chars().next() {
                if digit.is_ascii_digit() {
                    modifiers |= Modifiers::META;
                    continue;
                }
            }
        }
        let matched_modifier = MODIFIER_NAMES
            .iter()
            .find(|name| **name == lower.as_str())
            .copied();
        if let Some(name) = matched_modifier {
            match name {
                "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
                "alt" => modifiers |= Modifiers::ALT,
                "shift" => modifiers |= Modifiers::SHIFT,
                "super" | "meta" => modifiers |= Modifiers::META,
                _ => {}
            }
            continue;
        }
        if code.is_some() {
            return Err(format!(
                "Shortcut contains more than one non-modifier key: {input}"
            ));
        }
        let resolved = code_from_token(token).ok_or_else(|| {
            format!(
                "\"{token}\" is not a recognised key name. Use keys like Space, KeyA, F1, ArrowUp, …"
            )
        })?;
        code = Some(resolved);
    }

    let code = code.ok_or_else(|| {
        "Shortcut must contain at least one non-modifier key (e.g. Space, KeyA, F1)".to_string()
    })?;
    let mods_opt = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };
    Ok(Shortcut::new(mods_opt, code))
}

/// Converts a single key token ("Space", "KeyA", "F1", "ArrowUp", …) into a
/// `Code`. The accepted vocabulary is a curated subset of the `KeyboardCode`
/// values exposed by `tauri_plugin_global_shortcut`.
fn code_from_token(token: &str) -> Option<Code> {
    use Code::*;
    Some(match token {
        // Letters
        "A" | "KeyA" => KeyA,
        "B" | "KeyB" => KeyB,
        "C" | "KeyC" => KeyC,
        "D" | "KeyD" => KeyD,
        "E" | "KeyE" => KeyE,
        "F" | "KeyF" => KeyF,
        "G" | "KeyG" => KeyG,
        "H" | "KeyH" => KeyH,
        "I" | "KeyI" => KeyI,
        "J" | "KeyJ" => KeyJ,
        "K" | "KeyK" => KeyK,
        "L" | "KeyL" => KeyL,
        "M" | "KeyM" => KeyM,
        "N" | "KeyN" => KeyN,
        "O" | "KeyO" => KeyO,
        "P" | "KeyP" => KeyP,
        "Q" | "KeyQ" => KeyQ,
        "R" | "KeyR" => KeyR,
        "S" | "KeyS" => KeyS,
        "T" | "KeyT" => KeyT,
        "U" | "KeyU" => KeyU,
        "V" | "KeyV" => KeyV,
        "W" | "KeyW" => KeyW,
        "X" | "KeyX" => KeyX,
        "Y" | "KeyY" => KeyY,
        "Z" | "KeyZ" => KeyZ,
        // Digits
        "0" | "Digit0" => Digit0,
        "1" | "Digit1" => Digit1,
        "2" | "Digit2" => Digit2,
        "3" | "Digit3" => Digit3,
        "4" | "Digit4" => Digit4,
        "5" | "Digit5" => Digit5,
        "6" | "Digit6" => Digit6,
        "7" | "Digit7" => Digit7,
        "8" | "Digit8" => Digit8,
        "9" | "Digit9" => Digit9,
        // Common control / editing
        "Space" => Space,
        "Tab" => Tab,
        "Enter" | "Return" => Enter,
        "Escape" | "Esc" => Escape,
        "Backspace" => Backspace,
        "Delete" | "Del" => Delete,
        "Insert" | "Ins" => Insert,
        "Home" => Home,
        "End" => End,
        "PageUp" | "PgUp" => PageUp,
        "PageDown" | "PgDn" => PageDown,
        // Arrows
        "ArrowUp" | "Up" => ArrowUp,
        "ArrowDown" | "Down" => ArrowDown,
        "ArrowLeft" | "Left" => ArrowLeft,
        "ArrowRight" | "Right" => ArrowRight,
        // Function keys
        "F1" => F1,
        "F2" => F2,
        "F3" => F3,
        "F4" => F4,
        "F5" => F5,
        "F6" => F6,
        "F7" => F7,
        "F8" => F8,
        "F9" => F9,
        "F10" => F10,
        "F11" => F11,
        "F12" => F12,
        // Punctuation
        "Minus" | "-" => Minus,
        "Equal" | "=" => Equal,
        "Comma" | "," => Comma,
        "Period" | "." => Period,
        "Slash" | "/" => Slash,
        "Semicolon" | ";" => Semicolon,
        "Quote" | "'" => Quote,
        "Backquote" | "`" => Backquote,
        "Backslash" | "\\" => Backslash,
        "BracketLeft" | "[" => BracketLeft,
        "BracketRight" | "]" => BracketRight,
        _ => return None,
    })
}

pub fn shortcut_to_string(shortcut: &Shortcut) -> String {
    let mods = shortcut.mods;
    let mut parts: Vec<&'static str> = Vec::new();
    if mods.contains(Modifiers::CONTROL) {
        parts.push("Ctrl");
    }
    if mods.contains(Modifiers::ALT) {
        parts.push("Alt");
    }
    if mods.contains(Modifiers::SHIFT) {
        parts.push("Shift");
    }
    if mods.contains(Modifiers::META) {
        parts.push("Super");
    }
    let key_name = code_name(shortcut.key);
    if !key_name.is_empty() {
        parts.push(key_name);
    }
    parts.join("+")
}

fn code_name(code: Code) -> &'static str {
    use Code::*;
    match code {
        KeyA => "A",
        KeyB => "B",
        KeyC => "C",
        KeyD => "D",
        KeyE => "E",
        KeyF => "F",
        KeyG => "G",
        KeyH => "H",
        KeyI => "I",
        KeyJ => "J",
        KeyK => "K",
        KeyL => "L",
        KeyM => "M",
        KeyN => "N",
        KeyO => "O",
        KeyP => "P",
        KeyQ => "Q",
        KeyR => "R",
        KeyS => "S",
        KeyT => "T",
        KeyU => "U",
        KeyV => "V",
        KeyW => "W",
        KeyX => "X",
        KeyY => "Y",
        KeyZ => "Z",
        Digit0 => "0",
        Digit1 => "1",
        Digit2 => "2",
        Digit3 => "3",
        Digit4 => "4",
        Digit5 => "5",
        Digit6 => "6",
        Digit7 => "7",
        Digit8 => "8",
        Digit9 => "9",
        Space => "Space",
        Tab => "Tab",
        Enter => "Enter",
        Escape => "Escape",
        Backspace => "Backspace",
        Delete => "Delete",
        Insert => "Insert",
        Home => "Home",
        End => "End",
        PageUp => "PageUp",
        PageDown => "PageDown",
        ArrowUp => "ArrowUp",
        ArrowDown => "ArrowDown",
        ArrowLeft => "ArrowLeft",
        ArrowRight => "ArrowRight",
        F1 => "F1",
        F2 => "F2",
        F3 => "F3",
        F4 => "F4",
        F5 => "F5",
        F6 => "F6",
        F7 => "F7",
        F8 => "F8",
        F9 => "F9",
        F10 => "F10",
        F11 => "F11",
        F12 => "F12",
        Minus => "Minus",
        Equal => "Equal",
        Comma => "Comma",
        Period => "Period",
        Slash => "Slash",
        Semicolon => "Semicolon",
        Quote => "Quote",
        Backquote => "Backquote",
        Backslash => "Backslash",
        BracketLeft => "BracketLeft",
        BracketRight => "BracketRight",
        _ => "",
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