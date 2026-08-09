//! Persistent application settings stored as JSON in the OS app data dir.
//!
//! This replaces the previous `localStorage`-based persistence. `localStorage`
//! in Tauri v2 is tied to the webview data dir, which the user can wipe when
//! clearing app data; storing the file under the OS app data dir (e.g.
//! `%APPDATA%/com.spotai.desktop/settings.json` on Windows) keeps the user's
//! custom prompt buttons and other customisations safe across data-dir resets.
//!
//! The file is plain JSON and versioned via a top-level `version` key. Bump
//! the constant below and add a migration when the shape changes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use thiserror::Error;

/// Bump when the on-disk shape changes in a backwards-incompatible way. The
/// `migrate` function below handles older versions.
pub const SETTINGS_VERSION: u32 = 1;

const SETTINGS_FILE: &str = "settings.json";

/// Subset of `AppSettings` that we persist. Mirrors the TypeScript interface
/// in `src/types.ts`. We accept arbitrary additional fields on read so future
/// keys do not break existing installs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    pub language: Option<String>,
    pub ollama_host: Option<String>,
    pub lmstudio_host: Option<String>,
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub global_shortcut: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub custom_actions: Option<Vec<Value>>,
}

fn default_version() -> u32 {
    SETTINGS_VERSION
}

#[derive(Debug, Error)]
pub enum SettingsStoreError {
    #[error("Could not resolve the application data directory")]
    MissingAppDir,
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("Could not parse settings: {0}")]
    Parse(#[from] serde_json::Error),
}

impl From<SettingsStoreError> for String {
    fn from(error: SettingsStoreError) -> Self {
        error.to_string()
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, SettingsStoreError> {
    let resolver = app.path();
    let dir = resolver
        .app_data_dir()
        .map_err(|_| SettingsStoreError::MissingAppDir)?;
    Ok(dir.join(SETTINGS_FILE))
}

/// Ensures the parent directory exists. Called before every write so a user
/// with a clean install does not hit a "no such file or directory" error.
fn ensure_parent(path: &Path) -> Result<(), SettingsStoreError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

/// Reads the persisted settings. Returns `None` if the file does not exist
/// yet (first run) or cannot be parsed (corruption — we log and return None
/// so the UI can fall back to defaults rather than crash).
pub fn read_app_settings(app: &AppHandle) -> Result<Option<PersistedSettings>, SettingsStoreError> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    // Tolerate malformed files by returning None instead of bubbling the
    // error up to the UI. The next save will overwrite the file with a
    // valid payload.
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(
                %error,
                path = %path.display(),
                "settings_store: ignoring malformed settings file"
            );
            return Ok(None);
        }
    };
    let mut settings: PersistedSettings = serde_json::from_value(value.clone())?;
    migrate(&mut settings, &value)?;
    Ok(Some(settings))
}

/// Persists the given settings to disk atomically. We write to a sibling
/// temp file and rename so a crash mid-write cannot leave the user with a
/// half-written settings file.
pub fn write_app_settings(
    app: &AppHandle,
    settings: &PersistedSettings,
) -> Result<(), SettingsStoreError> {
    let path = settings_path(app)?;
    ensure_parent(&path)?;
    let mut payload = settings.clone();
    payload.version = SETTINGS_VERSION;
    let json = serde_json::to_string_pretty(&payload)?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes())?;
    // On Windows rename fails if the destination exists; remove it first.
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// Future-proof hook. The current shape is the only one we know, so any
/// older version is treated as the latest (with a warning). Add real
/// migrations here as new fields are introduced.
fn migrate(
    _settings: &mut PersistedSettings,
    _raw: &Value,
) -> Result<(), SettingsStoreError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_version_is_current() {
        assert_eq!(default_version(), SETTINGS_VERSION);
    }

    #[test]
    fn parses_minimal_payload() {
        let json = r#"{"version":1,"language":"en"}"#;
        let parsed: PersistedSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.language.as_deref(), Some("en"));
        assert!(parsed.custom_actions.is_none());
    }

    #[test]
    fn roundtrip_preserves_known_fields() {
        let mut payload = PersistedSettings::default();
        payload.language = Some("es".into());
        payload.global_shortcut = Some("Ctrl+Shift+K".into());
        payload.temperature = Some(0.4);
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: PersistedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.language.as_deref(), Some("es"));
        assert_eq!(parsed.global_shortcut.as_deref(), Some("Ctrl+Shift+K"));
        assert_eq!(parsed.temperature, Some(0.4));
    }

    #[test]
    fn unknown_fields_are_ignored() {
        // Forward compatibility: a future version can add fields without
        // breaking existing installs.
        let json = r#"{"version":1,"futureField":42,"language":"en"}"#;
        let parsed: PersistedSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.language.as_deref(), Some("en"));
    }
}
