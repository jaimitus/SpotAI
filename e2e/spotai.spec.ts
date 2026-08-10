import { expect, test } from "@playwright/test";

test("renders the spotlight shell with title and input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SpotAI", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator("textarea").first(),
  ).toBeVisible();
});

test("light theme applies through the Settings modal and persists", async ({ page }) => {
  await page.goto("/");
  // The window starts on the saved/default theme (dark).
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTitle("Settings (Ctrl+,)").click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  // Live preview without saving.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Close via Escape without saving: the preview must revert to the saved theme.
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("slash palette lists system actions and capture button is present", async ({ page }) => {
  // Screen capture and voice input require the Tauri desktop runtime, so inject
  // the mock to make the toolbar buttons visible.
  await page.addInitScript(buildTauriMock());
  await page.goto("/");
  await page.locator("textarea").first().fill("/");
  // The system actions (new chat, theme, capture, settings…) show in the palette.
  await expect(page.getByText("New chat", { exact: true })).toBeVisible();
  await expect(page.getByText("Capture screen region", { exact: true })).toBeVisible();
  // The dedicated capture toolbar button exists.
  await expect(page.getByTitle("Capture screen region").last()).toBeVisible();
});

test("typing /theme + Enter directly toggles the theme without browsing the palette", async ({ page }) => {
  await page.goto("/");
  const textarea = page.locator("textarea").first();
  const initial = await page.locator("html").getAttribute("data-theme");

  // Type the exact keyword and press Enter — the command runs immediately.
  await textarea.fill("/theme");
  await page.keyboard.press("Enter");

  // Playwright's expect auto-retries, so this assertion waits up to 5s for
  // the React state update to propagate and flips the theme attribute.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", initial);
  // The prompt is cleared so the palette closes.
  await expect(textarea).toHaveValue("");
});

test("typing /new + Enter starts a new chat and clears the prompt", async ({ page }) => {
  await page.goto("/");
  const textarea = page.locator("textarea").first();

  await textarea.fill("/new");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  await expect(textarea).toHaveValue("");
});

test("partial slash query like /cap still opens the fuzzy palette", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").first().fill("/cap");
  // toBeVisible auto-retries, no need for an explicit wait — existing palette
  // tests do the same.
  await expect(page.getByText("Capture screen region", { exact: true })).toBeVisible();
});

test("input is ready; send stays disabled until a model is available", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("textarea").first()).toBeVisible();
  // Without a running local engine or a cloud API key there is no model yet,
  // so the send button must stay disabled even with a typed prompt.
  await page.locator("textarea").first().fill("hello");
  await expect(page.getByTitle("Send prompt")).toBeDisabled();
});

// In the browser test runner there is no Tauri runtime, so `getWhisperStatus`
// always reports "not installed". To exercise Tauri-backed states we inject a
// minimal `__TAURI_INTERNALS__` mock that answers the relevant commands like
// the Rust backend would. `engine` controls what `stop_voice_capture` reports.
function buildTauriMock(engine: "native" | "whisper" = "native"): string {
  return `
(() => {
  const callbacks = new Map();
  const listeners = new Map();
  let callbackId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: (callback) => {
      callbackId += 1;
      callbacks.set(callbackId, callback);
      return callbackId;
    },
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case "get_whisper_status":
          return { installed: true, installing: false, modelSize: 77718640 };
        case "get_api_key_status":
          return {};
        case "check_ollama_health":
          return { ollama: false, ollamaVersion: null };
        case "fetch_cloud_models":
        case "fetch_local_models":
        case "fetch_lmstudio_models":
          return [];
        case "register_shortcut":
          return { registered: true, error: null };
        // The real backend resolves this by registering the callback passed as
        // args.handler (an id from transformCallback). Capture it per event so
        // tests can dispatch events through window.__tauriEmit later.
        case "plugin:event|listen": {
          const handler = callbacks.get(args.handler);
          if (handler && args.event) {
            if (!listeners.has(args.event)) listeners.set(args.event, []);
            listeners.get(args.event).push(handler);
          }
          return () => undefined;
        }
        case "start_voice_capture":
        case "set_voice_engine":
        case "transcribe_voice_wav":
          return null;
        case "stop_voice_capture":
          return {
            path: "spotai_voice_test.wav",
            durationSecs: 1.2,
            engine: "${engine}",
          };
        default:
          return null;
      }
    },
    postMessage: () => undefined,
    convertFileSrc: (path) => path,
  };
  // Test hook: dispatch a Tauri event to every listener registered for it.
  window.__tauriEmit = (event, payload) => {
    const cbs = listeners.get(event) || [];
    for (const cb of cbs) cb({ payload });
  };
})();
`;
}

test("whisper shows ready state instead of the download button when installed", async ({ page }) => {
  await page.addInitScript(buildTauriMock());
  await page.goto("/");
  await page.getByTitle("Settings (Ctrl+,)").click();

  const voiceSection = page.locator("section", { hasText: "Speech-to-text engine" });
  // Switch the speech engine from Native to Whisper to reveal the install panel.
  await voiceSection.getByRole("switch").click();

  // The mocked backend reports Whisper as downloaded, so the panel shows the
  // ready state (with the model size) instead of the download button.
  // Substring match: the model size sits in a nested span of the same node.
  await expect(voiceSection.getByText("Whisper model ready")).toBeVisible();
  await expect(
    voiceSection.getByRole("button", { name: "Download Whisper model", exact: true }),
  ).toHaveCount(0);
  // The installed model size (74.1 MB for 77718640 bytes) is displayed too.
  await expect(voiceSection.getByText("74.1 MB", { exact: true })).toBeVisible();
});

