#!/usr/bin/env bun
// linkoder -- hashtag encoder for the shel.sh previewers.
//
// Hand it a file with an existing extension; it prints the previewer URL.
//   - documents (md, html, js, text/code) -> a.shel.sh v1 hashtag links
//   - pdf and audio                       -> a.shel.sh #pdf: / #media: render types
//     (the v1 payload is the file's Make share URL, which the static site fetches)
//   - video, images, archives             -> app.shel.sh/make/#share: links
//
// The codecs are not reinvented here: the v1 compressor, the render-type
// routes and the MKIT/1 share envelope (always app.shel.sh/make/#share:)
// come from the lateral ../ln.kr and ../mk.it frameworks.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compressTextV1, compressTextV2, compressTextV3, compressTextV4 } from "../ln.kr/docs/text-compress.js";
import { outputAlphabetASCII } from "../ln.kr/docs/alphabets.js";
import { executablePrefixForKind } from "../ln.kr/docs/viewer-runtime.js";
import { encodeSharedFile, fileMime } from "../mk.it/src/tools/share.ts";
import { mediaLinkKind } from "../ln.kr/docs/link-runtime.js";
import { combineArchive, isSupportedArchive } from "../mk.it/src/tools/archiveCombine.ts";
import { imageViewerSource } from "../mk.it/src/tools/imageViewer.ts";
import { videoViewerSource } from "./video-viewer.js";

const A_SHEL = "https://a.shel.sh/";
const MAKE_BASE = "https://app.shel.sh/make/";

const KIND_BY_EXTENSION = Object.freeze({
  md: "markdown", markdown: "markdown",
  html: "html", htm: "html",
  js: "javascript", mjs: "javascript"
});

// Every route ends in the lnkr text format family; --v1..--v4 select the
// codec (v1 is the frozen wire format).
const encoders = Object.freeze({ 1: compressTextV1, 2: compressTextV2, 3: compressTextV3, 4: compressTextV4 });

const HERE = dirname(fileURLToPath(import.meta.url));

// 7z-wasm locates its binary as BASE_URL + "wasm/7zz.wasm" (the vite
// site path). Under bun that is a filesystem path, so point BASE_URL at
// the linkoder root and keep a symlink to the mk.it package wasm there;
// the lateral mk.it source stays untouched.
if (typeof Bun !== "undefined" && !process.env.BASE_URL) {
  const wasm = resolve(HERE, "wasm/7zz.wasm");
  if (!existsSync(wasm)) {
    mkdirSync(dirname(wasm), { recursive: true });
    symlinkSync(resolve(HERE, "../mk.it/node_modules/7z-wasm/7zz.wasm"), wasm);
  }
  process.env.BASE_URL = resolve(HERE) + "/";
}

// .env resolves to .env-example on first run; the only setting is the
// number of workers (concurrent encodes), based on CPU power.
async function loadEnv () {
  const envPath = resolve(HERE, ".env");
  const examplePath = resolve(HERE, ".env-example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    await writeFile(envPath, await readFile(examplePath));
  }
  const vars = Object.create(null);
  if (existsSync(envPath)) {
    for (const line of (await readFile(envPath, "utf8")).split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) vars[match[1]] = match[2];
    }
  }
  const workers = Number.parseInt(vars.WORKERS, 10);
  return {
    workers: Number.isFinite(workers) && workers > 0 ? workers : availableParallelism()
  };
}

