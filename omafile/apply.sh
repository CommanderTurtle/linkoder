#!/bin/sh
# Apply (or verify) the local omafile patch on top of the v1.4.4 checkout.
# Idempotent: exits 0 if already applied, applies cleanly if not.
set -eu

PLUGIN="$HOME/.config/omarchy/plugins/xyzlab.omafile"
PATCH="$HOME/.config/omarchy/patches/xyzlab.omafile/omafile-local.patch"

[ -f "$PATCH" ] || { echo "missing $PATCH" >&2; exit 1; }
git -C "$PLUGIN" rev-parse --verify v1.4.4 >/dev/null 2>&1 \
  || { echo "plugin checkout missing v1.4.4 tag: $PLUGIN" >&2; exit 1; }

if git -C "$PLUGIN" apply -R --check "$PATCH" 2>/dev/null; then
  echo "already applied (base v1.4.4)"
  exit 0
fi

if ! git -C "$PLUGIN" apply --check "$PATCH" 2>/dev/null; then
  echo "patch does not apply cleanly onto the current tree:" >&2
  git -C "$PLUGIN" apply --check "$PATCH" 2>&1 | head -5 >&2
  echo "expected the working tree to be at v1.4.4 (git -C \"$PLUGIN\" checkout -f v1.4.4)" >&2
  exit 1
fi

git -C "$PLUGIN" apply "$PATCH"
echo "applied omafile-local.patch (base v1.4.4); run: omarchy restart shell"
