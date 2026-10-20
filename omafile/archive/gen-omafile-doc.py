#!/usr/bin/env python3
"""Regenerate the consolidated patch doc (issue format, details expandables)
from `git diff v1.4.4` in the omafile plugin checkout.

Output: ~/.config/omarchy/patches/xyzlab.omafile/omafile-patch-consolidated.md
"""
import subprocess, os, re

REPO = os.path.expanduser("~/.config/omarchy/plugins/xyzlab.omafile")
PATCHDIR = os.path.expanduser("~/.config/omarchy/patches/xyzlab.omafile")
OUT = os.path.join(PATCHDIR, "omafile-patch-consolidated.md")
APPLY_SH = os.path.join(PATCHDIR, "apply.sh")
README = os.path.join(PATCHDIR, "README.md")

diff = subprocess.run(["git", "-C", REPO, "diff", "v1.4.4"],
                      capture_output=True, text=True, check=True).stdout
stat = subprocess.run(["git", "-C", REPO, "diff", "--shortstat", "v1.4.4"],
                      capture_output=True, text=True, check=True).stdout.strip()
commit = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "HEAD"],
                        capture_output=True, text=True, check=True).stdout.strip()

numstat = {}
for line in subprocess.run(["git", "-C", REPO, "diff", "--numstat", "v1.4.4"],
                           capture_output=True, text=True, check=True).stdout.splitlines():
    a, b, path = line.split("\t")
    numstat[path] = (a, b)

def annotate(diff_text):
    out = []
    cur_file = None
    src = tgt = 0
    hunk_seen = False
    for raw in diff_text.splitlines():
        m = re.match(r"^diff --git (\S+) (\S+)", raw)
        if m:
            if cur_file is not None:
                out.append("```")
                out.append("")
            cur_file = re.sub(r"^[a-z]/", "", m.group(2))
            a, b = numstat.get(cur_file, ("?", "?"))
            out.append("### `%s` (+%s/-%s)" % (cur_file, a, b))
            out.append("")
            out.append("```diff")
            out.append("")
            hunk_seen = False
            continue
        if raw.startswith("index ") or raw.startswith("--- ") or raw.startswith("+++ "):
            continue
        m = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", raw)
        if m:
            src = int(m.group(1)); tgt = int(m.group(3))
            hunk_seen = True
            out.append(raw)
            continue
        if not hunk_seen or cur_file is None:
            out.append(raw)
            continue
        if raw.startswith("+"):
            out.append("%6d: %s" % (tgt, raw)); tgt += 1
        elif raw.startswith("-"):
            out.append("%6d: %s" % (src, raw)); src += 1
        elif raw.startswith("\\"):
            out.append(raw)
        else:
            out.append("%6d: %s" % (tgt, raw[1:] if raw.startswith(" ") else raw))
            src += 1; tgt += 1
    if cur_file is not None:
        out.append("```")
    return "\n".join(out)

body = annotate(diff)

notes = """## Notes

- **Double-open fix:** after "Open with", a stray Enter re-opened the file; the launcher timestamps launches (`lastLaunchMs`, 600 ms window, same pattern as `conflictKeyDelay`) and the pane swallows Return/Enter/Space inside that window.
- **HD image previews:** `fullResPreview` setting (default off) renders the original file at native size in the preview panel; the 64 MB preview cap still applies. The placeholder cog tracks the full-res image's load status (no faded "Making a preview" cog). Scrolling over the preview zooms (1x-8x, anchored at the cursor) and left-drag pans; double-click resets, like the image viewer. Only wheel and drag pass through to the preview; keyboard arrows keep their existing role.
- **Multi-file open:** *Open* / *Open with* / *Open in editor* act on the whole selection; `Model.expandFieldCodesMulti` expands `%f`-style codes to every path. The system-default *Open* path for a multi-selection runs one `gio open p1 p2 ...` (`Service.openExternallyFiles`, `Browser.openEntries`) so the viewer gets the collection in one window.
- **Transcode:** context-menu entry above *Compress...* for pictures/videos -> Format + Resolution dialog -> `transcode` helper op (cancellable; runs the trusted `omarchy-transcode` per file via `bash -c`, because its `wl-copy` step forks a daemon that would hold the helper's pipes) -> TransferBar entry -> pane refresh with the first output selected.
"""

