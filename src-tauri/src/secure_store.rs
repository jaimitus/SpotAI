//! API key storage backed by the operating system credential manager.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SERVICE: &str = "com.spotai.desktop";
const PROVIDERS: [&str; 4] = ["openai", "anthropic", "groq", "deepseek"];

#[derive(Debug, Error)]
pub enum SecureStoreError {
    #[error("Credential manager error: {0}")]
    Keyring(String),
    #[error("Unsupported provider: {0}")]
    UnsupportedProvider(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApiKeys {
    pub openai: Option<String>,
    pub anthropic: Option<String>,
    pub groq: Option<String>,
    pub deepseek: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub openai: Option<String>,
    pub anthropic: Option<String>,
    pub groq: Option<String>,
    pub deepseek: Option<String>,
}

fn validate_provider(provider: &str) -> Result<&str, SecureStoreError> {
    let normalized = provider.trim().to_ascii_lowercase();
    PROVIDERS
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
        .ok_or_else(|| SecureStoreError::UnsupportedProvider(provider.into()))
}

fn entry(provider: &str) -> Result<Entry, SecureStoreError> {
    Entry::new(SERVICE, validate_provider(provider)?)
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))
}

pub fn save_api_key(provider: &str, key: &str) -> Result<(), SecureStoreError> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(());
    }
    entry(provider)?
        .set_password(key)
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))
}

pub fn get_api_key(provider: &str) -> Result<Option<String>, SecureStoreError> {
    match entry(provider)?.get_password() {
        Ok(value) if !value.is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(SecureStoreError::Keyring(error.to_string())),
    }
}

pub fn delete_api_key(provider: &str) -> Result<(), SecureStoreError> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SecureStoreError::Keyring(error.to_string())),
    }
}

pub fn save_updates(keys: &ApiKeys) -> Result<(), SecureStoreError> {
    for (provider, value) in [
        ("openai", keys.openai.as_deref()),
        ("anthropic", keys.anthropic.as_deref()),
        ("groq", keys.groq.as_deref()),
        ("deepseek", keys.deepseek.as_deref()),
    ] {
        if let Some(key) = value.map(str::trim).filter(|key| !key.is_empty()) {
            save_api_key(provider, key)?;
        }
    }
    Ok(())
}

fn mask_key(key: &str) -> String {
    if key.chars().count() <= 8 {
        return "********".into();
    }
    let head: String = key.chars().take(3).collect();
    let tail: String = key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}****{tail}")
}

pub fn key_status() -> Result<ApiKeyStatus, SecureStoreError> {
    let masked = |provider: &str| -> Result<Option<String>, SecureStoreError> {
        Ok(get_api_key(provider)?.map(|key| mask_key(&key)))
    };
    Ok(ApiKeyStatus {
        openai: masked("openai")?,
        anthropic: masked("anthropic")?,
        groq: masked("groq")?,
        deepseek: masked("deepseek")?,
    })
}