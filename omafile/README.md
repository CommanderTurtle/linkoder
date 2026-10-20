# xyzlab.omafile — Ln.kr local patch (on the current state)

The Omarchy Omafile plugin (user copy at `~/.config/omarchy/plugins/xyzlab.omafile`,
a git checkout of `chr0nzz/omarchy-omafile`) carries this second local patch,
`omafile-local.patch` — the **Ln.kr / Make previewer row**. The base is the
current plugin state (v1.4.4 + the four-feature local patch, commit `c2cf091`).

## What it adds

1. **A right-click row** for files, directly under *Open in editor*: a
   `Link | Safe | #share` text line, each label an independent clickable hot
   region. The row is visible whenever **exactly one file** is selected
   (directories get no row). There is no enable toggle.
   - **Link** (rich): the `a.shel.sh` ln.kr previewer link (v1–v4), opened in
     a Helium webapp window (`omarchy launch or focus webapp lnkr <url>`;
     repeated opens focus the same window).
   - **Safe**: the inert (non-executable) ln.kr variant.
   - **#share**: the `app.shel.sh/make/#share:` Make link (archives become
     combined markdown inside the envelope).
   - **Shift-click** any label: copies the hashtag code (the part after `#`)
     to the clipboard instead of opening it.
2. **A setting** in *Browsing*: **Ln.kr hashtag variant** (`lnkrVariant`,
   `v1`/`v2`/`v3`/`v4`, default `v3`). Drives which ln.kr codec version the
   `Link`/`Safe` labels use.
3. **Binary auto-resolve**: the encoding is done by the lateral **linkodec**
   Rust binary (this repository, `~/Documents/Dev/linkoder/bin/linkodec`). On
   first use the helper resolves the binary from a known path, then a
   lightweight folder-name scan for the `linkoder` folder (checking
   `bin/linkodec` and `target/release/linkodec`), and caches it for the
   session. No API-folder sweep, no `bun` at click time.

Encoding runs `linkodec <file> --rich|--safe|--make --v1..--v4` and opens the
printed URL. Status prints to the bottom-right (`Ln.kr: encoding <name>`,
`Ln.kr: opened <name>`, `Ln.kr: hashtag copied`, or the error).

## Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `omafile-local.patch` | The single patch file, `git diff` against the current state (3 files) |
| `apply.sh` | Idempotent apply/revert (`git apply`, `-R --check` first) |

## Usage

```sh
~/Documents/Dev/linkoder/omafile/apply.sh      # apply (no-ops if already applied)
~/Documents/Dev/linkoder/omafile/apply.sh -r   # revert
omarchy restart shell
```

The patch presumes the linkodec binary at `~/Documents/Dev/linkoder/bin/linkodec`
(or a `linkoder` folder findable from `~/Documents/Dev`, `~/Documents`,
`~/src`, or `$HOME`). Move it and the resolve falls back to the folder scan;
a missing binary warns at click time, not at menu-open time.

After an upstream plugin update: re-run `apply.sh`; if it reports "neither
forward nor reverse", upstream touched these lines — rebase by hand.