test("whisper without a download still offers the install button", async ({ page }) => {
  // No Tauri mock: the browser fallback reports installed: false, so the panel
  // must offer the download button instead of the ready state.
  await page.goto("/");
  await page.getByTitle("Settings (Ctrl+,)").click();

  const voiceSection = page.locator("section", { hasText: "Speech-to-text engine" });
  await voiceSection.getByRole("switch").click();

  await expect(
    voiceSection.getByRole("button", { name: "Download Whisper model", exact: true }),
  ).toBeVisible();
  await expect(voiceSection.getByText("Whisper model ready")).toHaveCount(0);
});

test("microphone button starts recording when the whisper engine is configured", async ({ page }) => {
  // The mock is what drives the whisper path: `stop_voice_capture` reports
  // engine "whisper", so the stop flow transcribes the WAV. The localStorage
  // seed mirrors a user who picked Whisper in Settings. Without the mock,
  // `startVoiceCapture()` would reject in the browser and `toggleVoiceCapture`
  // would reset the recording state right after starting it — so the recording
  // assertions would be a false positive.
  await page.addInitScript(() => {
    localStorage.setItem(
      "spotai.settings.v1",
      JSON.stringify({ voiceEngine: "whisper" }),
    );
  });
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");

  const micButton = page.getByRole("button", { name: "Voice input" });
  await micButton.click();

  // Recording starts: the pulse indicator strip appears and the mic button
  // switches to a stop control.
  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();
  await expect(page.getByText("Release Alt+V to stop", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible();

  // Press again to stop: with the whisper engine the recorded WAV is
  // transcribed locally, so the "Transcribing…" state takes over.
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Transcribing…", { exact: true })).toBeVisible();
});

test("voice-transcribed event injects the recognised text into the prompt", async ({ page }) => {
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");
  const textarea = page.locator("textarea").first();

  // Run a capture: start, then stop. The whisper flow enters the
  // "Transcribing…" state and the voice-transcribed listener is registered.
  await page.getByRole("button", { name: "Voice input" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Transcribing…", { exact: true })).toBeVisible();

  // Simulate the backend emitting the transcription result. This relies on the
  // `voice-transcribed` listener being registered before we dispatch — safe
  // here because the listeners useEffect runs at mount, well before the two
  // clicks and the "Transcribing…" wait above.
  await page.evaluate(() => {
    (window as unknown as {
      __tauriEmit: (event: string, payload: unknown) => void;
    }).__tauriEmit("voice-transcribed", {
      text: "Hola, esto es una prueba de voz",
      error: null,
    });
  });

  // The recognised text lands in the prompt and the transcribing state clears.
  await expect(textarea).toHaveValue("Hola, esto es una prueba de voz");
  await expect(page.getByText("Transcribing…", { exact: true })).toHaveCount(0);
});

test("voice-transcribed error shows the toast instead of injecting text", async ({ page }) => {
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");
  const textarea = page.locator("textarea").first();

  // Run a capture so the whisper flow enters the "Transcribing…" state and the
  // voice-transcribed listener is registered (same ordering as the success test).
  await page.getByRole("button", { name: "Voice input" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Transcribing…", { exact: true })).toBeVisible();

  // Simulate the backend reporting a failed transcription (no text).
  await page.evaluate(() => {
    (window as unknown as {
      __tauriEmit: (event: string, payload: unknown) => void;
    }).__tauriEmit("voice-transcribed", {
      text: null,
      error: "Microphone not found",
    });
  });

  // The error toast appears with the backend message, the prompt stays empty
  // and the transcribing state clears.
  await expect(page.getByText("Microphone not found", { exact: true })).toBeVisible();
  await expect(textarea).toHaveValue("");
  await expect(page.getByText("Transcribing…", { exact: true })).toHaveCount(0);
});

test("microphone button is hidden without the Tauri runtime", async ({ page }) => {
  // In a plain browser the voice backend does not exist, so the mic button
  // must not be rendered (it would be dead UI that always errors on click).
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Voice input" }),
  ).toHaveCount(0);
  // The settings button should still be present (it is always available).
  await expect(page.getByTitle("Settings (Ctrl+,)")).toBeVisible();
});

test("capture button is hidden without the Tauri runtime", async ({ page }) => {
  // No Tauri mock: screen capture needs the desktop runtime to capture
  // monitors, so the toolbar button must not render in browser mode.
  await page.goto("/");
  // The slash palette still shows the action (it is a text command), but the
  // dedicated toolbar button should be absent.
  await expect(
    page.getByTitle("Capture screen region"),
  ).toHaveCount(0);
  // Sanity check: the incognito button (always available) is still present.
  await expect(
    page.getByRole("button", { name: "Incognito" }),
  ).toBeVisible();
});
