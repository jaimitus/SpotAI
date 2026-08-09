//! Native keyboard integration for selected-text capture and auto-insert.

use arboard::Clipboard;
use std::{thread, time::Duration};

fn read_text() -> Option<String> {
    Clipboard::new().ok()?.get_text().ok()
}

pub fn clipboard_text() -> Option<String> {
    read_text().filter(|text| !text.trim().is_empty())
}

fn write_text(text: String) -> Result<(), String> {
    Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_text(text)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn send_ctrl_key(key: u16) -> Result<(), String> {
    use std::{mem::size_of, thread, time::Duration};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL,
    };

    fn send_single(key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) {
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
    }

    let vk_key = VIRTUAL_KEY(key);
    // Press Ctrl
    send_single(VK_CONTROL, KEYBD_EVENT_FLAGS(0));
    thread::sleep(Duration::from_millis(25));
    // Press V
    send_single(vk_key, KEYBD_EVENT_FLAGS(0));
    thread::sleep(Duration::from_millis(45));
    // Release V
    send_single(vk_key, KEYEVENTF_KEYUP);
    thread::sleep(Duration::from_millis(25));
    // Release Ctrl
    send_single(VK_CONTROL, KEYEVENTF_KEYUP);

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn send_ctrl_key(_key: u16) -> Result<(), String> {
    Err("Native keyboard injection is currently supported on Windows only".into())
}

/// Copies the current selection without permanently changing the clipboard.
pub fn capture_selected_text() -> Option<String> {
    #[cfg(not(target_os = "windows"))]
    {
        return read_text().filter(|text| !text.trim().is_empty());
    }

    #[cfg(target_os = "windows")]
    {
        let previous = read_text();
        let fallback = previous
            .clone()
            .filter(|text| !text.trim().is_empty());
        let marker = format!(
            "__SPOTAI_CAPTURE_{}__",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        if write_text(marker.clone()).is_err() {
            return previous.filter(|text| !text.trim().is_empty());
        }
        if send_ctrl_key(0x43).is_err() {
            let _ = write_text(previous.unwrap_or_default());
            return fallback;
        }

        let mut captured = None;
        for _ in 0..12 {
            thread::sleep(Duration::from_millis(15));
            if let Some(value) = read_text() {
                if value != marker {
                    captured = Some(value);
                    break;
                }
            }
        }

        let _ = write_text(previous.unwrap_or_default());

        captured
            .filter(|text| !text.trim().is_empty())
            .or(fallback)
    }
}

/// Places text on the clipboard and pastes it into the previously focused app.
pub fn auto_insert(text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Cannot insert an empty response".into());
    }

    // Keep the user's clipboard intact after the target application receives Ctrl+V.
    // Refuse to replace it when Windows cannot read the original value safely.
    let previous = read_text().ok_or_else(|| {
        "Cannot safely auto-insert while the system clipboard is unavailable".to_string()
    })?;
    write_text(text)?;
    thread::sleep(Duration::from_millis(200));
    let paste_result = send_ctrl_key(0x56);
    thread::sleep(Duration::from_millis(180));
    let _ = write_text(previous);
    paste_result
}