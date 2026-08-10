//! Voice input: microphone recording with `cpal` and WAV export with `hound`.
//!
//! cpal::Stream is NOT `Send` / `Sync` on some platforms (Windows WASAPI), so
//! the stream is created, owned, and dropped entirely on a **dedicated thread**.
//! The `VoiceState` only holds a channel and a thread handle.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ── Types ────────────────────────────────────────────────────────────────────

/// An audio input device (microphone) that can be picked in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicDevice {
    pub id: String,
    pub name: String,
    /// True when this device is the OS default input device.
    pub is_default: bool,
}

/// Lists every input device exposed by the default host (WASAPI on Windows),
/// so the user can choose which microphone to record from.
pub fn list_microphones() -> Vec<MicDevice> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();
    let mut devices: Vec<MicDevice> = host
        .input_devices()
        .map(|devices| {
            devices
                .filter_map(|device| {
                    let name = device.name().ok()?;
                    let id = format!("device:{name}");
                    Some(MicDevice {
                        is_default: name == default_id,
                        id,
                        name,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    // De-duplicate identical names (WASAPI can expose the same device twice).
    let mut seen = std::collections::HashSet::new();
    devices.retain(|d| seen.insert(d.name.clone()));
    devices.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));
    devices
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceEngine {
    Native,
    Whisper,
}

impl VoiceEngine {
    pub fn from_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "whisper" => VoiceEngine::Whisper,
            _ => VoiceEngine::Native,
        }
    }
}

/// Shared state kept in the Tauri app.
///
/// The `cpal::Stream` is NOT stored here – it lives on the recording thread so
/// we never cross a Send/Sync boundary with it.
pub struct VoiceState {
    pub engine: Mutex<VoiceEngine>,
    /// Name of the microphone selected in Settings. When empty, the OS
    /// default input device is used.
    pub selected_mic: Mutex<Option<String>>,
    recording: AtomicBool,
    temp_dir: Mutex<Option<PathBuf>>,
    /// Channel to signal the recording thread to stop.
    stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    /// When recording, the thread handle we can join to get samples back
    /// (paired with the device sample rate).
    handle: Mutex<Option<std::thread::JoinHandle<(Vec<f32>, u32)>>>,
    /// Flag set when the recording thread has finished and results are ready.
    done: Arc<AtomicBool>,
    /// Samples collected by the recording thread (moved back on stop), paired
    /// with the device sample rate they were captured at.
    result: Arc<Mutex<Option<(Vec<f32>, u32)>>>,
    /// Guards the WinRT recognizer so only one runs at a time.
    recognizer_active: Arc<AtomicBool>,
}

/// Snapshot of the voice capture state, used by the frontend to reconcile its
/// UI with the backend after a start that raced with the Alt+V shortcut, a
/// hung recognizer, or when the window is re-shown mid-capture.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub recording: bool,
    pub engine: VoiceEngine,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(VoiceEngine::Native),
            selected_mic: Mutex::new(None),
            recording: AtomicBool::new(false),
            temp_dir: Mutex::new(None),
            stop_tx: Mutex::new(None),
            handle: Mutex::new(None),
            done: Arc::new(AtomicBool::new(false)),
            result: Arc::new(Mutex::new(None)),
            recognizer_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_temp_dir(&self, path: PathBuf) {
        *self.temp_dir.lock() = Some(path);
    }
}

/// Returns the current capture state so the frontend can sync its UI.
pub fn voice_status(state: &VoiceState) -> VoiceStatus {
    VoiceStatus {
        recording: state.recording.load(Ordering::Acquire),
        engine: *state.engine.lock(),
    }
}

// ── Commands called from Tauri IPC ───────────────────────────────────────────

/// Begin capturing from the default microphone.
///
/// Spawns a dedicated OS thread that owns the `cpal::Stream` and feeds samples
/// into a shared buffer.  On Windows with the native engine it also launches a
/// WinRT `SpeechRecognizer` thread that transcribes the live mic and emits a
/// `voice-transcribed` event when the speaker pauses.
pub fn start_capture(state: &VoiceState, app: AppHandle) -> Result<(), String> {
    if state.recording.swap(true, Ordering::AcqRel) {
        return Err("Voice capture is already in progress".into());
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    *state.stop_tx.lock() = Some(stop_tx);

    let done = state.done.clone();
    let result = state.result.clone();
    done.store(false, Ordering::Release);

    // Which microphone to record from (empty => OS default).
    let selected_mic = state.selected_mic.lock().clone();

    let handle = match std::thread::Builder::new()
        .name("spotai-voice-recorder".into())
        .spawn(move || record_thread(stop_rx, done, result, selected_mic))
    {
        Ok(handle) => handle,
        Err(e) => {
            // The flag was flipped above; reset it so the backend is not stuck
            // reporting "already in progress" for the rest of the session.
            state.recording.store(false, Ordering::Release);
            *state.stop_tx.lock() = None;
            return Err(format!("Failed to spawn recording thread: {e}"));
        }
    };

    *state.handle.lock() = Some(handle);

    // Native engine: transcribe the live mic with the OS recognizer.
    if *state.engine.lock() == VoiceEngine::Native {
        spawn_recognizer(state, app);
    }

    Ok(())
}

/// Stop capturing and return the WAV file path plus metadata.
///
/// Signals the recording thread to stop, waits for it to finish, writes the
/// captured samples to a temporary WAV file, and returns the file path.
pub fn stop_capture(state: &VoiceState) -> Result<(PathBuf, f64, VoiceEngine), String> {
    if !state.recording.swap(false, Ordering::AcqRel) {
        return Err("No voice capture is in progress".into());
    }

    // Signal the recording thread to stop.
    if let Some(tx) = state.stop_tx.lock().take() {
        let _ = tx.send(());
    }

    // Join the thread and get the samples plus the rate they were captured at.
    let (samples, sample_rate) = if let Some(handle) = state.handle.lock().take() {
        handle.join().unwrap_or_default()
    } else {
        (Vec::new(), 16000)
    };

    if samples.is_empty() {
        return Err("No audio captured".into());
    }

    // The device records at its own rate (commonly 44100 or 48000 Hz on
    // Windows WASAPI), never a hardcoded 16000. Using the real rate keeps the
    // duration honest and the WAV header truthful — a mismatched header would
    // make whisper hear the audio ~3x slower and fail to transcribe.
    let sample_rate = sample_rate.max(1);
    let duration_secs = samples.len() as f64 / sample_rate as f64;
    let engine = *state.engine.lock();
    // Only the Whisper engine consumes the recorded WAV (it is transcribed
    // afterwards and deleted). The native engine transcribes the live mic, so
    // writing a WAV would just litter the temp dir — return an empty path.
    if engine != VoiceEngine::Whisper {
        return Ok((PathBuf::new(), duration_secs, engine));
    }

    let temp_dir = state
        .temp_dir
        .lock()
        .clone()
        .unwrap_or_else(std::env::temp_dir);
    let wav_path = temp_dir.join(format!("spotai_voice_{}.wav", timestamp_ns()));

    write_wav(&wav_path, &samples, sample_rate)
        .map_err(|e| format!("Failed to write WAV: {e}"))?;

    Ok((wav_path, duration_secs, engine))
}

// ── Recording thread ─────────────────────────────────────────────────────────

fn record_thread(
    stop_rx: mpsc::Receiver<()>,
    done: Arc<AtomicBool>,
    result: Arc<Mutex<Option<(Vec<f32>, u32)>>>,
    selected_mic: Option<String>,
) -> (Vec<f32>, u32) {
    // Build the input stream INSIDE this thread so cpal::Stream lives here.
    let samples = Arc::new(Mutex::new(Vec::new()));
    let (stream, sample_rate) =
        match build_input_stream_on_thread(samples.clone(), selected_mic.as_deref()) {
            Ok(pair) => pair,
            Err(e) => {
                tracing::error!("voice: failed to build input stream: {e}");
                done.store(true, Ordering::Release);
                return (Vec::new(), 16000);
            }
        };

    // Block until the stop signal arrives.
    let _ = stop_rx.recv();

    // Drop the stream – this stops audio capture.
    drop(stream);
    std::thread::sleep(std::time::Duration::from_millis(150));

    let recorded = std::mem::take(&mut *samples.lock());
    *result.lock() = Some((recorded.clone(), sample_rate));
    done.store(true, Ordering::Release);
    (recorded, sample_rate)
}

fn build_input_stream_on_thread(
    samples: Arc<Mutex<Vec<f32>>>,
    selected_mic: Option<&str>,
) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    // Resolve the device the user picked in Settings; fall back to the OS
    // default when nothing is selected or the device is no longer present.
    let device = match selected_mic {
        Some(name) if !name.trim().is_empty() => {
            let mut found = None;
            if let Ok(devices) = host.input_devices() {
                for candidate in devices {
                    if candidate.name().ok().as_deref() == Some(name.trim()) {
                        found = Some(candidate);
                        break;
                    }
                }
            }
            match found {
                Some(device) => device,
                None => {
                    tracing::warn!(
                        "voice: selected microphone \"{name}\" not found, falling back to default"
                    );
                    host.default_input_device()
                        .ok_or_else(|| "No microphone input device found".to_string())?
                }
            }
        }
        _ => host
            .default_input_device()
            .ok_or_else(|| "No microphone input device found".to_string())?,
    };

    tracing::info!(
        "voice: recording from \"{}\"",
        device.name().unwrap_or_else(|_| "unknown device".into())
    );

    let config = device
        .default_input_config()
        .map_err(|e| format!("Could not read default input config: {e}"))?;
    // Capture the real rate BEFORE `config.into()` consumes it below.
    let sample_rate = config.sample_rate().0;

    let err_fn = |err| tracing::error!("cpal input stream error: {err}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                samples.lock().extend_from_slice(data);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let mut buf = samples.lock();
                buf.extend(data.iter().map(|&s| s as f32 / i16::MAX as f32));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let mut buf = samples.lock();
                buf.extend(data.iter().map(|&s| {
                    (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0)
                }));
            },
            err_fn,
            None,
        ),
        other => return Err(format!("Unsupported sample format: {other:?}")),
    }
    .map_err(|e| format!("Could not build input stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Could not start recording: {e}"))?;

    Ok((stream, sample_rate))
}

