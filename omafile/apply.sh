#!/bin/sh
# Apply (or verify) the local Ln.Kr omafile patch on top of the current
# plugin state (v1.4.4 + the four-feature local patch, commit c2cf091).
# Idempotent: exits 0 if already applied, applies cleanly if not.
set -eu

PLUGIN="$HOME/.config/omarchy/plugins/xyzlab.omafile"
PATCH="$HOME/Documents/Dev/linkoder/omafile/omafile-local.patch"

[ -f "$PATCH" ] || { echo "missing $PATCH" >&2; exit 1; }

if [ "${1:-}" = "-r" ]; then
  git -C "$PLUGIN" apply -R --check "$PATCH" 2>/dev/null \
    || { echo "patch is not currently applied" >&2; exit 1; }
  git -C "$PLUGIN" apply -R "$PATCH"
  echo "reverted omafile-local.patch (Ln.Kr row); run: omarchy restart shell"
  exit 0
fi

if git -C "$PLUGIN" apply -R --check "$PATCH" 2>/dev/null; then
  echo "already applied"
  exit 0
fi

if ! git -C "$PLUGIN" apply --check "$PATCH" 2>/dev/null; then
  echo "patch does not apply cleanly onto the current tree:" >&2
  git -C "$PLUGIN" apply --check "$PATCH" 2>&1 | head -5 >&2
  echo "expected a clean tree at the current omafile state (c2cf091)" >&2
  exit 1
fi

git -C "$PLUGIN" apply "$PATCH"
echo "applied omafile-local.patch (Ln.Kr row); run: omarchy restart shell"
