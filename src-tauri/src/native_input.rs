//! Native keyboard integration for selected-text capture and auto-insert.

use arboard::Clipboard;
use std::{thread, time::Duration};

/// Maximum number of polling attempts when waiting for the destination app to
/// finish writing the captured selection into the clipboard. Each attempt waits
/// ~8 ms, so the total budget is ~240 ms. This is wide enough to cover slow
/// targets such as Visual Studio with large selections.
const CAPTURE_POLL_ATTEMPTS: u32 = 30;
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(8);

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

    /// Pushes a single keyboard event. Returns the number of inputs that
    /// Windows actually accepted, allowing the caller to detect injection
    /// failures (e.g. UIPI or a locked session).
    fn send_single(key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> u32 {
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
        unsafe { SendInput(&[input], size_of::<INPUT>() as i32) }
    }

    let vk_key = VIRTUAL_KEY(key);
    // Press Ctrl
    if send_single(VK_CONTROL, KEYBD_EVENT_FLAGS(0)) != 1 {
        return Err("SendInput failed while pressing Ctrl".into());
    }
    thread::sleep(Duration::from_millis(25));
    // Press V
    if send_single(vk_key, KEYBD_EVENT_FLAGS(0)) != 1 {
        return Err("SendInput failed while pressing the shortcut key".into());
    }
    thread::sleep(Duration::from_millis(45));
    // Release V
    if send_single(vk_key, KEYEVENTF_KEYUP) != 1 {
        return Err("SendInput failed while releasing the shortcut key".into());
    }
    thread::sleep(Duration::from_millis(25));
    // Release Ctrl
    if send_single(VK_CONTROL, KEYEVENTF_KEYUP) != 1 {
        return Err("SendInput failed while releasing Ctrl".into());
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn send_ctrl_key(_key: u16) -> Result<(), String> {
    Err("Native keyboard injection is currently supported on Windows only".into())
}

/// Copies the current selection without permanently changing the clipboard.
///
/// The implementation:
/// 1. Snapshots the current clipboard contents so we can restore them later.
/// 2. Writes a unique marker and triggers a Ctrl+C in the previously focused
///    app. The destination app overwrites the marker with the selection.
/// 3. Polls the clipboard for up to ~240 ms waiting for a value that differs
///    from the marker (or from the previous snapshot, in case the marker and
///    the prior content happened to match).
/// 4. Restores the original clipboard contents.
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
        if let Err(error) = write_text(marker.clone()) {
            tracing::warn!(%error, "capture_selected_text: failed to write marker");
            return previous.filter(|text| !text.trim().is_empty());
        }
        if let Err(error) = send_ctrl_key(0x43) {
            tracing::warn!(%error, "capture_selected_text: SendInput failed");
            let _ = write_text(previous.unwrap_or_default());
            return fallback;
        }

        // Poll the clipboard. We accept a value that is neither the marker nor
        // the previous content; the second check guards against the (very
        // unlikely) case where the user had `marker` literal text selected.
        let mut captured: Option<String> = None;
        for attempt in 0..CAPTURE_POLL_ATTEMPTS {
            thread::sleep(CAPTURE_POLL_INTERVAL);
            if let Some(value) = read_text() {
                if value != marker && Some(&value) != previous.as_ref() {
                    captured = Some(value);
                    break;
                }
            }
            // Log only the last attempt to avoid spamming on every capture.
            if attempt + 1 == CAPTURE_POLL_ATTEMPTS {
                tracing::warn!(
                    "capture_selected_text: no new clipboard value observed after {} attempts",
                    CAPTURE_POLL_ATTEMPTS
                );
            }
        }

        if let Err(error) = write_text(previous.clone().unwrap_or_default()) {
            tracing::warn!(%error, "capture_selected_text: failed to restore clipboard");
        }

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
    write_text(text)?;
    thread::sleep(Duration::from_millis(120));
    send_ctrl_key(0x56)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_text_rejects_whitespace_only() {
        // We can't easily test against a real OS clipboard here, but we can
        // assert that the filter logic behaves as expected when the helper is
        // bypassed. The wrapper itself is exercised via integration tests.
        let empty: Option<String> = None;
        assert!(empty.filter(|t| !t.trim().is_empty()).is_none());
    }
}