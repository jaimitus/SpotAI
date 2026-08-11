# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Auto-generated from git history with `npm run changelog:all`.

## [v1.4.3] - 2026-08-11

### ✨ New

- **AI-suggested document actions**: instead of the fixed three suggested
  questions, the model now reads the indexed documents and proposes questions
  and concrete actions related to their real content (no documents indexed =
  nothing shown).
- **One-click suggestions**: clicking a suggested question or action sends it
  immediately — no need to press Enter or the send arrow.
- **Regenerate suggestions**: a refresh button next to the suggestion header
  asks the model for a different set of suggestions without touching the
  documents or the prompt.

### 🔧 Internal

- New non-streaming `complete_text()` provider helper (Ollama, Anthropic and
  OpenAI-compatible) reused by the suggestion engine.
- New `suggest_document_actions` command with a pure, unit-tested
  `parse_suggested_actions` parser (`?` questions / `!` actions).
- Suggested-action chips are capped to 6 and generation is debounced and
  dependency-scoped so unrelated settings changes never trigger a model call.

## [v1.4.2] - 2026-08-11

## 📚 Documentation

- translate remaining README feature bullets to English
- add CHANGELOG entry for v1.4.1

## 🧹 Maintenance

- untrack build artifacts (dist/) committed by the merged PR

## 📦 Other

- feat(rag,ui): v1.4.2 - RAG auto-context toggle, context badge, clickable citations and reveal in folder
- feat(rag,stream): RAG doc sync, suggested questions and streaming token batching

## [v1.4.1] - 2026-08-11

## 📚 Documentation

- add CHANGELOG entry for v1.4.0

## 📦 Other

- feat(rag,drop): v1.4.1 - native file drag & drop fix + many more RAG formats

## [v1.4.0] - 2026-08-11

## 📚 Documentation

- Release v1.4.0 with RAG Local, Real Embeddings, CLI Injection & Multilingual Voice
- add CHANGELOG entry for v1.3.4

## 📦 Other

- feat(rag,cli): v1.4.0 - local RAG (sqlite-vec + Ollama embeddings), /exec CLI injection, advanced LLM sampling params

## [v1.3.4] - 2026-08-10

### ✨ New Features
- 🎚️ **Recognition Language Setting**: Whisper now transcribes in the language you pin (**Auto / English / Español / Deutsch / Português / Français**) instead of relying on its unreliable auto-detection, which on the tiny model tends to assume English and produce nonsense on other languages. When nothing is pinned, the app defaults to your **interface language** automatically — a Spanish UI user gets Spanish dictation without touching Settings.
- 📦 **Whisper Model Size Selector**: Choose **Tiny (~75 MB)**, **Base (~145 MB)** or **Small (~466 MB)** right in the download panel. Bigger models are noticeably more accurate on non-English speech. Switching only downloads the model you pick — the binary is shared and already-downloaded sizes switch instantly.
### 🧪 Tests
- 🧩 New Rust tests cover the model-id resolution and the language→`-l` flag mapping; new E2E tests verify the engine/mic/language startup sync and the model-switch flow (an uninstalled model shows the download button, a downloaded one shows ready instantly).
### 📚 Documentation
- 📖 The README Voice section now documents the model picker and the recognition language (tip: pick **Base/Small + Español** for Spanish dictation), with screenshots of the Base panel and the transcribed result.

## [v1.3.3] - 2026-08-10

### 🐛 Bug Fixes
- 🎙️ **Dictation Actually Works**: Three fixes make transcription reliable end-to-end. The recorded WAV header now carries the **real device sample rate** (no more hardcoded 16 kHz that made Whisper hear desktop mics at 44.1/48 kHz ~3× slower and fail), the selected **voice engine + microphone are synced to the backend at startup** (no more reverting to the broken native engine after a restart), and silent captures show an honest **"No speech detected"** instead of injecting a `[BLANK_AUDIO]` token.
### 🧪 Tests
- 📼 **WAV Header Tests**: New Rust tests prove `write_wav` writes the real sample rate (48 kHz ramp + a 5-rate sweep from 8 to 48 kHz) — regression-proof against the hardcoded header.
- 🔁 **Startup Sync E2E**: Playwright tests verify the selected Whisper engine *and* microphone are pushed to the backend on boot, reproducing the lost-engine bug exactly.

## [v1.3.2] - 2026-08-10

### 🐛 Bug Fixes
- 🪟 **No More Console Window**: whisper-cli now spawns with `CREATE_NO_WINDOW`, so dictation no longer flashes an ugly cmd window while the WAV is transcribed.
- ⏱️ **Dynamic Transcription Timeout**: The wait for Whisper now scales with the recording length (min 20s, cap 5min) instead of a fixed 9s that used to give up before local CPU transcription finished on longer captures. The native engine keeps its fast 9s.
### ♻️ Refactors
- 🧩 **Pure Helpers + Unit Tests**: `formatCaptureTime`/`formatDuration` (`src/lib/format.ts`) and `getVoiceTranscriptionTimeout` (`src/lib/voiceTimeout.ts`) were extracted from the spotlight UI into pure, tested modules — 11 new Vitest cases cover the locale mapping, mm:ss formatting and the timeout bounds (9s native / 20s floor / 5min cap).

