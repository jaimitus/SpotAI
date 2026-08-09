//! SpotAI Tauri v2 application entry point.

mod ai;
mod commands;
mod native_input;
mod secure_store;

use ai::{ActiveStream, AiHttpClient};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Only fire on key release to avoid stomping Ctrl+C / Alt+Tab
                    // while the user is still holding the modifier down.
                    if event.state() != ShortcutState::Released {
                        return;
                    }
                    // Compare against the currently registered shortcut, so
                    // user changes from the settings modal are honoured at
                    // runtime.
                    let registered = app
                        .state::<commands::ShortcutRegistration>()
                        .current();
                    let matches = registered
                        .as_ref()
                        .map(|target| shortcut_matches(target, shortcut))
                        .unwrap_or_else(|| {
                            // Fallback to the legacy default if for some reason
                            // the registration state has not been populated.
                            shortcut.matches(Modifiers::ALT, Code::Space)
                        });
                    if matches {
                        commands::toggle_from_shortcut(app);
                    }
                })
                .build(),
        )
        .manage(ActiveStream::default())
        .manage(commands::ShortcutRegistration::default())
        .manage(AiHttpClient::new().expect("failed to create the shared HTTP client"))
        .invoke_handler(tauri::generate_handler![
            commands::get_clipboard_text,
            commands::get_shortcut_status,
            commands::set_global_shortcut,
            commands::set_clipboard_text,
            commands::auto_insert_text,
            commands::fetch_local_models,
            commands::fetch_lmstudio_models,
            commands::fetch_cloud_models,
            commands::send_prompt_stream,
            commands::cancel_stream,
            commands::save_api_keys,
            commands::get_api_key_status,
            commands::delete_api_key,
            commands::toggle_window,
            commands::hide_window,
            commands::show_window,
            commands::check_ollama_health,
            commands::open_external_url,
        ])
        .setup(|app| {
            let shortcut_status = app.state::<commands::ShortcutRegistration>();
            if let Err(error) = commands::register_global_shortcut(app.handle(), &shortcut_status) {
                tracing::error!(%error);
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
                .tooltip(&format!(
                    "SpotAI | {}",
                    commands::shortcut_to_string(
                        &shortcut_status
                            .current()
                            .unwrap_or_else(|| Shortcut::new(Some(Modifiers::ALT), Code::Space))
                    )
                ))
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

            tracing::info!(
                "SpotAI is ready. Press {} to toggle it.",
                commands::shortcut_to_string(
                    &shortcut_status
                        .current()
                        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::ALT), Code::Space))
                )
            );
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

/// Compares two shortcuts structurally. `Shortcut` derives `PartialEq` so a
/// plain `==` would work, but we keep an explicit helper so the intent is
/// obvious at the call site and the comparison can be expanded later if the
/// plugin gains richer equality semantics.
fn shortcut_matches(a: &Shortcut, b: &Shortcut) -> bool {
    a.key == b.key && a.mods == b.mods
}