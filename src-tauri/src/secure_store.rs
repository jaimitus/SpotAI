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
    let supported = PROVIDERS.iter().any(|candidate| *candidate == normalized);
    if supported || normalized.starts_with("custom:") {
        Ok(provider.trim())
    } else {
        Err(SecureStoreError::UnsupportedProvider(provider.into()))
    }
}

fn entry(provider: &str) -> Result<Entry, SecureStoreError> {
    Entry::new(SERVICE, validate_provider(provider)?)
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))
}

fn custom_account(provider: &str) -> String {
    format!("custom:{}", provider.trim().to_ascii_lowercase())
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

pub fn mask_key(key: &str) -> String {
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

/// Custom providers store their key under the `custom:<id>` credential account.
pub fn save_custom_api_key(provider: &str, key: &str) -> Result<(), SecureStoreError> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(());
    }
    Entry::new(SERVICE, &custom_account(provider))
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))?
        .set_password(key)
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))
}

pub fn delete_custom_api_key(provider: &str) -> Result<(), SecureStoreError> {
    match Entry::new(SERVICE, &custom_account(provider))
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SecureStoreError::Keyring(error.to_string())),
    }
}

pub fn get_custom_api_key(provider: &str) -> Result<Option<String>, SecureStoreError> {
    match Entry::new(SERVICE, &custom_account(provider))
        .map_err(|error| SecureStoreError::Keyring(error.to_string()))?
        .get_password()
    {
        Ok(value) if !value.is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(SecureStoreError::Keyring(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_provider_accepts_builtins_and_custom() {
        assert_eq!(validate_provider("openai").unwrap(), "openai");
        assert_eq!(validate_provider("Anthropic").unwrap(), "Anthropic");
        assert_eq!(
            validate_provider("  groq  ").unwrap(),
            "groq"
        );
        assert_eq!(
            validate_provider("custom:my-provider").unwrap(),
            "custom:my-provider"
        );
        assert!(matches!(
            validate_provider("unknown"),
            Err(SecureStoreError::UnsupportedProvider(_))
        ));
        assert!(validate_provider("").is_err());
    }

    #[test]
    fn custom_account_normalizes_provider_ids() {
        assert_eq!(custom_account("OpenRouter"), "custom:openrouter");
        assert_eq!(custom_account("  custom_1 "), "custom:custom_1");
    }

    #[test]
    fn mask_key_never_leaks_the_secret() {
        assert_eq!(mask_key("short"), "********");
        assert_eq!(mask_key("sk-1234567890abcdef"), "sk-****cdef");
        let masked = mask_key("sk-1234567890abcdef");
        assert!(!masked.contains("123456"), "masked key leaked the middle");
        assert!(!masked.contains("7890"), "masked key leaked the middle");
    }
}