## [v1.3.1] - 2026-08-10

### ✨ New Features
- 🕐 **Voice Session Indicators**: The recording bar shows when the capture started (localized `started at HH:MM:SS`) plus a live elapsed counter, and the "Transcribing…" bar shows the total processed duration — so old captures are easy to tell apart.
- ⚠️ **Microphone Permission Warning**: When the Windows native recognizer fails with "speech privacy policy was not accepted", Settings shows an actionable banner (with a friendly toast instead of the cryptic OS error) that clears automatically once a transcription succeeds.
- 🧹 **Automatic WAV Cleanup**: Recorded WAVs are deleted after transcription on every path (success AND failure), the native engine no longer writes an unused WAV at all, and a startup sweep removes stale voice artifacts older than 24h — the temp folder can never fill the disk.
- 🔄 **Instant Releases**: The Release workflow now publishes the GitHub release automatically when the build finishes (no manual draft step).
### 🐛 Bug Fixes
- 🎯 **Ghost-Click Fix**: A stale `voice-transcribed` error (e.g. the OS recognizer failing while the user is STILL recording) no longer hides the recording bar — the recording state now only resets when the event belongs to the current session.

## [v1.3.0] - 2026-08-10

### ✨ New Features
- 🎙️ **Voice Input (Dictation)**: Press **Alt+V** and speak — Windows SAPI transcribes your words straight into the prompt. A dedicated microphone button, per-capture recording bar, and error handling round out the flow.
- 🧠 **Local Whisper (whisper.cpp) Engine**: Download the binary + tiny model (~75 MB) right from Settings, and dictations are transcribed fully offline with whisper-cli.
- 🎚️ **Microphone Picker**: Settings lists every input device (with the OS default marked) so you can choose exactly which mic to record from.
- 🧪 **Voice E2E Tests**: Playwright tests cover recording start/stop, transcription injection, error toasts, browser-mode button hiding, and Whisper download states.
- 📸 **Visual Documentation**: Screenshots of the Whisper panel and dictation flow are documented in the README.

## [v1.2.3] - 2026-08-10

### ✨ New Features
- ⌨️ **English Slash-Command Keywords**: Direct keyword execution (`/new`, `/theme`, `/capture`, `/explain`…) — type and press Enter to run immediately, no palette browsing needed.
- 🏷️ **Keyword Badges in the Palette**: Each slash-command row now shows its direct keyword (`/new`, `/fix`, …) so users discover the shortcuts.
- 🧪 **E2E Tests for Direct Commands**: Playwright tests verify `/theme` + Enter toggles the theme, `/new` clears the prompt, and fuzzy matching still works.
- 🧹 **Cleaned Up i18n**: Removed unused system-command translation keys (`systemNewChat`, `systemToggleTheme`, …) from all 5 languages.
- 📖 **Slash-Commands Documentation**: Full table of the 14 commands (`/new` … `/comment`) now in the README Keyboard Shortcuts section.
- 🎨 **Themed Context Scrollbar**: The captured-context preview scrollbar uses the same `custom-scroll` class as the response panel, adapting to dark/light themes.
- 🔍 **Prominent Update Check**: The "Check for updates" button moved to a visible position in the General tab.
- 📝 **README Release History**: Version-specific "What's New" sections moved to the versioned [CHANGELOG.md](CHANGELOG.md); the README now focuses on Key Features and quick-start.

## [v1.2.2] - 2026-08-10

### ✨ New Features
- 📸 **Screen Region Capture**: Click the camera button (or run `/capture`), drag a rectangle over any monitor like a Snipping Tool, and the crop goes straight to a vision model as image context.
- 🗣️ **Text-to-Speech**: A 🔊 button on every assistant message reads the reply aloud with native Windows synthesis — offline, free, no API.
- 🧠 **Ollama Model Manager**: In Settings → Providers, see models currently loaded in memory with RAM/VRAM usage (`ollama ps`), **pull** new models by name, or **delete** them — all without leaving the app.
- ⌨️ **Dedicated Quick Actions**: `Ctrl+Shift+T` (translate), `Ctrl+Shift+R` (refactor), `Ctrl+Shift+K` (summarize) read your clipboard and open SpotAI with the action + text ready. On completion the answer is **auto-inserted into the previous app** — or only copied to the clipboard if you disable auto-insert in Settings.
- 🕶️ **Incognito Mode**: A toggle that stops SpotAI from saving chats or history.
- 🔍 **Global Conversation Search**: The chat list search now also matches text *inside* messages, not just titles.
- 📚 **Prompt Library**: Manage reusable prompt templates in Settings and run them from the `/` palette.
- ⚙️ **System Commands in the `/` Palette**: `/new`, `/theme`, `/capture`, `/incognito`, `/settings`, `/hide`, `/clear`…
- 🧾 **Manual Context Paste**: Paste or type context by hand, with the capture timestamp shown in the context strip — plus a scrollable preview and always-available refresh/copy/dismiss buttons.
- 🤖 **Smarter Context Strip**: The captured-context bar is now always visible (with refresh), shows a live scrollable preview, and reports clipboard read failures.
- 📋 **Automatic Changelog**: Release notes are generated from conventional commits and a versioned [CHANGELOG.md](CHANGELOG.md) is committed to the repo automatically.
- 🧪 **More Tests**: Rust tests for `ollama ps` parsing & retry policy, Vitest for pinned conversations, and Playwright E2E running in CI.

