# SpotAI v1.1.0 🚀

> **The ultra-fast, Raycast-inspired AI Spotlight launcher for Windows.**  
> Access local LLMs (Ollama, LM Studio) or cloud models (OpenAI, Anthropic, OpenRouter, DeepSeek) anywhere with a single shortcut (`Alt + Space`).

![SpotAI Interface](SpotAI_UI.png)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-orange.svg?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/jaimitus)
[![Release](https://img.shields.io/badge/version-1.1.0-cyan.svg)](https://github.com/jaimitus/SpotAI/releases)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Backend-Rust-orange.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/Frontend-React%2018-61dafb.svg)](https://reactjs.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 🌟 What's New in v1.1.0

- 🌐 **Multi-Language i18n Support**:
  - Full interface translation in **English (Default)**, **Español (España)**, and **Deutsch (German)**.
  - Action prompt templates automatically adapt to your active display language so the AI responds in your preferred language.
- 🎛️ **Custom Prompt Action Buttons**:
  - Create and manage custom shortcut action buttons with your own prompt templates in Settings -> Custom Buttons tab.
  - Appears highlighted in amber for instant 1-click execution.
- 🔗 **Native External Browser Integration**:
  - Seamlessly launches external links & GitHub repository in your default system browser (Chrome/Edge/Firefox).

---

## 🔥 Key Features

- ⚡ **Instant Spotlight Access (`Alt + Space`)**: Summon SpotAI anywhere on your desktop in less than 100ms.
- 📋 **Automatic Clipboard Context Capture**: Selected text or copied code is automatically attached as context for instant explanation, refactoring, or translation.
- 🦙 **Ollama Local & Network Server Support**: Full compatibility with Ollama running locally or on a remote server/IP on your local network (e.g. `http://192.168.1.100:11434`).
- ☁️ **Multi-Provider Cloud AI**: Native support for **OpenAI**, **Anthropic (Claude)**, **OpenRouter**, **DeepSeek**, **LM Studio**, and Custom OpenAI-compatible endpoints.
- 🎯 **Native Auto-Insert (`Ctrl + V`)**: Insert AI responses directly into your active text editor, code editor, or browser with one click.
- 📐 **Dynamic Window Moving & Drag Resizing**: Position SpotAI anywhere on screen and drag the bottom handle to resize the response box comfortably with generous hit targets.
- 🔒 **Encrypted Storage**: Sensitive API keys are stored securely using local DPAPI encryption.
- 📦 **Zero Heavy Dependencies**: Lightweight native Windows binary built with Tauri v2 and Rust.

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Space` | Show / Hide SpotAI overlay |
| `Esc` | Close / Hide SpotAI window |
| `Enter` | Submit prompt |
| `Shift + Enter` | Insert new line in prompt box |
| `Ctrl + ,` | Open Settings Modal |

---

## 🚀 Quick Download & Installation

Download the latest version from [GitHub Releases](https://github.com/jaimitus/SpotAI/releases/tag/v1.1.0):

- ⚡ **Standalone Executable**: `SpotAI.exe` (Run directly without installing)
- 📦 **Windows Installer**: `SpotAI-Setup.exe` or `SpotAI-Installer.msi`
- 🗂️ **Portable Package**: `SpotAI-Portable.zip`

*(All compiled release packages are stored in `dist_release/`)*

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
│   │   └── lib.rs           # Window management, Tray icon & Global Hotkey
│   └── tauri.conf.json      # Tauri app configuration & capabilities
└── src/                     # React 18 Frontend
    ├── components/          # SpotlightWindow, ResponsePanel, SettingsModal, ActionChips
    ├── hooks/               # useLLMStream, useClipboardContext
    └── lib/                 # i18n, Prompts, Tauri API bridges, Providers
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">Crafted with ❤️ by <a href="https://github.com/jaimitus">jaimitus</a></p>
