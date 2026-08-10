#!/usr/bin/env bash
# Generates Markdown release notes from conventional commits.
#
# Two modes:
#   1. Release mode (default, or pass a tag like v1.2.3): writes RELEASE_NOTES.md
#      with the changes since the previous tag. Used locally (`npm run changelog`)
#      and by the Release workflow to fill the GitHub release body.
#   2. --changelog mode: walks every git tag and writes a versioned CHANGELOG.md
#      (Keep a Changelog style, with dates), including an "Unreleased" section.
#      v1.0.0/v1.1.0 have curated sections; a legacy fallback only fires when
#      those tags are absent (shallow clones), so they never duplicate.
#
# Commit message conventions (case-insensitive prefixes):
#   feat:        new feature
#   fix:         bug fix
#   perf:        performance
#   docs:        documentation
#   refactor:    code refactor
#   test:        tests
#   ci:          CI / build
#   chore:       maintenance
# Anything else falls into "Other".
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

CATS=("feat" "fix" "perf" "docs" "refactor" "test" "ci" "chore")
declare -A SECTIONS
OTHER=""
declare -A TITLES=(
  ["feat"]="## ✨ New Features"
  ["fix"]="## 🐛 Bug Fixes"
  ["perf"]="## ⚡ Performance"
  ["docs"]="## 📚 Documentation"
  ["refactor"]="## ♻️ Refactors"
  ["test"]="## 🧪 Tests"
  ["ci"]="## 🔧 CI & Build"
  ["chore"]="## 🧹 Maintenance"
)

# categorize <msg>... — fills the SECTIONS map and OTHER with the given commit
# subjects, bucketed by conventional-commit prefix.
categorize() {
  local cat
  for cat in "${CATS[@]}"; do
    SECTIONS["$cat"]=""
  done
  OTHER=""
  local msg lower matched
  for msg in "$@"; do
    [[ -n "$msg" ]] || continue
    lower="${msg,,}"
    matched=""
    for cat in "${CATS[@]}"; do
      if [[ "$lower" == "$cat:"* ]]; then
        SECTIONS["$cat"]+="- ${msg#*: }"$'\n'
        matched=1
        break
      fi
    done
    if [[ -z "$matched" ]]; then
      OTHER+="- $msg"$'\n'
    fi
  done
}

# emit_sections — prints the categorized sections (from categorize) to stdout.
emit_sections() {
  local cat
  for cat in "${CATS[@]}"; do
    if [[ -n "${SECTIONS[$cat]:-}" ]]; then
      echo "${TITLES[$cat]}"
      echo ""
      printf "%s" "${SECTIONS[$cat]:-}"
      echo ""
    fi
  done
  if [[ -n "$OTHER" ]]; then
    echo "## 📦 Other"
    echo ""
    printf "%s" "$OTHER"
  fi
}

# curated_section <tag> — richer per-version highlights for known releases
# (raw commit subjects are often a single squashed line). Returns 1 when the
# tag has no curated section, so the commit-based fallback is used.
curated_section() {
  case "$1" in
    v1.3.1)
      cat <<'EOF'
### ✨ New Features
- 🕐 **Voice Session Indicators**: The recording bar shows when the capture started (localized `started at HH:MM:SS`) plus a live elapsed counter, and the "Transcribing…" bar shows the total processed duration — so old captures are easy to tell apart.
- ⚠️ **Microphone Permission Warning**: When the Windows native recognizer fails with "speech privacy policy was not accepted", Settings shows an actionable banner (with a friendly toast instead of the cryptic OS error) that clears automatically once a transcription succeeds.
- 🧹 **Automatic WAV Cleanup**: Recorded WAVs are deleted after transcription on every path (success AND failure), the native engine no longer writes an unused WAV at all, and a startup sweep removes stale voice artifacts older than 24h — the temp folder can never fill the disk.
- 🔄 **Instant Releases**: The Release workflow now publishes the GitHub release automatically when the build finishes (no manual draft step).
### 🐛 Bug Fixes
- 🎯 **Ghost-Click Fix**: A stale `voice-transcribed` error (e.g. the OS recognizer failing while the user is STILL recording) no longer hides the recording bar — the recording state now only resets when the event belongs to the current session.
EOF
      ;;
    v1.3.0)
      cat <<'EOF'
### ✨ New Features
- 🎙️ **Voice Input (Dictation)**: Press **Alt+V** and speak — Windows SAPI transcribes your words straight into the prompt. A dedicated microphone button, per-capture recording bar, and error handling round out the flow.
- 🧠 **Local Whisper (whisper.cpp) Engine**: Download the binary + tiny model (~75 MB) right from Settings, and dictations are transcribed fully offline with whisper-cli.
- 🎚️ **Microphone Picker**: Settings lists every input device (with the OS default marked) so you can choose exactly which mic to record from.
- 🧪 **Voice E2E Tests**: Playwright tests cover recording start/stop, transcription injection, error toasts, browser-mode button hiding, and Whisper download states.
- 📸 **Visual Documentation**: Screenshots of the Whisper panel and dictation flow are documented in the README.
EOF
      ;;
    v1.2.3)
      cat <<'EOF'