## [v1.2.1] - 2026-08-10

### ✨ New Features
- 🗂️ **Conversation Manager**: Every chat is saved to a browsable list — reopen past conversations, rename them, search, or delete them. Your old single-chat history is migrated automatically.
- 🔎 **Slash Commands** (`/`): Type `/` in the input to open a Raycast-style command palette with every action chip and your custom buttons.
- 🖼️ **Image Context (Vision)**: Paste a screenshot directly into the input (`Ctrl+V`) and ask vision-capable models about it.
- 🧠 **Model Memory per Provider**: SpotAI remembers the last model you picked for each provider.
- 🛡️ **Anthropic History Fix**: Message history is sanitized so Claude never rejects a turn after a failed generation.
- 🌍 **Two New Languages**: Full interface + action prompts in **Português** and **Français** (now 5 languages, enforced by tests).
- 💾 **Settings Backup & Restore**: Export your settings to a JSON file and re-import them on any machine.
- 🔄 **Manual Update Check**: A "Check for updates" button in Settings with one-click install & restart.
- 🧹 **Data Controls**: Clear prompt history, conversations, or all saved API keys from Settings.
- 📏 **Model Sizes in the Picker**: Ollama model sizes (GB/MB) now shown in the model dropdown.
- 🎨 **UI Polish**: Compact popover animations, refined streaming caret, discoverability hints.
- 🌗 **Themes (Dark / Light / System)**: An Appearance setting swaps the whole interface through CSS theme tokens; **System** follows your Windows color scheme live.

## [v1.2.0] - 2026-08-09

### ✨ New Features
- 💬 **Multi-turn Chat with Memory**: Conversations persist between sessions with smart history trimming.
- 🔌 **Custom OpenAI-Compatible Providers**: Connect **any** endpoint — OpenRouter, Mistral, Together, vLLM…
- 🚀 **Auto-start with Windows**: Launch SpotAI automatically at log-in with a single toggle.
- 🔄 **Signed Automatic Updates**: SpotAI checks GitHub Releases on startup and installs & restarts in one click (Tauri updater, signed).
- 📐 **Resizable Window with Memory**: Drag the bottom edge or corner to resize freely; the size is remembered.
- 🖱️ **Window Near Cursor**: The window opens beside your mouse cursor, clamped to the monitor work area.
- ⚡ **Faster Boot**: Local-model health checks now time out in 2–3s instead of freezing startup.
- 🌐 **100% Translated Interface**: Full i18n coverage in **English**, **Español** and **Deutsch**.
- 📋 **Copy Code Blocks**: Every Markdown code block has a hover copy button.
- 🔍 **Smarter Model Picker**: Live search, full keyboard navigation, refresh button and grouped sections.
- 🎓 **First-Run Onboarding**: A quick 3-step guide when nothing is configured yet.
- 🧪 **Unit Tests & CI**: Rust + Vitest tests and GitHub Actions CI/release workflows.

## [v1.1.0] - 2026-08-08

### 🌐 Multi-Language i18n Support
- Full interface translation in **English (Default)**, **Español** and **Deutsch**.
- Action prompt templates automatically adapt to the active display language.

### 🎛️ Custom Prompt Action Buttons
- Create and manage custom shortcut action buttons with your own prompt templates in Settings.

### 🔗 Native External Browser Integration
- Opens external links and the GitHub repository in the default system browser.

## [v1.0.0] - 2026-08-08

### 🎉 Initial Release
- ⚡ Instant spotlight access via the global `Alt + Space` hotkey.
- 📋 Automatic clipboard context capture for selected text or code.
- 🦙 Ollama local and network server support.
- ☁️ Multi-provider cloud AI: OpenAI, Anthropic, Groq, DeepSeek, LM Studio and any OpenAI-compatible endpoint.
- 🎯 Native auto-insert of AI responses into the active app with `Ctrl + Enter`.
- 🔒 Encrypted API key storage via the Windows Credential Manager.
- 🔄 Signed automatic updates through the Tauri updater.