function extensionOf (name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// markdown renders ephemeral: append "style=jekyll" plus a newline to the
// in-memory copy; the file on disk is never touched.
async function documentKindAndText (name, text) {
  const kind = KIND_BY_EXTENSION[extensionOf(name)] || "text";
  if (kind === "markdown") return [kind, `${text}style=jekyll\n`];
  return [kind, text];
}

function lnKrURL (kind, text, { rich, version }) {
  const payload = encoders[version](text, outputAlphabetASCII, kind).payload;
  const prefix = rich ? executablePrefixForKind(kind) : "";
  return `${A_SHEL}#${prefix}${payload}`;
}

async function makeShareURL (name, bytes, mime = "") {
  const payload = encodeSharedFile({ name, mime: mime || fileMime({ name, type: "" }), bytes });
  return `${MAKE_BASE}#share:${payload}`;
}

async function combineArchiveMarkdown (path) {
  const raw = await readFile(path);
  const name = basename(path);
  const file = {
    name,
    size: raw.length,
    type: fileMime({ name, type: "" }),
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  };
  const combined = await combineArchive(file);
  return combined.markdown;
}

async function encodeOne (path, flags) {
  const name = basename(path);
  const extension = extensionOf(name);
  const mediaKind = mediaLinkKind(`https://linkoder.local/${name}`);
  const isArchive = isSupportedArchive({ name, type: "" });
  if (isArchive) {
    // Archives combine into markdown first, then take the requested route:
    // the #share button wraps the combined md in the Make envelope, the
    // lnkr/safe buttons print it as a proper lnkr markdown link (mkit's
    // edit-button behaviour), so archives open as a combined md through
    // the pipelines.
    const md = await combineArchiveMarkdown(path);
    if (flags.make) return makeShareURL("combined.md", new TextEncoder().encode(md), "text/markdown");
    return lnKrURL("markdown", `${md}style=jekyll\n`, flags);
  }
  if (flags.make) {
    const bytes = await readFile(path);
    return makeShareURL(name, bytes);
  }
  if (mediaKind === "image") {
    // The superlink image wrapper: an executable JS viewer whose src is the
    // file's Make share link. ln.kr accepts Make links as srcs, and Make
    // links are deflated, so the embedding takes far less space than a
    // base64 data URL. Regular utf text files do not take this route.
    const bytes = await readFile(path);
    const shareUrl = await makeShareURL(name, bytes);
    const js = imageViewerSource(shareUrl);
    const payload = encoders[flags.version](js, outputAlphabetASCII, "javascript").payload;
    const prefix = flags.safe ? "" : executablePrefixForKind("javascript");
    return `${A_SHEL}#${prefix}${payload}`;
  }
  if (mediaKind === "video") {
    // The video twin of the image wrapper: an executable JS <video> whose
    // src is the file's Make share link (deflated, not a base64 data URL).
    const bytes = await readFile(path);
    const shareUrl = await makeShareURL(name, bytes);
    const js = videoViewerSource(shareUrl);
    const payload = encoders[flags.version](js, outputAlphabetASCII, "javascript").payload;
    const prefix = flags.safe ? "" : executablePrefixForKind("javascript");
    return `${A_SHEL}#${prefix}${payload}`;
  }
  if (mediaKind === "pdf" || mediaKind === "audio") {
    const bytes = await readFile(path);
    const share = await makeShareURL(name, bytes);
    const route = mediaKind === "pdf" ? "pdf" : "media";
    return `${A_SHEL}#${route}:${encoders[flags.version](share, outputAlphabetASCII, "text").payload}`;
  }

  const text = await readFile(path, "utf8");
  const [kind, ephemeral] = await documentKindAndText(name, text);
  return lnKrURL(kind, ephemeral, flags);
}

async function pool (items, workers, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function usage (code = 2) {
  console.error(`Usage:
  linkoder <file> [<file>...] [--rich | --safe | --make] [--v1 | --v2 | --v3 | --v4]

  <file>        file with an existing extension; prints one previewer URL per file
  --rich        a.shel.sh expanded viewer with web (m:/h:/r: marker)
  --safe        a.shel.sh inert link (no marker; default for documents)
  --make        force the app.shel.sh/make/#share: link (default for archives/video)
  --v1..--v4    lnkr text-format codec for every route (default v1, the frozen
                wire format; v2/v3/v4 are the lateral structural/dictionary/
                deflate encoders)`);
  process.exit(code);
}

const args = process.argv.slice(2);
const flags = { rich: false, safe: false, make: false, version: 1 };
const files = [];
for (const arg of args) {
  if (arg === "--rich") flags.rich = true;
  else if (arg === "--safe") flags.safe = true;
  else if (arg === "--make") flags.make = true;
  else if (arg === "--v1") flags.version = 1;
  else if (arg === "--v2") flags.version = 2;
  else if (arg === "--v3") flags.version = 3;
  else if (arg === "--v4") flags.version = 4;
  else if (arg === "--help" || arg === "-h") usage(0);
  else files.push(arg);
}
if (!files.length) usage();

const { workers } = await loadEnv();
const urls = await pool(files, workers, path => encodeOne(resolve(path), flags));
for (const url of urls) console.log(url);
