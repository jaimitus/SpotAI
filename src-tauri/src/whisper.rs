//! Whisper.cpp integration: download, install, and run local speech-to-text.
//!
//! The install flow fetches two artifacts into the app-data `whisper/` folder:
//!   1. `whisper-bin-x64.zip` (official release) which contains
//!      `Release/whisper-cli.exe` plus the ggml DLLs it links against.
//!   2. `ggml-tiny.bin` (multilingual, ~75 MB) from the ggerganov/whisper.cpp
//!      Hugging Face repo.
//!
//! Transcription runs `whisper-cli` as a subprocess with JSON output; the
//! recognised text is returned to the caller.

use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

const BIN_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";
const MODEL_NAME: &str = "ggml-tiny.bin";

/// Shared install state managed by Tauri.
pub struct WhisperState {
    /// Base directory for the whisper install.
    pub dir: Mutex<Option<PathBuf>>,
    /// True while a download is in progress.
    installing: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    pub installed: bool,
    pub installing: bool,
    pub model_size: u64,
}

impl WhisperState {
    pub fn new() -> Self {
        Self {
            dir: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }

    pub fn set_dir(&self, path: PathBuf) {
        *self.dir.lock() = Some(path);
    }
}

// ── Paths ────────────────────────────────────────────────────────────────────

fn install_dir(app: &AppHandle) -> PathBuf {
    // Prefer the explicit dir (set in setup from the app data dir), then fall
    // back to the app data dir convention.
    if let Some(dir) = app
        .try_state::<WhisperState>()
        .and_then(|state| state.dir.lock().clone())
    {
        return dir;
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("whisper")
}

fn exe_path(app: &AppHandle) -> PathBuf {
    install_dir(app).join("Release").join("whisper-cli.exe")
}

fn model_path(app: &AppHandle) -> PathBuf {
    install_dir(app).join(MODEL_NAME)
}

// ── Status ───────────────────────────────────────────────────────────────────

pub fn is_installed(app: &AppHandle) -> bool {
    exe_path(app).exists() && model_path(app).exists()
}

pub fn status(app: &AppHandle, state: &WhisperState) -> WhisperStatus {
    WhisperStatus {
        installed: is_installed(app),
        installing: state.installing.load(Ordering::Relaxed),
        model_size: std::fs::metadata(model_path(app)).map(|m| m.len()).unwrap_or(0),
    }
}

// ── Install ──────────────────────────────────────────────────────────────────

/// Downloads the whisper binary + model, emitting `whisper-progress` events.
pub async fn install(app: AppHandle, state: &WhisperState) -> Result<(), String> {
    if state.installing.swap(true, Ordering::AcqRel) {
        return Err("A Whisper download is already in progress".into());
    }

    // Ensure the flag is cleared even if we bail early.
    struct Guard<'a>(&'a AtomicBool);
    impl Drop for Guard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _guard = Guard(&state.installing);

    let dir = install_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create whisper folder: {e}"))?;

    // 1) Whisper binary zip.
    let zip_path = dir.join("whisper-bin.zip");
    download(&app, BIN_URL, &zip_path, "binary").await?;
    extract_zip(&zip_path, &dir).map_err(|e| format!("Could not extract whisper binary: {e}"))?;
    let _ = std::fs::remove_file(&zip_path);

    // 2) Multilingual model.
    let model = model_path(&app);
    download(&app, MODEL_URL, &model, "model").await?;

    let _ = app.emit(
        "whisper-status",
        serde_json::json!({ "installed": true, "installing": false }),
    );
    Ok(())
}

async fn download(app: &AppHandle, url: &str, dest: &Path, phase: &str) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .user_agent(concat!("SpotAI/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with status {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    // Download to a `.part` file first and rename on success so an interrupted
    // download never leaves a truncated model that looks installed.
    let mut part_path = dest.as_os_str().to_owned();
    part_path.push(".part");
    let part = PathBuf::from(part_path);
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("Could not create download file: {e}"))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        received += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write download: {e}"))?;
        let _ = app.emit(
            "whisper-progress",
            serde_json::json!({
                "phase": phase,
                "received": received,
                "total": total,
            }),
        );
    }
    file.flush().await.map_err(|e| format!("Could not flush download: {e}"))?;
    drop(file);
    std::fs::rename(&part, dest).map_err(|e| format!("Could not finalize download: {e}"))?;
    Ok(())
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    archive.extract(dest).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Transcription ────────────────────────────────────────────────────────────

/// Removes both the source WAV and the whisper JSON output once the
/// transcription has finished (successfully or not). The recordings are
/// temporary voice captures living in the temp dir: leaving them behind would
/// fill the disk with every dictation, so cleanup is guaranteed on every exit
/// path via RAII.
struct TranscriptionCleanup<'a> {
    wav: &'a Path,
    json: Option<PathBuf>,
}

impl Drop for TranscriptionCleanup<'_> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.wav);
        if let Some(json) = &self.json {
            let _ = std::fs::remove_file(json);
        }
    }
}

/// Transcribes a WAV file with whisper-cli and returns the recognised text.
///
/// The source WAV is a temporary capture artifact: it is deleted after the
/// transcription (success or failure) so the temp dir cannot fill up.
pub fn transcribe(app: &AppHandle, wav_path: &Path) -> Result<String, String> {
    // whisper-cli appends `.json` to the -of base path.
    let out_base = wav_path.with_extension("spotai_out");
    // whisper-cli appends the extension to the -of base path, so the JSON
    // lives at `{out_base}.json`. `with_extension` would *replace* the
    // trailing extension instead of appending, so build the path manually.
    let json_path = PathBuf::from(format!("{}.json", out_base.display()));
    // The guard deletes the WAV and the JSON when this function returns, no
    // matter which branch (including the `?` early returns below).
    let _cleanup = TranscriptionCleanup {
        wav: wav_path,
        json: Some(json_path.clone()),
    };

    if !is_installed(app) {
        return Err("Whisper is not downloaded yet. Open Settings → Voice to install it.".into());
    }

    let exe = exe_path(app);
    let model = model_path(app);

    let mut command = std::process::Command::new(&exe);
    command
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(wav_path)
        .arg("-oj") // JSON output
        .arg("-np") // no console prints
        .arg("-of")
        .arg(&out_base)
        // Run from the Release folder so the ggml DLLs resolve.
        .current_dir(
            exe.parent()
                .ok_or_else(|| "whisper-cli folder is missing".to_string())?,
        );

    // whisper-cli is a console application; without CREATE_NO_WINDOW Windows
    // flashes an ugly cmd window for the duration of the transcription.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = command
        .output()
        .map_err(|e| format!("Could not run whisper-cli: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "whisper-cli exited with an error".to_string()
        } else {
            stderr
        });
    }

    let raw = std::fs::read_to_string(&json_path)
        .map_err(|_| "whisper-cli produced no output".to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "whisper-cli output was not valid JSON".to_string())?;

    let text = value
        .get("transcription")
        .and_then(|arr| arr.as_array())
        .map(|segments| {
            segments
                .iter()
                .filter_map(|seg| seg.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<&str>>()
                .join(" ")
        })
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("No speech detected".into());
    }
    Ok(text)
}
