// Route regression for linkoder: binary <-> api.js parity and lateral
// round-trips for every route. Run: bun test tests/routes.test.js
import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(TESTS);
const FIX = (name) => resolve(TESTS, "fixtures", name);

const { decompressText } = await import(resolve(ROOT, "../ln.kr/docs/text-compress.js"));
const { outputAlphabetASCII } = await import(resolve(ROOT, "../ln.kr/docs/alphabets.js"));
const { decodeSharedFile } = await import(resolve(ROOT, "../mk.it/src/tools/share.ts"));

const run = (cmd, args) => {
  const r = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(cmd[0] + " failed: " + r.stderr.toString());
  return r.stdout.toString().trim();
};
const binary = (file, ...flags) => run([resolve(ROOT, "bin/linkodec"), file, ...flags]);
const api = (file, ...flags) => run(["bun", resolve(ROOT, "api.js"), file, ...flags]);

// Strip the URL base; the binary prints only the hashtag code, api.js the
// full URL (a.shel.sh/ for lnkr routes, app.shel.sh/make/ for #share).
const stripBase = (url) => url.replace(/^https:\/\/(a\.shel\.sh|app\.shel\.sh\/make)\//, "");

// Split a hashtag code into its viewer marker (m:, h:, r:, pdf:, media:,
// share:) and the lnkr payload.
const splitCode = (code) => {
  const m = code.match(/^#([a-z]+:)?(.*)$/s);
  expect(m, "code shape").toBeTruthy();
  return { marker: m[1] ?? "", payload: m[2] };
};
const decode = (payload) => decompressText(payload, outputAlphabetASCII);

const FIXTURES = ["note.md", "page.html", "app.js", "doc.pdf", "tone.mp3", "clip.mp4", "img.png", "archive.zip", "sample.7z"];

test("binary and api.js agree on every route (v1 and v3)", async () => {
  for (const name of FIXTURES) {
    for (const flags of [[], ["--v3"]]) {
      const b = binary(FIX(name), ...flags);
      const a = stripBase(api(FIX(name), ...flags));
      expect(b, name + " " + flags.join()).toBe(a);
    }
  }
});

test("markdown encodes as a markdown lnkr link with the jekyll suffix", async () => {
  const { marker, payload } = splitCode(binary(FIX("note.md")));
  expect(marker).toBe("");
  const d = decode(payload);
  expect(d.kind).toBe("markdown");
  expect(d.text).toBe((await readFile(FIX("note.md"), "utf8")) + "style=jekyll\n");
});

test("html and javascript round-trip to their kinds", async () => {
  const dHtml = decode(splitCode(binary(FIX("page.html"))).payload);
  expect(dHtml.kind).toBe("html");
  expect(dHtml.text).toBe(await readFile(FIX("page.html"), "utf8"));
  const dJs = decode(splitCode(binary(FIX("app.js"))).payload);
  expect(dJs.kind).toBe("javascript");
  expect(dJs.text).toBe(await readFile(FIX("app.js"), "utf8"));
});

test("archives decode to the combined markdown (zip and 7z)", async () => {
  const zip = decode(splitCode(binary(FIX("archive.zip"))).payload);
  expect(zip.kind).toBe("markdown");
  expect(zip.text).toContain("## File: ./a.txt");
  const seven = decode(splitCode(binary(FIX("sample.7z"))).payload);
  expect(seven.kind).toBe("markdown");
  expect(seven.text).toContain("## File: ./README.md");
  expect(seven.text).toContain("## File: ./docs/config.ini");
  expect(seven.text).toContain("## File: ./src.js");
  expect(seven.text.endsWith("style=jekyll\n")).toBeTrue();
});

test("pdf and audio carry a Make share URL as the vN payload", async () => {
  const pdf = splitCode(binary(FIX("doc.pdf")));
  expect(pdf.marker).toBe("pdf:");
  const dPdf = decode(pdf.payload);
  expect(dPdf.kind).toBe("text");
  expect(dPdf.text).toMatch(/^https:\/\/app\.shel\.sh\/make\/#share:/);
  const media = splitCode(binary(FIX("tone.mp3")));
  expect(media.marker).toBe("media:");
  expect(decode(media.payload).text).toMatch(/^https:\/\/app\.shel\.sh\/make\/#share:/);
});

test("images and video are executable JS links with a Make share src", async () => {
  for (const name of ["img.png", "clip.mp4"]) {
    const { marker, payload } = splitCode(binary(FIX(name)));
    expect(marker).toBe("r:");
    const d = decode(payload);
    expect(d.kind).toBe("javascript");
    expect(d.text).toContain("https://app.shel.sh/make/#share:");
  }
});

test("--make wraps in the raw #share envelope", async () => {
  const { marker, payload } = splitCode(binary(FIX("note.md"), "--make"));
  expect(marker).toBe("share:");
  const file = decodeSharedFile(payload);
  expect(file.name).toBe("note.md");
  expect(Buffer.from(file.bytes).toString("utf8")).toBe(await readFile(FIX("note.md"), "utf8"));
});

test("every route respects --v1 through --v4", async () => {
  for (const v of [1, 2, 3, 4]) {
    const { payload } = splitCode(binary(FIX("note.md"), `--v${v}`));
    const d = decode(payload);
    expect(d.kind).toBe("markdown");
    expect(d.text).toContain("# Test");
  }
  for (const v of [1, 2, 3, 4]) {
    const { payload } = splitCode(binary(FIX("sample.7z"), `--v${v}`));
    expect(decode(payload).kind).toBe("markdown");
  }
});
