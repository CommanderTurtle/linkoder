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
| `.md` / `.markdown` | `https://a.shel.sh/#<v1>` — the text is encoded ephemerally with `style=jekyll` plus a newline appended |
| `.html` / `.htm` | `https://a.shel.sh/#<v1>` |
| `.js` / other text/code | `https://a.shel.sh/#<v1>` (text kind) |
| `.pdf` | `https://a.shel.sh/#pdf:<v1>` — the payload is the file's Make share URL; the static site fetches it and renders the PDF |
| audio (`.mp3`, `.wav`, `.ogg`, …) | `https://a.shel.sh/#media:<v1>` — same Make-URL pattern |
| images (`.png`, `.jpg`, …) | `https://a.shel.sh/#r:<v1 js>` — the mk.it image-viewer wrapper (an executable JS link with the image embedded as a data URL; ln.kr also accepts Make links as srcs) |
| video (`.mp4`, `.mov`, …) | `https://app.shel.sh/make/#share:<MKIT/1>` — the right codec (name & file extension) |
| `.zip` / `.tar` / `.7z` | `https://app.shel.sh/make/#share:<MKIT/1>` — turned into combined markdown ephemerally first (`combined.md`) |
Flags:

- `--safe` (default for documents): inert `#` link — no web, the recipient
  chooses Run.
- `--rich`: expanded unique-origin viewer with network requests enabled
  (`#m:` markdown, `#h:` html, `#r:` javascript).
- `--make`: force the `app.shel.sh/make/#share:` envelope (the default for
  video/archives; images take the JS viewer link, pdf/audio the render types).

Everything is v1 links, generated with the lateral frameworks — nothing is
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

```
linkodec <file|-> [--rich|--safe] [--make] [--v1|--v2|--v3|--v4] [--name NAME] [--mime MIME]
```

It prints **only the hashtag code** — the `#fragment`, no preceding URL — so
it composes in a pipeline:

```
linkodec note.md --rich        # m:...
cat note.md | linkodec - --name note.md
```

- `--v1` is the default text codec (the frozen wire format); `--v2`/`--v3`/
  `--v4` select the lateral structural, dictionary, and deflate encoders.
- `-` reads stdin; `--name`/`--mime` supply the identity the envelope needs.
- The lateral roots default to `~/Documents/Dev/ln.kr/docs` and
  `~/Documents/Dev/mk.it/src/tools`; override with `LNKR_DOCS`/`MKIT_TOOLS`.

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
