# xyzlab.omafile — local patch on v1.4.4

The Omarchy Omafile plugin (user copy at `~/.config/omarchy/plugins/xyzlab.omafile`,
a git checkout of `chr0nzz/omarchy-omafile`, **base v1.4.4**, commit `a938874`)
carries one local patch, `omafile-local.patch` -- a single consolidated commit with
four changes:

1. **"Transcode…" context-menu entry** (above *Compress…*) for pictures and videos:
   Format + Resolution dialog, new cancellable `transcode` helper op (trusted
   `omarchy-transcode` per file), TransferBar row.
2. **Full-resolution image previews** (opt-in `fullResPreview` setting): the
   original renders at native size; the placeholder tracks the full-res load;
   scroll zooms (1x-8x, cursor-anchored), left-drag pans, double-click resets.
3. **Multi-file open**: *Open* / *Open with* / *Open in editor* act on the whole
   selection; the system-default open runs one `gio open p1 p2 ...` so the viewer
   gets the collection in one window.
4. **Enter no longer double-opens after "Open with"**: launches are timestamped
   (`lastLaunchMs`, 600 ms) and the pane swallows a stray Return/Enter/Space inside
   that window.

Full write-up (issue format, annotated diff with line numbers, script outline,
verification) in `omafile-patch-consolidated.md`.

## Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `omafile-local.patch` | The single patch file, `git diff` against v1.4.4 (5 files) |
| `apply.sh` | Idempotent apply/revert (`git apply`, `-R --check` first) |
| `omafile-patch-consolidated.md` | Issue-format documentation of the patch |
| `archive/` | Superseded patches and legacy working artifacts; see `archive/README.md` |

## Usage

```sh
~/.config/omarchy/patches/xyzlab.omafile/apply.sh          # apply (no-ops if already applied)
~/.config/omarchy/patches/xyzlab.omafile/apply.sh -r       # revert
omarchy restart shell
```

After an upstream plugin update: re-run `apply.sh`; if it reports "neither forward
nor reverse", upstream touched these lines -- rebase by hand.
