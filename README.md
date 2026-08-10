# SpotAI v1.3.3 🚀

> **The ultra-fast, Raycast-inspired AI Spotlight launcher for Windows.**  
> Access local LLMs (Ollama, LM Studio) or cloud models (OpenAI, Anthropic, OpenRouter, DeepSeek) anywhere with a single shortcut (`Alt + Space`).

| Light theme | Dark theme |
| :---: | :---: |
| ![SpotAI in light theme](SpotAI_UI.png) | ![SpotAI in dark theme](SpotAI_UI-dark.png) |

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-orange.svg?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/jaimitus)
[![Release](https://img.shields.io/badge/version-1.3.3-cyan.svg)](https://github.com/jaimitus/SpotAI/releases)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Backend-Rust-orange.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/Frontend-React%2019-61dafb.svg)](https://reactjs.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📝 Release History

Every version's changes — from v1.0.0 to the latest — live in the versioned [CHANGELOG.md](CHANGELOG.md), generated from git tags with `npm run changelog:all` and committed automatically by the Release workflow.

---

## 🔥 Key Features

- ⚡ **Instant Spotlight Access (`Alt + Space`)**: Summon SpotAI anywhere on your desktop in less than 100ms.
- 📋 **Automatic Clipboard Context Capture**: Selected text or copied code is automatically attached as context for instant explanation, refactoring, or translation.
- 🦙 **Ollama Local & Network Server Support**: Full compatibility with Ollama running locally or on a remote server/IP on your local network (e.g. `http://192.168.1.100:11434`).
- ☁️ **Multi-Provider Cloud AI**: Native support for **OpenAI**, **Anthropic (Claude)**, **Groq**, **DeepSeek**, plus local **LM Studio** — and **any OpenAI-compatible endpoint** (OpenRouter, Mistral, Together, vLLM…) with a custom base URL, API key and model.
- 🎯 **Native Auto-Insert (`Ctrl + Enter`)**: Insert AI responses directly into your active text editor, code editor, or browser with one click.
- 📐 **Dynamic Window Moving & Resizing**: Drag the title bar to position SpotAI anywhere, and resize it freely (drag the bottom edge or corner) — the size is remembered between sessions.
- 🔒 **Encrypted Storage**: Sensitive API keys are stored securely using the Windows Credential Manager.
- ⌨️ **Configurable Global Hotkey**: The `Alt + Space` shortcut can be changed to any combo (e.g. `Ctrl + Shift + Space`) from Settings.
- 🧠 **Custom System Prompt**: Define your own system prompt applied to every request, or keep SpotAI's built-in default.
- 💬 **Multi-turn Chat**: Conversations with memory, persisted between sessions, with a one-click "New chat".
- 🚀 **Auto-start with Windows**: Launch SpotAI automatically when you log in (toggle in Settings → General).
- 🔄 **Automatic Updates**: SpotAI checks GitHub Releases on startup and installs & restarts in one click (Tauri updater, signed).
- 🎙️ **Voice Input (Dictation)**: Hold `Alt + V` (or press the mic button) to speak and release to transcribe straight into the prompt — no typing.
- 📦 **Zero Heavy Dependencies**: Lightweight native Windows binary built with Tauri v2 and Rust.

---

## 🎙️ Voice Input (Dictation)

Speak instead of typing: hold **`Alt + V`** (or click the microphone button in the toolbar) to record, then release — the recognised text is injected straight into the prompt, ready to send with `Enter`.

Two transcription engines are available in **Settings → General → Speech-to-text engine**:

- 🪟 **Native (Windows SAPI)** — zero setup. Uses the Windows speech recognizer in live dictation mode with short silence timeouts for instant results.
- 🧠 **Whisper (whisper.cpp)** — more accurate and multilingual (en/es/de/pt/fr). The first time you pick it, a download (binary + model) is offered from Settings; afterwards everything runs **locally and offline**. You can choose the **model size** (Tiny / Base / Small) and the **recognition language** — see *Tuning Whisper* below. Recordings are also saved as WAV so the Whisper engine can transcribe them.

### The Whisper install panel (3 phases)

| 1 · Before download | 2 · During download | 3 · Ready |
| :---: | :---: | :---: |
| ![Whisper panel before download](visual-test/01-whisper-before.webp) | ![Whisper panel during download](visual-test/02-whisper-during.webp) | ![Whisper panel ready](visual-test/03-whisper-after.webp) |
| Shows the **Download Whisper model** button for the selected size (Tiny/Base/Small). | A live progress bar tracks the binary and model download phases. | A green check confirms **Whisper model ready** with the installed model size. |

### Tuning Whisper: model size & recognition language

In **Settings → Voice** you can adjust how Whisper transcribes:

- 🎚️ **Recognition language** — whisper's automatic detection on short clips often assumes **English** and produces nonsense on other languages. Pin the spoken language (**Auto / English / Español / Deutsch / Português / Français**) for reliable dictation; when nothing is pinned, the app defaults to your **interface language** automatically.
- 📦 **Model size** — **Tiny (~75 MB)** is the fast default, while **Base (~145 MB)** and **Small (~466 MB)** are noticeably more accurate on non-English speech (at the cost of slower transcription). Switching only downloads the model you pick — the binary is shared, and sizes you've already downloaded switch instantly.

> 💡 **Tip**: for dictation in Spanish (or any non-English language), pick **Base** or **Small** and pin **Español** — the Tiny model is fast but often misrecognises words.

> 💡 **Tip**: Whisper runs fully offline after the one-time download. The native engine needs the Windows speech language pack for your language.

---

## 🧪 Testing & CI

- **Unit tests**: `cargo test` covers provider parsing, history bounding, message formatting, host validation and credential masking; `npm test` (Vitest) covers i18n completeness across **en/es/de** and the action prompt templates.
- **Continuous Integration** (`.github/workflows/ci.yml`): typecheck, unit tests and production build on every push/PR.
- **Releases** (`.github/workflows/release.yml`): pushing a `vX.Y.Z` tag builds, signs and **publishes the GitHub Release automatically** (no draft step) with the installers, `.sig` signatures, the portable zip and the `latest.json` updater manifest — zero manual steps. The workflow also regenerates [CHANGELOG.md](CHANGELOG.md) from the full tag history and commits it to `main` as `github-actions[bot]`. Requires two repository secrets:
  - `TAURI_SIGNING_PRIVATE_KEY` — the content of `~/.tauri/spotai.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key password (leave empty when the key has none)

> ℹ️ The version is managed in a single place: `src-tauri/tauri.conf.json`. The frontend reads it at build time, so bumping the version there is enough for the installers and the in-app UI.

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Space` | Show / Hide SpotAI overlay *(configurable in Settings)* |
| `Alt + V` | Hold to record voice input, release to transcribe into the prompt |
| `Esc` | Close / Hide SpotAI window |
| `Enter` | Submit prompt |
| `Shift + Enter` | Insert new line in prompt box |
| `↑ / ↓` | Navigate prompt history |
| `Ctrl + Enter` | Auto-insert the last response into the previous app |
| `Ctrl + ,` | Open Settings Modal |
| `/` + `↑/↓` + `Enter` | Open the slash command palette and pick a command |
| `Ctrl + V` (with a screenshot) | Attach an image as context for vision models |

### / Commands (type and press Enter to run directly)

| Command | Action |
| :--- | :--- |
| `/new` | Start a new conversation |
| `/theme` | Toggle between dark / light theme |
| `/capture` | Capture a screen region |
| `/incognito` | Toggle incognito mode |
| `/settings` | Open the settings modal |
| `/hide` | Hide the window |
| `/clear` | Clear the current conversation |
| `/explain` | Explain selected code or text |
| `/fix` | Fix a bug in selected code |
| `/refactor` | Refactor selected code |
| `/summarize` | Summarize selected text |
| `/translate` | Translate the selected text |
| `/improve` | Improve writing quality and tone |
| `/comment` | Add clear inline documentation |

---

## 🚀 Quick Download & Installation

Download the latest version from [GitHub Releases](https://github.com/jaimitus/SpotAI/releases/latest):

- 🗂️ **Portable (no install)**: `SpotAI-Portable.zip` — unzip and run `SpotAI.exe` directly, nothing to install (requires Windows 10/11 with WebView2).
- ⚡ **Installer (NSIS)**: `SpotAI_1.3.3_x64-setup.exe`
- 📦 **Installer (MSI)**: `SpotAI_1.3.3_x64_en-US.msi`

*(All assets — installers, portable zip, updater signatures and `latest.json` — are attached to the GitHub Release. Note: the portable build does not auto-update; use an installer if you want the built-in updater.)*

---

## 🛠️ Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (1.75+)
- Windows 10 / 11 Build Environment

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jaimitus/SpotAI.git
   cd SpotAI
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   ```bash
   npx tauri dev
   ```

4. **Build production binaries**:
   ```bash
   npx tauri build
   ```

### Publishing updates (auto-updater)

1. Generate the signing keypair once (keep the **private key secret**; the `.pub` file goes into `tauri.conf.json` → `plugins.updater.pubkey`):
   ```bash
   npx tauri signer generate -w ~/.tauri/spotai.key
   ```
2. Build and sign the update bundles (produces the `.sig` signatures next to the MSI/NSIS installers):
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/spotai.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npx tauri build
   ```
3. **Publish a new GitHub Release** — just push the tag and the `release.yml` workflow does everything automatically (build, signing, **automatic publishing**, changelog update):
   ```bash
   git tag v1.3.3 && git push origin v1.3.3
   ```
   The app checks `https://github.com/jaimitus/SpotAI/releases/latest/download/latest.json` on startup, so that file must exist as a release asset. Two ways to get it:
   - **Recommended:** use [`tauri-action`](https://github.com/tauri-apps/tauri-action) in the workflow — it builds, uploads the installers + `.sig` files and generates `latest.json` automatically.
   - **Manual:** upload the installers and their `.sig` files from `src-tauri/target/release/bundle/{msi,nsis}/`, then create `latest.json` with the static format and upload it too:
     ```json
     {
       "version": "1.3.3",
       "notes": "Release notes",
       "pub_date": "2026-08-10T12:26:02Z",
       "platforms": {
         "windows-x86_64": {
           "signature": "<content of the .sig file>",
           "url": "https://github.com/jaimitus/SpotAI/releases/download/v1.3.3/SpotAI_1.3.3_x64-setup.exe"
         }
       }
     }
     ```

---

## ☕ Support the Project

If you find SpotAI helpful, consider supporting its development:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-orange.svg?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/jaimitus)

---

## 🏗️ Architecture

```
SpotAI
├── src-tauri/               # Native Rust Backend (Tauri v2)
│   ├── src/
│   │   ├── commands.rs      # Tauri API commands (Streaming, Ollama, Browser Launcher)
│   │   ├── native_input.rs  # Windows native input injection & paste (Ctrl+V)
│   │   ├── secure_store.rs  # Local DPAPI secure credential storage
│   │   ├── voice.rs         # Voice capture (cpal) + Windows SAPI dictation
│   │   ├── whisper.rs       # whisper.cpp download & offline transcription
│   │   ├── ai/              # LLM providers & streaming (OpenAI-compatible, Ollama)
│   │   └── lib.rs           # Window management, Tray icon & Global Hotkey
│   └── tauri.conf.json      # Tauri app configuration & capabilities
└── src/                     # React 19 Frontend
    ├── components/          # SpotlightWindow, ResponsePanel, SettingsModal, ActionChips
    ├── hooks/               # useLLMStream, useClipboardContext
    └── lib/                 # i18n, Prompts, Tauri API bridges, Providers
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">Crafted with ❤️ by <a href="https://github.com/jaimitus">jaimitus</a></p>