// ── WAV writing ──────────────────────────────────────────────────────────────

fn write_wav(
    path: &std::path::Path,
    samples: &[f32],
    sample_rate: u32,
) -> Result<(), hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        // Write the REAL capture rate in the header. whisper-cli resamples
        // internally, so it decodes the audio at the correct speed.
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &sample in samples {
        let amplitude = sample.clamp(-1.0, 1.0);
        let sample_i16 = (amplitude * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16)?;
    }
    writer.finalize()?;
    Ok(())
}

fn timestamp_ns() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

/// Removes stale voice capture artifacts (recorded WAVs and whisper JSON
/// output) left in the temp dir by interrupted sessions, crashes or failed
/// transcriptions. Runs once at startup so a crashed capture can never fill
/// the disk.
pub fn cleanup_stale_captures(temp_dir: &Path) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(24 * 60 * 60))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let Ok(entries) = std::fs::read_dir(temp_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Only touch our own artifacts (the WAV plus the whisper JSON output
        // which is named after the WAV with a `.spotai_out.json` suffix).
        if !name.starts_with("spotai_voice_") {
            continue;
        }
        if !(name.ends_with(".wav") || name.ends_with(".spotai_out.json")) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified < cutoff {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sets a file's modification time far in the past so it looks stale.
    fn age_file(path: &Path) {
        let old = std::time::SystemTime::UNIX_EPOCH
            + std::time::Duration::from_secs(1_700_000_000); // ~2023
        // Open for writing: on Windows `set_modified` needs FILE_WRITE_ATTRIBUTES.
        let file = std::fs::File::options().write(true).open(path).expect("open file");
        file.set_modified(old).expect("age file");
    }

    #[test]
    fn cleanup_stale_captures_removes_only_old_voice_artifacts() {
        let dir = std::env::temp_dir().join(format!("spotai_cleanup_test_{}", timestamp_ns()));
        std::fs::create_dir_all(&dir).unwrap();

        // Old artifacts (must be removed).
        let old_wav = dir.join("spotai_voice_old.wav");
        let old_json = dir.join("spotai_voice_old.spotai_out.json");
        // Fresh artifact (must be kept).
        let fresh_wav = dir.join("spotai_voice_fresh.wav");
        // Unrelated file (must be kept).
        let other = dir.join("notes.txt");

        std::fs::write(&old_wav, b"x").unwrap();
        std::fs::write(&old_json, b"{}").unwrap();
        std::fs::write(&fresh_wav, b"x").unwrap();
        std::fs::write(&other, b"x").unwrap();
        age_file(&old_wav);
        age_file(&old_json);

        cleanup_stale_captures(&dir);

        assert!(!old_wav.exists(), "stale WAV must be deleted");
        assert!(!old_json.exists(), "stale whisper JSON must be deleted");
        assert!(fresh_wav.exists(), "fresh WAV must be kept");
        assert!(other.exists(), "unrelated file must be kept");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ── Live transcription (Windows WinRT SpeechRecognizer) ────────────────────

/// Launches a dedicated thread that runs the WinRT `SpeechRecognizer` in
/// dictation mode against the live microphone.  When the speaker pauses, the
/// recognised text is emitted to the frontend as a `voice-transcribed` event.
///
/// Errors (no language pack, mic permission, silent capture…) are emitted with
/// `text: null` and a human-readable `error` message.
#[cfg(target_os = "windows")]
fn spawn_recognizer(state: &VoiceState, app: AppHandle) {
    let flag = state.recognizer_active.clone();
    // Only one recognizer may run at a time (two recognizers on the mic would
    // produce garbled text).
    if flag.swap(true, Ordering::AcqRel) {
        return;
    }

    // Clone the Arc and AppHandle for the failure path – the success path
    // moves them into the spawned thread.
    let error_flag = flag.clone();
    let error_app = app.clone();

    std::thread::Builder::new()
        .name("spotai-voice-recognizer".into())
        .spawn(move || {
            let result = transcribe_live_mic();
            flag.store(false, Ordering::Release);
            let _ = app.emit(
                "voice-transcribed",
                serde_json::json!({
                    "text": result.as_ref().ok(),
                    "error": result.as_ref().err(),
                }),
            );
        })
        .map_err(move |e| {
            error_flag.store(false, Ordering::Release);
            let _ = error_app.emit(
                "voice-transcribed",
                serde_json::json!({ "text": null, "error": format!("Failed to spawn recognizer: {e}") }),
            );
        })
        .ok();
}

#[cfg(not(target_os = "windows"))]
fn spawn_recognizer(_state: &VoiceState, _app: AppHandle) {
    // Live speech recognition requires Windows; on other platforms the voice
    // flow falls back to the recorded WAV file (Whisper engine path).
}

/// Runs the Windows.Media.SpeechRecognition `SpeechRecognizer` in dictation
/// mode against the live default microphone and returns the recognised text.
///
/// Blocks until the speaker pauses (silence). Must be called from its own
/// thread so the COM apartment initialisation does not leak into other threads.
#[cfg(target_os = "windows")]
fn transcribe_live_mic() -> Result<String, String> {
    use windows::Foundation::TimeSpan;
    use windows::Media::SpeechRecognition::{
        SpeechRecognitionResultStatus, SpeechRecognitionScenario, SpeechRecognitionTopicConstraint,
        SpeechRecognizer,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    // SAFETY: initialise COM on this dedicated thread; balanced by
    // CoUninitialize below.
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() {
            return Err(format!("Failed to initialise COM: {hr}"));
        }
    }

    let outcome = (|| -> Result<String, String> {
        let recognizer = SpeechRecognizer::new()
            .map_err(|e| format!("Failed to create SpeechRecognizer: {e}"))?;

        // Shorten the silence timeouts so the transcription returns promptly
        // after the user releases the key.
        let _ = recognizer.Timeouts().map(|timeouts| {
            let _ = timeouts.SetInitialSilenceTimeout(TimeSpan {
                Duration: 40_000_000, // 4 s (WinRT TimeSpan = 100 ns units)
            });
            let _ = timeouts.SetEndSilenceTimeout(TimeSpan {
                Duration: 12_000_000, // 1.2 s
            });
        });

        // Dictation grammar (handles free-form speech, not just commands).
        let description = windows::core::h!("dictation");
        let constraint = SpeechRecognitionTopicConstraint::Create(
            SpeechRecognitionScenario::Dictation,
            &description,
        )
        .map_err(|e| format!("Failed to create dictation constraint: {e}"))?;
        recognizer
            .Constraints()
            .map_err(|e| format!("Failed to read constraints: {e}"))?
            .Append(&constraint)
            .map_err(|e| format!("Failed to add dictation constraint: {e}"))?;

        let compilation = recognizer
            .CompileConstraintsAsync()
            .map_err(|e| format!("CompileConstraintsAsync failed: {e}"))?
            .get()
            .map_err(|e| format!("CompileConstraintsAsync result: {e}"))?;
        let compile_status = compilation
            .Status()
            .map_err(|e| format!("Failed to read compilation status: {e}"))?;
        if compile_status != SpeechRecognitionResultStatus::Success {
            return Err(format!(
                "Speech grammar compilation failed with status {compile_status:?}"
            ));
        }

        let result = recognizer
            .RecognizeAsync()
            .map_err(|e| format!("RecognizeAsync failed: {e}"))?
            .get()
            .map_err(|e| format!("RecognizeAsync result: {e}"))?;

        let status = result
            .Status()
            .map_err(|e| format!("Failed to read result status: {e}"))?;
        if status != SpeechRecognitionResultStatus::Success {
            return Err(match status {
                SpeechRecognitionResultStatus::UserCanceled => {
                    "Speech recognition was cancelled".into()
                }
                SpeechRecognitionResultStatus::TimeoutExceeded => "No speech detected".into(),
                _ => format!("Speech recognition failed with status {status:?}"),
            });
        }

        let text = result
            .Text()
            .map_err(|e| format!("Failed to read recognised text: {e}"))?
            .to_string();

        if text.trim().is_empty() {
            return Err("No speech detected".into());
        }
        Ok(text)
    })();

    // SAFETY: balances the CoInitializeEx above.
    unsafe {
        CoUninitialize();
    }
    outcome
}