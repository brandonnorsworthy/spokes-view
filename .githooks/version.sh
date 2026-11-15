#!/usr/bin/env bash
# Shared by the hooks and CI: where this repo's version lives and what counts as code.
# The only repo-specific file in .githooks/; the hooks themselves are the same everywhere.

# The package whose version is the product version (Cargo.toml [package] name).
PACKAGE="spokes-view"

# Files whose change never needs a version bump (docs, CI, the hooks, repo meta).
NON_CODE_PATTERN='(^|/)[^/]*\.md$|^docs/|^\.github/|^\.githooks/|^\.gitignore$|^LICENSE'

# Prints the version in Cargo.toml at a git ref ("" = the working tree).
version_read() {
  local ref="${1:-}" text
  if [ -n "$ref" ]; then
    text=$(git show "$ref:Cargo.toml" 2>/dev/null) || return 0
  else
    text=$(cat Cargo.toml)
  fi
  printf '%s\n' "$text" |
    sed -n '/^\[package\]/,/^\[/{s/^version *= *"\([^"]*\)".*/\1/p}' | head -n1
}

# Writes a new version to Cargo.toml and to this package's entry in Cargo.lock.
version_write() {
  local new="$1"
  sed -i '/^\[package\]/,/^\[/{s/^version *= *"[^"]*"/version = "'"$new"'"/}' Cargo.toml
  sed -i '/^name = "'"$PACKAGE"'"$/{n;s/^version = "[^"]*"/version = "'"$new"'"/}' Cargo.lock
}

# The files version_write touches.
VERSION_FILES=(Cargo.toml Cargo.lock)

# Reads file names on stdin; succeeds when at least one is code.
has_code_change() {
  grep -Ev "$NON_CODE_PATTERN" | grep -q .
}

# next_version <current> <major|minor|patch>
next_version() {
  local major minor patch
  IFS=. read -r major minor patch <<<"${1%%[-+]*}"
  case "$2" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
  esac
}
