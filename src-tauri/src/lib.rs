//! SpotAI Tauri v2 application entry point.

mod ai;
mod commands;
mod native_input;
mod rag;
mod secure_store;
mod voice;
mod whisper;

use ai::{ActiveStream, AiHttpClient};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "spotai=info,warn".into()),
        )
        .compact()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::show_window_internal(app, false);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Capture after release so the physical Alt key cannot interfere with Ctrl+C.
                    let voice_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyV);
                    if *shortcut == voice_shortcut {
                        if event.state() == ShortcutState::Pressed {
                            // Start voice capture when Alt+V is pressed.
                            let voice = app.state::<voice::VoiceState>();
                            match voice::start_capture(&voice, app.clone()) {
                                Ok(()) => {
                                    let _ = app.emit(
                                        "voice-status",
                                        serde_json::json!({ "recording": true, "error": null }),
                                    );
                                }
                                Err(e) => {
                                    // The backend may already be recording (e.g.
                                    // started from the UI button): reflect that
                                    // instead of an error toast, so the UI never
                                    // desyncs from the actual capture state.
                                    let recording =
                                        voice::voice_status(&voice).recording;
                                    let payload = if recording {
                                        serde_json::json!({
                                            "recording": true,
                                            "error": null,
                                        })
                                    } else {
                                        serde_json::json!({
                                            "recording": false,
                                            "error": e,
                                        })
                                    };
                                    let _ = app.emit("voice-status", payload);
                                }
                            }
                        } else if event.state() == ShortcutState::Released {
                            // Stop voice capture on release.
                            let voice = app.state::<voice::VoiceState>();
                            match voice::stop_capture(&voice) {
                                Ok((path, duration, engine)) => {
                                    let _ = app.emit(
                                        "voice-stopped",
                                        serde_json::json!({
                                            "path": path.to_string_lossy(),
                                            "durationSecs": duration,
                                            "engine": engine,
                                        }),
                                    );
                                }
                                Err(e) => {
                                    let _ = app.emit(
                                        "voice-status",
                                        serde_json::json!({ "recording": false, "error": e }),
                                    );
                                }
                            }
                        }
                        return;
                    }

                    if event.state() == ShortcutState::Released {
                        if let Some(action) = commands::quick_action_for(shortcut) {
                            commands::dispatch_quick_action(app, action);
                            return;
                        }
                        let active = app
                            .state::<commands::ShortcutRegistration>()
                            .active
                            .lock()
                            .clone();
                        if active.is_some_and(|active| active == *shortcut) {
                            commands::toggle_from_shortcut(app);
                        }
                    }
                })
                .build(),
        )
        .manage(ActiveStream::default())
        .manage(commands::ShortcutRegistration::default())
        .manage(voice::VoiceState::new())
        .manage(whisper::WhisperState::new())
        .manage(rag::RagState::new())
        .manage(AiHttpClient::new().expect("failed to create the shared HTTP client"))
        .invoke_handler(tauri::generate_handler![
            commands::get_clipboard_text,
            commands::set_clipboard_text,
            commands::auto_insert_text,
            commands::fetch_local_models,
            commands::fetch_lmstudio_models,
            commands::fetch_openai_compatible_models,
            commands::fetch_cloud_models,
            commands::send_prompt_stream,
            commands::register_shortcut,
            commands::cancel_stream,
            commands::save_api_keys,
            commands::get_api_key_status,
            commands::delete_api_key,
            commands::save_custom_api_key,
            commands::delete_custom_api_key,
            commands::get_custom_api_key_status,
            commands::toggle_window,
            commands::hide_window,
            commands::show_window,
            commands::check_ollama_health,
            commands::open_external_url,
            commands::export_settings_to_file,
            commands::import_settings_from_file,
            commands::write_text_to_file,
            commands::ollama_pull_model,
            commands::ollama_delete_model,
            commands::fetch_ollama_ps,
            commands::capture_screens,
            commands::start_voice_capture,
            commands::stop_voice_capture,
            commands::voice_state,
            commands::set_voice_engine,
            commands::set_voice_language,
            commands::list_microphones,
            commands::set_selected_microphone,
            commands::get_whisper_status,
            commands::install_whisper,
            commands::set_whisper_model,
            commands::transcribe_voice_wav,
            commands::rag_index_files,
            commands::rag_query,
            commands::rag_get_stats,
            commands::rag_get_documents,
            commands::rag_remove_document,
            commands::analyze_command_safety,
            commands::execute_shell_command,
        ])
        .setup(|app| {
            let shortcut_status = app.state::<commands::ShortcutRegistration>();
            let default_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            if let Err(error) =
                commands::register_global_shortcut(app.handle(), &shortcut_status, default_shortcut)
            {
                tracing::error!(%error);
            }
            commands::register_quick_actions(app.handle());

            // Register the voice push-to-talk shortcut (Alt+V).
            let voice_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyV);
            if let Err(error) = app.global_shortcut().register(voice_shortcut) {
                tracing::error!(%error, "failed to register push-to-talk shortcut (Alt+V)");
            }
            // Voice captures are written to the app temp dir. Sweep leftovers
            // from crashed/interrupted captures so they cannot fill the disk.
            if let Ok(temp_dir) = app.path().temp_dir() {
                app.state::<voice::VoiceState>().set_temp_dir(temp_dir.clone());
                voice::cleanup_stale_captures(&temp_dir);
            }
            // Whisper artifacts live in the app data dir.
            if let Ok(data_dir) = app.path().app_data_dir() {
                app.state::<whisper::WhisperState>()
                    .set_dir(data_dir.join("whisper"));
                
                // Initialize RAG database in app data dir
                tauri::async_runtime::block_on(async {
                    let rag_state = app.state::<rag::RagState>();
                    if let Err(e) = rag_state.initialize(&data_dir).await {
                        tracing::error!(%e, "Failed to initialize RAG database");
                    }
                });
            }

            let show_item =
                MenuItem::with_id(app, "show", "Show SpotAI", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;
            let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

            TrayIconBuilder::with_id("spotai-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("SpotAI | Alt+Space")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => commands::show_window_internal(app, false),
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let visible = app
                            .get_webview_window("main")
                            .and_then(|window| window.is_visible().ok())
                            .unwrap_or(false);
                        if visible {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        } else {
                            commands::show_window_internal(app, false);
                        }
                    }
                })
                .build(app)?;

            tracing::info!("SpotAI is ready. Press Alt+Space to toggle it.");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("SpotAI terminated unexpectedly");
}