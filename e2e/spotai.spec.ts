import { expect, test } from "@playwright/test";

test("renders the spotlight shell with title and input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SpotAI", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator("textarea").first(),
  ).toBeVisible();
});

test("light theme applies through the Settings modal and persists", async ({ page }) => {
  // First tests in the file pay the vite dev-server cold compile, which can
  // exceed the default 30s timeout when the machine is under load.
  test.setTimeout(60_000);
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
//
// The voice mock is stateful like the real backend: `start_voice_capture`
// flips the recording flag before returning, and `voice_state` reflects it.
// `opts.startError` / `opts.stopError` simulate a backend that is already
// recording (Alt+V race) or already released, for the reconciliation tests.
function buildTauriMock(
  engine: "native" | "whisper" = "native",
  opts: { startError?: string | null; stopError?: string | null } = {},
): string {
  const startError = JSON.stringify(opts.startError ?? null);
  const stopError = JSON.stringify(opts.stopError ?? null);
  return `
(() => {
  const callbacks = new Map();
  const listeners = new Map();
  let callbackId = 0;
  let voiceState = { recording: false, engine: "${engine}", selectedMic: "", language: null };
  // Stateful whisper install: only the tiny model is downloaded initially.
  let whisper = {
    installed: true,
    installing: false,
    modelSize: 77718640,
    activeModel: "tiny",
    installedModels: [{ id: "tiny", size: 77718640 }],
  };
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
          return whisper;
        case "set_whisper_model":
          // Mirror the Rust backend: switching only changes the active model id
          // (no download); the panel shows the download button when the chosen
          // model file is missing.
          {
            const id = String(args.model || "tiny").trim().toLowerCase();
            const present = whisper.installedModels.find((m) => m.id === id);
            whisper = {
              ...whisper,
              activeModel: id,
              installed: Boolean(present),
              modelSize: present ? present.size : 0,
            };
          }
          return whisper;
        case "list_microphones":
          return [
            { id: "device:Microphone Array", name: "Microphone Array", isDefault: true },
            { id: "device:Headset Mic", name: "Headset Mic", isDefault: false },
          ];
        case "set_selected_microphone":
          // Mirror the Rust backend: the chosen mic is stored (empty clears
          // it) and reported by voice_state from then on.
          voiceState = {
            ...voiceState,
            selectedMic: String(args.mic || "").trim(),
          };
          return null;
        case "save_api_keys":
        case "delete_custom_api_key":
          return null;
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
        case "voice_state":
          return voiceState;
        case "start_voice_capture":
          if (${startError}) {
            // The backend is ALREADY capturing (e.g. started by Alt+V): the
            // call rejects but the capture keeps running, so voice_state must
            // keep reporting recording: true.
            voiceState = { ...voiceState, recording: true };
            throw new Error(${startError});
          }
          voiceState = { ...voiceState, recording: true };
          return null;
        case "set_voice_engine":
          // Mirror the Rust backend: the engine preference is applied
          // immediately and reported by voice_state from then on (the frontend
          // syncs it at startup and whenever Settings is saved).
          voiceState = {
            ...voiceState,
            engine: args.engine === "whisper" ? "whisper" : "native",
          };
          return null;
        case "set_voice_language":
          // Mirror the Rust backend: pinning a language stores it ("auto" or
          // empty clears it back to auto-detection).
          {
            const lang = String(args.language || "auto").trim().toLowerCase();
            voiceState = {
              ...voiceState,
              language: !lang || lang === "auto" ? null : lang,
            };
          }
          return null;
        case "transcribe_voice_wav":
          return null;
        case "stop_voice_capture":
          if (${stopError}) {
            // The backend already stopped (e.g. Alt+V was released): recording
            // clears regardless of the rejection.
            voiceState = { ...voiceState, recording: false };
            throw new Error(${stopError});
          }
          voiceState = { ...voiceState, recording: false };
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

test("switching to an uninstalled Whisper model offers the download", async ({ page }) => {
  await page.addInitScript(buildTauriMock());
  await page.goto("/");
  await page.getByTitle("Settings (Ctrl+,)").click();

  const voiceSection = page.locator("section", { hasText: "Speech-to-text engine" });
  // Switch the engine to Whisper to reveal the panel (tiny is downloaded in
  // the mock, so it starts in the ready state).
  await voiceSection.getByRole("switch").click();
  await expect(voiceSection.getByText("Whisper model ready")).toBeVisible();

  // The mock only has Tiny downloaded. Switching to Base must flip the panel
  // to the download state — the switch itself never triggers a download.
  await voiceSection.getByRole("button", { name: /Base/ }).click();
  await expect(
    voiceSection.getByRole("button", { name: "Download Whisper model", exact: true }),
  ).toBeVisible();
  await expect(voiceSection.getByText("Whisper model ready")).toHaveCount(0);

  // Switching back to Tiny (already downloaded) restores the ready state
  // instantly, without any download.
  await voiceSection.getByRole("button", { name: /Tiny/ }).click();
  await expect(voiceSection.getByText("Whisper model ready")).toBeVisible();
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

test("settings lists microphones and persists the chosen one", async ({ page }) => {
  await page.addInitScript(buildTauriMock());
  await page.goto("/");
  await page.getByTitle("Settings (Ctrl+,)").click();

  const voiceSection = page.locator("section", { hasText: "Speech-to-text engine" });
  // The voice section now has two selects: the recognition-language picker
  // (first) and the microphone picker (second, inside the cyan box).
  const micSelect = voiceSection.locator("select").nth(1);

  // The mocked backend reports two microphones, the first marked as default.
  await expect(micSelect.locator("option")).toHaveCount(3); // default + 2 devices
  await expect(
    micSelect.locator("option", { hasText: "Microphone Array" }),
  ).toHaveText(/Microphone Array.*default/);

  // Pick the headset and save. The save closes the modal (its header text is
  // the visible marker; the toolbar Settings button stays rendered either way).
  await micSelect.selectOption("Headset Mic");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("SpotAI Settings", { exact: true })).toHaveCount(0);

  // The selection is persisted so it survives a reload.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("spotai.settings.v1") || "{}"),
  );
  expect(stored.selectedMic).toBe("Headset Mic");
});

test("the selected voice engine, microphone and language are synced to the backend at startup", async ({ page }) => {
  // A user who picked Whisper, a specific mic and Spanish recognition in
  // Settings (persisted across restarts). The mock starts on the NATIVE engine
  // with no mic and auto language, exactly like the Rust backend does on every
  // launch — so if the boot sync works, the backend must report ALL THREE
  // preferences without the user touching Settings.
  await page.addInitScript(() => {
    localStorage.setItem(
      "spotai.settings.v1",
      JSON.stringify({
        voiceEngine: "whisper",
        selectedMic: "Headset Mic",
        voiceLanguage: "es",
      }),
    );
  });
  await page.addInitScript(buildTauriMock("native"));
  await page.goto("/");

  // The boot effect pushes the persisted preferences to the backend: voice_state
  // must report whisper + the chosen mic + the pinned language. expect.poll
  // retries because the sync is async and the settings load happens on mount.
  await expect
    .poll(async () => {
      const state = await page.evaluate(() =>
        (window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string) => Promise<{
              recording: boolean;
              engine: string;
              selectedMic: string;
              language: string | null;
            }>;
          };
        }).__TAURI_INTERNALS__.invoke("voice_state"),
      );
      return state;
    })
    .toEqual({
      recording: false,
      engine: "whisper",
      selectedMic: "Headset Mic",
      language: "es",
    });
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

test("recording bar shows the session start time", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "spotai.settings.v1",
      JSON.stringify({ voiceEngine: "whisper" }),
    );
  });
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");

  await page.getByRole("button", { name: "Voice input" }).click();

  // The recording bar shows a localized "started at HH:MM:SS · MM:SS" session
  // marker so old captures can be told apart from fresh ones.
  await expect(page.getByText(/started at \d{2}:\d{2}:\d{2}/)).toBeVisible();
});

test("transcribing state shows the recorded duration", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "spotai.settings.v1",
      JSON.stringify({ voiceEngine: "whisper" }),
    );
  });
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");

  // Run a capture and stop it: the whisper flow enters the "Transcribing…"
  // state, which must now also show the length of the processed recording.
  await page.getByRole("button", { name: "Voice input" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();

  await expect(page.getByText("Transcribing…", { exact: true })).toBeVisible();
  // The mocked backend reports a 1.2s capture → formatted as "00:01".
  await expect(page.getByText(/duration 00:01/)).toBeVisible();
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

test("voice start that races with the backend reconciles into recording instead of an error toast", async ({ page }) => {
  // The backend is already capturing (e.g. started by Alt+V): start_voice_capture
  // rejects with "already in progress", but voice_state reports recording: true.
  // The UI must enter the recording state instead of showing a stale toast that
  // would leave the button desynced from the real backend.
  await page.addInitScript(
    buildTauriMock("native", { startError: "Voice capture is already in progress" }),
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Voice input" }).click();

  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();
  await expect(page.getByText("Voice capture is already in progress")).toHaveCount(0);

  // The user can now stop the backend capture normally.
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Recording…", { exact: true })).toHaveCount(0);
});

test("voice stop when the backend already released clears state without an error", async ({ page }) => {
  // The UI thinks it is recording, but the backend already stopped (e.g. the
  // user released Alt+V). stop_voice_capture rejects, yet voice_state reports
  // recording: false → the UI must clear instead of showing an error toast.
  await page.addInitScript(
    buildTauriMock("native", { stopError: "No voice capture is in progress" }),
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Voice input" }).click();
  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Stop recording" }).click();

  await expect(page.getByText("Recording…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No voice capture is in progress")).toHaveCount(0);
});

test("stale voice-transcribed error during recording does not hide the recording bar", async ({ page }) => {
  // The OS recognizer can error out WHILE the capture is still running (e.g.
  // the Windows speech privacy policy is not accepted). That stale event does
  // not belong to a transcription wait (no stop yet), so it must not reset the
  // recording state — the backend keeps capturing and the bar stays.
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");

  await page.getByRole("button", { name: "Voice input" }).click();
  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();

  // The recognizer reports a failure while we are still recording.
  await page.evaluate(() => {
    (window as unknown as {
      __tauriEmit: (event: string, payload: unknown) => void;
    }).__tauriEmit("voice-transcribed", {
      text: null,
      error: "RecognizeAsync failed: The speech privacy policy was not accepted",
    });
  });

  // The recording continues: the bar and the stop control remain, and the
  // stale error does NOT surface as a toast.
  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible();
  await expect(page.getByText("RecognizeAsync failed")).toHaveCount(0);
});

test("settings shows a mic permission warning when the native recognizer is blocked", async ({ page }) => {
  // The native recognizer fails because Windows has not granted the app
  // microphone access ("speech privacy policy was not accepted"). Settings
  // must surface an actionable warning instead of leaving the user guessing.
  await page.addInitScript(buildTauriMock());
  await page.goto("/");

  await page.getByRole("button", { name: "Voice input" }).click();
  await page.evaluate(() => {
    (window as unknown as {
      __tauriEmit: (event: string, payload: unknown) => void;
    }).__tauriEmit("voice-transcribed", {
      text: null,
      error: "RecognizeAsync failed: The speech privacy policy was not accepted",
    });
  });

  // Opening Settings reveals the warning in the Voice section.
  await page.getByTitle("Settings (Ctrl+,)").click();
  await expect(
    page.getByText("Microphone permission needed", { exact: true }),
  ).toBeVisible();

  // Dismissing hides it (and persists the dismissal).
  await page.getByRole("button", { name: "Dismiss" }).last().click();
  await expect(
    page.getByText("Microphone permission needed", { exact: true }),
  ).toHaveCount(0);
});

test("a successful transcription clears the mic permission warning live", async ({ page }) => {
  // Seed the persisted flag so the warning shows even before any error event,
  // then prove a successful transcription hides it while Settings stays open.
  await page.addInitScript(() => {
    localStorage.setItem("spotai.mic-permission.v1", "1");
  });
  await page.addInitScript(buildTauriMock("whisper"));
  await page.goto("/");

  // Run a full capture first (the modal would cover the mic button), then open
  // Settings: the seeded flag makes the warning visible.
  await page.getByRole("button", { name: "Voice input" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByTitle("Settings (Ctrl+,)").click();
  await expect(
    page.getByText("Microphone permission needed", { exact: true }),
  ).toBeVisible();

  // A successful transcription while Settings is open must notify the modal
  // via the cleared event and hide the warning live.
  await page.evaluate(() => {
    (window as unknown as {
      __tauriEmit: (event: string, payload: unknown) => void;
    }).__tauriEmit("voice-transcribed", {
      text: "Esto funciona",
      error: null,
    });
  });

  // The warning disappears without reopening Settings, and the persisted flag
  // is gone so it does not come back on the next open either.
  await expect(
    page.getByText("Microphone permission needed", { exact: true }),
  ).toHaveCount(0);
  const stored = await page.evaluate(() =>
    localStorage.getItem("spotai.mic-permission.v1"),
  );
  expect(stored).toBeNull();
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
