//! Voice input: microphone recording with `cpal` and WAV export with `hound`.
//!
//! cpal::Stream is NOT `Send` / `Sync` on some platforms (Windows WASAPI), so
//! the stream is created, owned, and dropped entirely on a **dedicated thread**.
//! The `VoiceState` only holds a channel and a thread handle.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ── Types ────────────────────────────────────────────────────────────────────

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
    recording: AtomicBool,
    temp_dir: Mutex<Option<PathBuf>>,
    /// Channel to signal the recording thread to stop.
    stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    /// When recording, the thread handle we can join to get samples back.
    handle: Mutex<Option<std::thread::JoinHandle<Vec<f32>>>>,
    /// Flag set when the recording thread has finished and results are ready.
    done: Arc<AtomicBool>,
    /// Samples collected by the recording thread (moved back on stop).
    result: Arc<Mutex<Option<Vec<f32>>>>,
    /// Guards the WinRT recognizer so only one runs at a time.
    recognizer_active: Arc<AtomicBool>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(VoiceEngine::Native),
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

    let handle = std::thread::Builder::new()
        .name("spotai-voice-recorder".into())
        .spawn(move || record_thread(stop_rx, done, result))
        .map_err(|e| format!("Failed to spawn recording thread: {e}"))?;

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

    // Join the thread and get the samples.
    let samples = if let Some(handle) = state.handle.lock().take() {
        handle.join().unwrap_or_default()
    } else {
        Vec::new()
    };

    if samples.is_empty() {
        return Err("No audio captured".into());
    }

    let duration_secs = samples.len() as f64 / 16000.0;
    let temp_dir = state
        .temp_dir
        .lock()
        .clone()
        .unwrap_or_else(std::env::temp_dir);
    let wav_path = temp_dir.join(format!("spotai_voice_{}.wav", timestamp_ns()));

    write_wav(&wav_path, &samples).map_err(|e| format!("Failed to write WAV: {e}"))?;

    let engine = *state.engine.lock();
    Ok((wav_path, duration_secs, engine))
}

// ── Recording thread ─────────────────────────────────────────────────────────

fn record_thread(
    stop_rx: mpsc::Receiver<()>,
    done: Arc<AtomicBool>,
    result: Arc<Mutex<Option<Vec<f32>>>>,
) -> Vec<f32> {
    // Build the input stream INSIDE this thread so cpal::Stream lives here.
    let samples = Arc::new(Mutex::new(Vec::new()));
    let stream = match build_input_stream_on_thread(samples.clone()) {
        Ok(stream) => stream,
        Err(e) => {
            tracing::error!("voice: failed to build input stream: {e}");
            done.store(true, Ordering::Release);
            return Vec::new();
        }
    };

    // Block until the stop signal arrives.
    let _ = stop_rx.recv();

    // Drop the stream – this stops audio capture.
    drop(stream);
    std::thread::sleep(std::time::Duration::from_millis(150));

    let recorded = std::mem::take(&mut *samples.lock());
    *result.lock() = Some(recorded.clone());
    done.store(true, Ordering::Release);
    recorded
}

fn build_input_stream_on_thread(
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone input device found".to_string())?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Could not read default input config: {e}"))?;

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

    Ok(stream)
}

// ── WAV writing ──────────────────────────────────────────────────────────────

fn write_wav(path: &std::path::Path, samples: &[f32]) -> Result<(), hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
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