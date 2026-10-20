# xyzlab.omafile — Ln.Kr local patch (on the current state)

The Omarchy Omafile plugin (user copy at `~/.config/omarchy/plugins/xyzlab.omafile`,
a git checkout of `chr0nzz/omarchy-omafile`) carries this second local patch,
`omafile-local.patch` -- the **Ln.Kr / Make previewer row**. The base is the
current plugin state (v1.4.4 + the four-feature local patch, commit `c2cf091`),
What it adds:

1. **Tri-Single-Line right-click row** for files, directly under *Open in
   editor*: a literal `Ln.Kr (Rich) | Ln.Kr (Safe) | #share` text line, each
   label an independent clickable hot region.
   - **Ln.Kr (Rich)** / **Ln.Kr (Safe)**: the a.shel.sh v1 previewer link
     (expanded viewer with web / inert), rendered in a Helium webapp window.
   - **#share**: the `app.shel.sh/make/#share:` link (pdf/media/etc.; archives
     become combined markdown inside the envelope).
   - **Shift-click** any label: hoists the hashtag code (the part after `#`)
     to the clipboard instead of opening it.
2. **Settings toggle** in *Browsing*: "Ln.Kr previewer links" (off by default).
   The menu row only appears when it is on.
3. **First-enablement home sweep**: when the toggle is flipped on, omafile
   does a depth-3 sweep of the home directory for the literal `linkoder`
   folder (must contain `api.js`) and remembers it as `lnkrApiPath` from then
   on (button clicks never re-sweep; a missing folder warns at flip time,
   not at click time). Every label click runs
   `bun <linkoder>/api.js <file> --rich|--safe|--make` and opens the printed
   URL via `omarchy launch or focus webapp lnkr <url>` (repeated opens focus
   the same Helium window). A bar warning shows if the API folder is missing
   or the API fails.

The link itself is produced by the lateral **linkoder** API in
`~/Documents/Dev/linkoder` (this repository), which wraps the `../ln.kr`
codec framework and the `../mk.it` share envelope.

Full write-up (issue format, annotated diff with line numbers, verification)
in `omafile-patch-consolidated.md`.

## Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `omafile-local.patch` | The single patch file, `git diff` against the current state (3 files) |
| `apply.sh` | Idempotent apply/revert (`git apply`, `-R --check` first) |
| `omafile-patch-consolidated.md` | Issue-format documentation of the patch |
| `archive/` | Superseded patches and legacy working artifacts; see `archive/README.md` |

## Usage

```sh
~/Documents/Dev/linkoder/omafile/apply.sh      # apply (no-ops if already applied)
~/Documents/Dev/linkoder/omafile/apply.sh -r   # revert
omarchy restart shell
```

Then flip the toggle in *Settings → Browsing → Ln.Kr previewer links*. The
sweep presumes the API at `~/Documents/Dev/linkoder` (found at depth 3 from
the home directory); move it and clear the `lnkrApiPath` setting if it ever
lives somewhere else.

After an upstream plugin update: re-run `apply.sh`; if it reports "neither
forward nor reverse", upstream touched these lines -- rebase by hand.
