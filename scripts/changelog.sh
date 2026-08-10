#!/usr/bin/env bash
# Generates Markdown release notes from conventional commits between the last
# tag and HEAD. Used locally (`npm run changelog`) and by the Release workflow
# to fill the GitHub release body.
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

# Optional first arg: the tag being released (e.g. v1.2.1). When given, the
# range is computed from the *previous* tag, since the released tag points at
# HEAD and "$TAG..HEAD" would be empty. Otherwise the last tag is used.
NEW_TAG="${1:-}"
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

CATS=("feat" "fix" "perf" "docs" "refactor" "test" "ci" "chore")
declare -A SECTIONS
for cat in "${CATS[@]}"; do
  SECTIONS["$cat"]=""
done
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

for msg in "${COMMITS[@]}"; do
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

{
  echo "# SpotAI ${VERSION:+v$VERSION}"
  echo ""
  echo "Changes since ${PREVIOUS}:"
  echo ""
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
} > RELEASE_NOTES.md

echo "Wrote RELEASE_NOTES.md with ${#COMMITS[@]} commits."