### ✨ New Features
- ⌨️ **English Slash-Command Keywords**: Direct keyword execution (`/new`, `/theme`, `/capture`, `/explain`…) — type and press Enter to run immediately, no palette browsing needed.
- 🏷️ **Keyword Badges in the Palette**: Each slash-command row now shows its direct keyword (`/new`, `/fix`, …) so users discover the shortcuts.
- 🧪 **E2E Tests for Direct Commands**: Playwright tests verify `/theme` + Enter toggles the theme, `/new` clears the prompt, and fuzzy matching still works.
- 🧹 **Cleaned Up i18n**: Removed unused system-command translation keys (`systemNewChat`, `systemToggleTheme`, …) from all 5 languages.
- 📖 **Slash-Commands Documentation**: Full table of the 14 commands (`/new` … `/comment`) now in the README Keyboard Shortcuts section.
- 🎨 **Themed Context Scrollbar**: The captured-context preview scrollbar uses the same `custom-scroll` class as the response panel, adapting to dark/light themes.
- 🔍 **Prominent Update Check**: The "Check for updates" button moved to a visible position in the General tab.
- 📝 **README Release History**: Version-specific "What's New" sections moved to the versioned [CHANGELOG.md](CHANGELOG.md); the README now focuses on Key Features and quick-start.
EOF
      ;;
    v1.2.2)
      cat <<'EOF'
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
EOF
      ;;
    v1.2.1)
      cat <<'EOF'
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
EOF
      ;;
    v1.2.0)
      cat <<'EOF'
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
EOF
      ;;
    v1.1.0)
      cat <<'EOF'
### 🌐 Multi-Language i18n Support
- Full interface translation in **English (Default)**, **Español** and **Deutsch**.
- Action prompt templates automatically adapt to the active display language.

### 🎛️ Custom Prompt Action Buttons
- Create and manage custom shortcut action buttons with your own prompt templates in Settings.

### 🔗 Native External Browser Integration
- Opens external links and the GitHub repository in the default system browser.
EOF
      ;;
    v1.0.0)
      cat <<'EOF'
### 🎉 Initial Release
- ⚡ Instant spotlight access via the global `Alt + Space` hotkey.
- 📋 Automatic clipboard context capture for selected text or code.
- 🦙 Ollama local and network server support.
- ☁️ Multi-provider cloud AI: OpenAI, Anthropic, Groq, DeepSeek, LM Studio and any OpenAI-compatible endpoint.
- 🎯 Native auto-insert of AI responses into the active app with `Ctrl + Enter`.
- 🔒 Encrypted API key storage via the Windows Credential Manager.
- 🔄 Signed automatic updates through the Tauri updater.
EOF
      ;;
    *) return 1 ;;
  esac
}

