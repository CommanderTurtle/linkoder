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
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compressTextV1 } from "../ln.kr/docs/text-compress.js";
import { outputAlphabetASCII } from "../ln.kr/docs/alphabets.js";
import { executablePrefixForKind } from "../ln.kr/docs/viewer-runtime.js";
import { encodeSharedFile, fileMime } from "../mk.it/src/tools/share.ts";
import { mediaLinkKind } from "../ln.kr/docs/link-runtime.js";
import { combineArchive, isSupportedArchive } from "../mk.it/src/tools/archiveCombine.ts";
import { compress } from "../ln.kr/docs/compress.js";

const A_SHEL = "https://a.shel.sh/";
const MAKE_BASE = "https://app.shel.sh/make/";

const KIND_BY_EXTENSION = Object.freeze({
  md: "markdown", markdown: "markdown",
  html: "html", htm: "html",
  js: "javascript", mjs: "javascript"
});

const HERE = dirname(fileURLToPath(import.meta.url));

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

function lnKrURL (kind, text, { rich }) {
  const payload = compressTextV1(text, outputAlphabetASCII, kind).payload;
  const prefix = rich ? executablePrefixForKind(kind) : "";
  return `${A_SHEL}#${prefix}${payload}`;
}

async function makeShareURL (name, bytes, mime = "") {
  const payload = encodeSharedFile({ name, mime: mime || fileMime({ name, type: "" }), bytes });
  return `${MAKE_BASE}#share:${payload}`;
}

async function encodeArchive (path) {
  const raw = await readFile(path);
  const name = basename(path);
  const file = {
    name,
    size: raw.length,
    type: fileMime({ name, type: "" }),
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  };
  const combined = await combineArchive(file);
  return makeShareURL("combined.md", new TextEncoder().encode(combined.markdown), "text/markdown");
}

async function encodeOne (path, flags) {
  const name = basename(path);
  const extension = extensionOf(name);
  const mediaKind = mediaLinkKind(`https://linkoder.local/${name}`);
  const isArchive = isSupportedArchive({ name, type: "" });

  if (flags.make || isArchive || mediaKind === "video" || mediaKind === "image") {
    if (isArchive) return encodeArchive(path);
    const bytes = await readFile(path);
    return makeShareURL(name, bytes);
  }
  if (mediaKind === "pdf" || mediaKind === "audio") {
    const bytes = await readFile(path);
    const share = await makeShareURL(name, bytes);
    const route = mediaKind === "pdf" ? "pdf" : "media";
    return `${A_SHEL}#${route}:${compress(share, outputAlphabetASCII)}`;
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
  linkoder <file> [<file>...] [--rich | --safe | --make]

  <file>        file with an existing extension; prints one previewer URL per file
  --rich        a.shel.sh expanded viewer with web (m:/h:/r: marker)
  --safe        a.shel.sh inert link (no marker; default for documents)
  --make        force the app.shel.sh/make/#share: link (default for pdf/media/archives)`);
  process.exit(code);
}

const args = process.argv.slice(2);
const flags = { rich: false, safe: false, make: false };
const files = [];
for (const arg of args) {
  if (arg === "--rich") flags.rich = true;
  else if (arg === "--safe") flags.safe = true;
  else if (arg === "--make") flags.make = true;
  else if (arg === "--help" || arg === "-h") usage(0);
  else files.push(arg);
}
if (!files.length) usage();

const { workers } = await loadEnv();
const urls = await pool(files, workers, path => encodeOne(resolve(path), flags));
for (const url of urls) console.log(url);
