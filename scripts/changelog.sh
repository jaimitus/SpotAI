#!/usr/bin/env bash
# Generates Markdown release notes from conventional commits.
#
# Two modes:
#   1. Release mode (default, or pass a tag like v1.2.3): writes RELEASE_NOTES.md
#      with the changes since the previous tag. Used locally (`npm run changelog`)
#      and by the Release workflow to fill the GitHub release body.
#   2. --changelog mode: walks every git tag and writes a versioned CHANGELOG.md
#      (Keep a Changelog style, with dates), including an "Unreleased" section
#      and the untagged legacy versions (v1.0.0, v1.1.0).
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
    # Note: the oldest tagged section includes pre-tag commits (full history),
    # so untagged legacy versions are re-narrated below as their own sections.
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
      mapfile -t commits < <(git log --pretty=format:"%s" "$range" 2>/dev/null || true)
      echo "## [$tag] - $date"
      echo ""
      if [[ ${#commits[@]} -eq 0 ]]; then
        echo "- No notable changes recorded."
        echo ""
      else
        categorize "${commits[@]}"
        emit_sections
        echo ""
      fi
    done

    # --- Legacy versions without tags (kept in sync with README history) ---
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