# generate_changelog — writes CHANGELOG.md from the full git tag history.
generate_changelog() {
  local out="CHANGELOG.md"
  local tags newest range date
  local -a commits
  tags="$(git tag --sort=-version:refname 2>/dev/null || true)"
  newest="$(printf '%s\n' "$tags" | head -n 1)"

  {
    echo "# Changelog"
    echo ""
    echo "All notable changes to this project will be documented in this file."
    echo ""
    echo "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),"
    echo "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)."
    echo ""
    echo "> Auto-generated from git history with \`npm run changelog:all\`."
    echo ""

    # --- Unreleased ---
    if [[ -n "$newest" ]]; then
      mapfile -t commits < <(git log --pretty=format:"%s" "$newest..HEAD" 2>/dev/null || true)
    else
      mapfile -t commits < <(git log --pretty=format:"%s" HEAD 2>/dev/null || true)
    fi
    if [[ ${#commits[@]} -gt 0 ]]; then
      echo "## [Unreleased]"
      echo ""
      categorize "${commits[@]}"
      emit_sections
      echo ""
    fi

    # --- One section per tag, newest first ---
    # Note: the oldest tagged section includes pre-tag commits (full history).
    # v1.1.0/v1.0.0 have their own curated sections here; the legacy block
    # below only fires when those tags are absent (e.g. shallow clones).
    mapfile -t ALL_TAGS < <(printf '%s\n' "$tags")
    local n="${#ALL_TAGS[@]}"
    local i tag
    for (( i = 0; i < n; i++ )); do
      [[ -n "${ALL_TAGS[$i]}" ]] || continue
      tag="${ALL_TAGS[$i]}"
      if (( i + 1 < n )); then
        range="${ALL_TAGS[$i + 1]}..$tag"
      else
        # Oldest tag: everything reachable from it.
        range="$tag"
      fi
      date="$(git log -1 --format=%ad --date=short "$tag" 2>/dev/null || echo "unknown")"
      echo "## [$tag] - $date"
      echo ""
      if section="$(curated_section "$tag")"; then
        printf "%s\n" "$section"
        echo ""
        continue
      fi
      mapfile -t commits < <(git log --pretty=format:"%s" "$range" 2>/dev/null || true)
      if [[ ${#commits[@]} -eq 0 ]]; then
        echo "- No notable changes recorded."
        echo ""
      else
        categorize "${commits[@]}"
        emit_sections
        echo ""
      fi
    done

    # --- Legacy versions without tags ---
    # v1.1.0 and v1.0.0 now exist as real tags, so the tag loop above already
    # writes their curated sections. These fallbacks only fire when the tags
    # are absent (e.g. a shallow clone), keeping the CHANGELOG free of
    # duplicated sections when they are present.
    if ! git rev-parse -q --verify refs/tags/v1.1.0 >/dev/null 2>&1; then
      echo "## [v1.1.0] - 2026-08-08"
      echo ""
      echo "### 🌐 Multi-Language i18n Support"
      echo ""
      echo "- Full interface translation in **English (Default)**, **Español** and **Deutsch**."
      echo "- Action prompt templates automatically adapt to the active display language."
      echo ""
      echo "### 🎛️ Custom Prompt Action Buttons"
      echo ""
      echo "- Create and manage custom shortcut action buttons with your own prompt templates in Settings."
      echo ""
      echo "### 🔗 Native External Browser Integration"
      echo ""
      echo "- Opens external links and the GitHub repository in the default system browser."
      echo ""
    fi
    if ! git rev-parse -q --verify refs/tags/v1.0.0 >/dev/null 2>&1; then
      echo "## [v1.0.0] - 2026-08-08"
      echo ""
      echo "### 🎉 Initial Release"
      echo ""
      echo "- ⚡ Instant spotlight access via the global \`Alt + Space\` hotkey."
      echo "- 📋 Automatic clipboard context capture for selected text or code."
      echo "- 🦙 Ollama local and network server support."
      echo "- ☁️ Multi-provider cloud AI: OpenAI, Anthropic, Groq, DeepSeek, LM Studio and any OpenAI-compatible endpoint."
      echo "- 🎯 Native auto-insert of AI responses into the active app with \`Ctrl + Enter\`."
      echo "- 🔒 Encrypted API key storage via the Windows Credential Manager."
      echo "- 🔄 Signed automatic updates through the Tauri updater."
    fi
  } > "$out"

  echo "Wrote $out from $(grep -c . <<< "$tags" || echo 0) tags."
}

MODE="${1:-}"
if [[ "$MODE" == "--changelog" ]]; then
  generate_changelog
  exit 0
fi

# --- Release mode: RELEASE_NOTES.md for a single release ---
NEW_TAG="$MODE"
VERSION="${NEW_TAG#v}"

if [[ -n "$NEW_TAG" ]]; then
  PREVIOUS="$(git tag --sort=-version:refname | grep -v "^$NEW_TAG$" | head -n 1 || echo "")"
  if [[ -n "$PREVIOUS" ]]; then
    RANGE="$PREVIOUS..HEAD"
  else
    RANGE="HEAD"
    PREVIOUS="the beginning"
  fi
else
  PREVIOUS="$(git describe --tags --abbrev=0 2>/dev/null || echo "v1.2.0")"
  RANGE="$PREVIOUS..HEAD"
fi

# Prefer the curated per-version highlights when the release is known (they
# are richer than raw commit subjects, which are often a single squash line).
if [[ -n "$NEW_TAG" ]] && section="$(curated_section "$NEW_TAG")"; then
  {
    echo "# SpotAI ${VERSION:+v$VERSION}"
    echo ""
    printf "%s\n" "$section"
  } > RELEASE_NOTES.md
  echo "Wrote RELEASE_NOTES.md (curated highlights for $NEW_TAG)."
  exit 0
fi

mapfile -t COMMITS < <(git log --pretty=format:"%s" "$RANGE" 2>/dev/null || true)

if [[ ${#COMMITS[@]} -eq 0 ]]; then
  {
    echo "# SpotAI ${VERSION:+v$VERSION}"
    echo ""
    echo "> No changes found in $RANGE"
  } > RELEASE_NOTES.md
  echo "Wrote RELEASE_NOTES.md (no changes in $RANGE)."
  exit 0
fi

categorize "${COMMITS[@]}"
{
  echo "# SpotAI ${VERSION:+v$VERSION}"
  echo ""
  echo "Changes since ${PREVIOUS}:"
  echo ""
  emit_sections
} > RELEASE_NOTES.md

echo "Wrote RELEASE_NOTES.md with ${#COMMITS[@]} commits."
