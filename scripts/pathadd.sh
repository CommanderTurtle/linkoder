#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
api="$root/api.js"
linkodec_build="$root/rust/target/release/linkodec"

if [[ ! -f "$api" || ! -x "$api" ]]; then
  printf 'linkoder CLI not found or not executable: %s\n' "$api" >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  printf 'bun is required to run linkoder. Install it from https://bun.sh and rerun.\n' >&2
  exit 1
fi
if [[ ! -f "$linkodec_build" || ! -x "$linkodec_build" ]]; then
  printf 'linkodec release binary not found or not executable: %s\nRun: cargo build --release (in rust/)\n' "$linkodec_build" >&2
  exit 1
fi

mkdir -p "$root/bin"
ln -sfn ../api.js "$root/bin/linkoder"
ln -sfn ../rust/target/release/linkodec "$root/bin/linkodec"
# Remove root-level symlinks from before the bin/ layout (only if symlinks).
if [[ -L "$root/linkoder" ]]; then rm -f "$root/linkoder"; fi
if [[ -L "$root/linkodec" ]]; then rm -f "$root/linkodec"; fi

target_user="${SUDO_USER:-${USER:-$(id -un)}}"
if command -v getent >/dev/null 2>&1; then
  target_home="$(getent passwd "$target_user" | cut -d: -f6 || true)"
else
  target_home="${HOME:?HOME is not set and getent is unavailable}"
fi
if [[ -z "$target_home" || ! -d "$target_home" ]]; then
  printf 'Could not resolve a home directory for %s.\n' "$target_user" >&2
  exit 1
fi

bashrc="$target_home/.bashrc"
path_line="export PATH=\"$root/bin:\$PATH\""
old_path_line="export PATH=\"$root:\$PATH\""
touch "$bashrc"
if grep -Fqx -- "$old_path_line" "$bashrc"; then
  { grep -Fxv -- "$old_path_line" "$bashrc" || true; } > "$bashrc.tmp" && mv "$bashrc.tmp" "$bashrc"
  printf 'Replaced the pre-bin/ Linkoder PATH line in %s.\n' "$bashrc"
fi
if ! grep -Fqx -- "$path_line" "$bashrc"; then
  printf '\n# Linkoder commands\n%s\n' "$path_line" >> "$bashrc"
  printf 'Added to %s: %s\n' "$bashrc" "$root/bin"
else
  printf 'Bash PATH already contains the Linkoder entry in %s.\n' "$bashrc"
fi

if [[ $(id -u) -eq 0 && "$target_user" != root ]]; then
  chown "$target_user":"$(id -gn "$target_user")" "$bashrc"
fi

export PATH="$root/bin:$PATH"
command -v linkoder >/dev/null
command -v linkodec >/dev/null

printf 'linkoder: %s\n' "$(command -v linkoder)"
printf 'linkodec: %s\n' "$(command -v linkodec)"
printf 'This script refreshed PATH for itself. Run: source %q\n' "$bashrc"
printf 'New shells and subprocesses launched from them inherit both commands.\n'
