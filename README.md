# linkoder

A hashtag encoder for the shel.sh previewers, plus the tailored omafile
package that drives it.

The sites (`a.shel.sh`, `app.shel.sh/make/`) are completely static: they use
JS to resolve URLs on the client side. Thuswise **all share links have
already been created until the end of time. They already exist in the
quantum future.**

## The API

`api.js` is a bun CLI. Hand it a file with an existing extension and it
prints the previewer URL:

```
linkoder <file> [<file>...] [--rich | --safe | --make]
```

| Input | Output |
|---|---|
| `.md` / `.markdown` | `https://a.shel.sh/#<v1-v4>` — the text is encoded ephemerally with `style=jekyll` plus a newline appended |
| `.html` / `.htm` | `https://a.shel.sh/#<v1-v4>` |
| `.js` / other text/code | `https://a.shel.sh/#<v1-v4>` (text kind) |
| `.pdf` | `https://a.shel.sh/#pdf:<v1-v4>` — the payload is the file's Make share URL; the static site fetches it and renders the PDF |
| audio (`.mp3`, `.wav`, `.ogg`, …) | `https://a.shel.sh/#media:<v1-v4>` — same Make-URL pattern |
| images (`.png`, `.jpg`, …) | `https://a.shel.sh/#r:<v1-v4 js>` — the mk.it image-viewer wrapper: an executable JS link whose src is the file's Make share link (deflated, not a base64 data URL; ln.kr accepts Make links as srcs) |
| video (`.mp4`, `.mov`, …) | `https://a.shel.sh/#r:<v1-v4 js>` — the video twin: an executable JS `<video>` whose src is the file's Make share link |
| `.zip` / `.tar` / `.7z` | `https://a.shel.sh/#<v1-v4 md>` — the archive is turned into combined markdown first and encoded as a proper lnkr markdown link (mkit's edit-button behaviour); `--make` wraps the combined md in the `#share:` envelope instead |
Flags:

- `--safe` (default for documents): inert `#` link — no web, the recipient
  chooses Run.
- `--rich`: expanded unique-origin viewer with network requests enabled
  (`#m:` markdown, `#h:` html, `#r:` javascript).
- `--make`: force the `app.shel.sh/make/#share:` envelope (the raw file, or
  the combined md for archives).
- `--v1`..`--v4`: the lnkr text-format codec for every route (default v1,
  the frozen wire format).

Everything is generated with the lateral frameworks — nothing is
reinvented here:

- `../ln.kr/docs/` — the v1 compressor, output alphabets, and the
  executable-fragment prefixes.
- `../mk.it/src/tools/` — the MKIT/1 share envelope and the
  archive-to-combined-markdown combiner.

### The native worker: `linkodec`

`rust/` builds `bin/linkodec` — a zero-dependency, ~340 KB static Rust
binary that is a thin lateral worker around the same JS codecs. It parses
arguments, locates `bun`, and hands the encode to the lateral ln.kr/mk.it
modules; nothing is re-implemented in Rust.

Architecture: a hard-coded pool of 12 long-lived `bun` encode workers
(`bin/encode-worker.js`) behind unix sockets in the linkoder root
(`.encode-worker-<id>.sock` / `.encode-worker-<id>.pid`). Jobs rotate over
time (wall-clock second modulo the pool), so concurrent encodes spread
across workers; a busy worker is skipped, and missing members spawn on
demand. All entry points (pool and cold) call the same `bin/encode-core.js`
`encodeFile`, so every code is byte-identical no matter which path ran.

Each job is under a 20 s timer (binary layer): on expiry the worker's job
is SIGKILLed, the worker respawns, and the binary falls back to a plain
Make share link (`#share:...` via the cold `--make` route) — so a slow
encode degrades to the deflated share envelope instead of hanging.

```
linkodec <file|-> [--rich|--safe] [--make] [--v1|--v2|--v3|--v4] [--name NAME] [--mime MIME]
```

It prints **only the hashtag code** — the `#fragment`, no preceding URL — so
it composes in a pipeline:

```
linkodec note.md --rich        # m:...
cat note.md | linkodec - --name note.md
```

# A PDF as a v2 lnkr link with no web requests: the `#pdf:` render route is
# inert (the viewer's network toggle stays off) — the static site decodes
# the v2 payload to the deflated Make share URL and renders the PDF from it:

```
linkodec document.pdf --v2 --safe
#pdf:<v2 payload>      # open as https://a.shel.sh/#pdf:<v2 payload>
```

- `--v1` is the default text codec (the frozen wire format); `--v2`/`--v3`/
  `--v4` select the lateral structural, dictionary, and deflate encoders.
- `-` reads stdin; `--name`/`--mime` supply the identity the envelope needs.
- The lateral roots resolve as siblings of the binary's own root: the
  `linkodec` binary exports `LINKODER_DIR` from its executable path, and the
  driver resolves `../ln.kr/docs` and `../mk.it/src/tools` from it;
  override with `LNKR_DOCS`/`MKIT_TOOLS`.
- The 7z wasm resolves from the linkoder root (`wasm/7zz.wasm` symlink,
  `BASE_URL` set under `bun`), so `mk.it` stays untouched.

Build: `cargo build --release` in `rust/`, then copy
`target/release/linkodec` to `bin/linkodec`.

## The omafile package

`omafile/` is the local patch package (template style: `README.md`,
`apply.sh`, patch, consolidated doc) that adds the Ln.Kr row to omafile's
right-click menu: `link | safe | #share` on a single line, a settings
toggle, and a first-enablement home sweep (depth 3) that presumes the
location of this API. The sweep and the encodes run as ops in the omafile
helper (no `Quickshell.execute`); each encode prefers the native
`bin/linkodec` worker and falls back to `bun api.js`. Links render in a
Helium webapp window; shift-clicking a row button hoists the hashtag code
to the clipboard instead.
