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
| video (`.mp4`, `.mov`, …), images | `https://app.shel.sh/make/#share:<MKIT/1>` — the right codec (name & file extension) |
| `.zip` / `.tar` / `.7z` | `https://app.shel.sh/make/#share:<MKIT/1>` — turned into combined markdown ephemerally first (`combined.md`) |
Flags:

- `--safe` (default for documents): inert `#` link — no web, the recipient
  chooses Run.
- `--rich`: expanded unique-origin viewer with network requests enabled
  (`#m:` markdown, `#h:` html, `#r:` javascript).
- `--make`: force the `app.shel.sh/make/#share:` envelope (the default for
  pdf/media/archives, which do their own wizardry on the static site).

Everything is v1 links, generated with the lateral frameworks — nothing is
reinvented here:

- `../ln.kr/docs/` — the v1 compressor, output alphabets, and the
  executable-fragment prefixes.
- `../mk.it/src/tools/` — the MKIT/1 share envelope and the
  archive-to-combined-markdown combiner.

### Environment

`.env-example` holds the single setting — the number of concurrent encode
workers (set it to your CPU's worker count). On first run, if `.env` is
missing, it is resolved from `.env-example`.

## The omafile package

`omafile/` is the local patch package (template style: `README.md`,
`apply.sh`, patch, consolidated doc) that adds the Ln.Kr row to omafile's
right-click menu: `Ln.Kr (Rich) | Ln.Kr (Safe) | Make` on a single line, a
settings toggle, and a first-enablement home sweep (depth 3) that presumes
the location of this API. Links render in a Helium webapp window;
shift-clicking a row button hoists the hashtag code to the clipboard
instead.
