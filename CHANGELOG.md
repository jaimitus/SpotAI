# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Auto-generated from git history with `npm run changelog:all`.

## [Unreleased]

## 🔧 CI & Build

- pass changelog to tauri-action via releaseBody output


## [v1.2.2] - 2026-08-10

## 📦 Other

- v1.2.2: screen region capture, TTS, Ollama model manager, quick actions with auto-insert, incognito mode, global search, prompt library, system slash commands, configurable context strip, automatic changelog, Playwright E2E

## [v1.2.1] - 2026-08-10

## 🧹 Maintenance

- add portable package to release workflow and fix download section in README

## 📦 Other

- v1.2.1: conversation manager, slash commands, image context, 5 languages, light/system themes, settings backup & update check, model sizes, UI polish

## [v1.2.0] - 2026-08-09

## ✨ New Features

- localize prompt templates for Spanish and German, add GitHub repo link and v1.1.0 version badges
- Release v1.1.0 - Multi-language support (EN, ES, DE) and Custom Prompt Action buttons

## 🐛 Bug Fixes

- launch external browser natively on Windows when clicking GitHub repository links

## 📚 Documentation

- update README.md for v1.1.0 with new features and Buy Me A Coffee badge

## 🧹 Maintenance

- remove binaries from root and add *.exe, *.msi, *.zip to .gitignore

## 📦 Other

- v1.2.0: multi-turn chat, custom OpenAI-compatible providers, autostart, signed auto-updater, resizable window, i18n, tests & CI
- release: v1.0.0 initial release of SpotAI Spotlight Launcher

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