script_outline = """What `apply.sh` does:

- Resolves the plugin dir (default `~/.config/omarchy/plugins/xyzlab.omafile`, optional argument).
- Forward: `git apply --check` first, then `git apply` of `omafile-local.patch` against the v1.4.4 base.
- Reverse: `git apply -R --check` first, then `git apply -R`.
- Idempotent: if the patch is already applied (or already reverted) it reports so and no-ops.
- If the tree matches neither direction it reports "neither forward nor reverse" -- upstream touched these lines; rebase by hand.
- After applying, restart the shell (`omarchy restart shell`) so the QML reloads cleanly.
"""

doc = """# [Proposal]: Transcode op, HD image previews with pan/zoom, multi-file open, double-open guard

> Filing at: https://github.com/chr0nzz/omarchy-omafile -- one consolidated commit on v1.4.4
> Base: `chr0nzz/omarchy-omafile` v1.4.4 (`a938874`), commit `%s`, %s.
> Package: `omafile-local.patch` (the single patch file) + `apply.sh` (apply/revert) + `README.md` (overview) + this doc.

## Context

- omafile v1.4.4 (Omarchy shell plugin), Hyprland.
- Four independent asks, one clean commit: a media transcode entry, full-resolution
  image previews (with zoom/pan), whole-selection open for the app/editor menus, and a
  fix for Enter double-opening right after "Open with".

## The change

| File | Change |
| --- | --- |
| `Model.js` | Transcodable extension sets, `isTranscodable`/`transcodeMediaType`, `expandFieldCodesMulti` (`%%f` -> every selected path). |
| `Service.qml` | `transcodePaths`; multi-path `openWithFiles` / `runCommandOnFiles` / `openEditorFiles`; single-invocation `openExternallyFiles` (`gio open p1 p2 ...`). |
| `components/Browser.qml` | *Transcode...* menu + dialog; multi-open dispatch; post-launch key guard; `fullResPreview` setting; native-size preview image with wheel-zoom / drag-pan / double-click reset. |
| `components/TransferBar.qml` | `transcode` transfer row. |
| `bin/omafile-helper` | `transcode` op (cancellable; per-file `omarchy-transcode`; progress + `outputs`). |

%s
<details>
<summary>Patch -- `omafile-local.patch` (full diff, linenum = post-patch target file)</summary>

%s

</details>

<details>
<summary>Script -- `apply.sh` (outline + full)</summary>

%s
```sh
%s
```

</details>

<details>
<summary>Docs -- `README.md`</summary>

%s

</details>

## Verification

- `git apply --check` of `omafile-local.patch` onto a pristine v1.4.4 worktree: clean.
- `apply.sh` on the patched checkout: reports "already applied (base v1.4.4)" (idempotent).
- `transcode` op headless (helper stdin JSON): progress -> done -> real output file written.
- Live shell after `omarchy restart shell`: zero omafile QML warnings.
- Checked by hand: *Transcode...* menu on an image; full-res preview renders; scroll zooms
  at the cursor, drag pans, double-click resets; multi-selection open lands in one viewer;
  Enter after "Open with" no longer re-opens the file.

## Open questions

- No doc files are touched in the commit (e.g. `PROTOCOL.md` documentation of the
  `transcode` op) -- left to the maintainer.
""" % (commit, stat, notes, body, script_outline, open(APPLY_SH).read().rstrip(),
       open(README).read().rstrip())

with open(OUT, "w") as f:
    f.write(doc)
print("wrote", OUT, len(doc), "bytes")
