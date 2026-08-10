# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Auto-generated from git history with `npm run changelog:all`.

## [Unreleased]

## 📚 Documentation

- add versioned CHANGELOG.md generated from git tags (npm run changelog:all)

## 🔧 CI & Build

- auto-generate and commit CHANGELOG.md in the release workflow (fetch-depth 0)
- pass changelog to tauri-action via releaseBody output


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
