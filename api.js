#!/usr/bin/env bun
// linkoder -- hashtag encoder for the shel.sh previewers.
//
// Hand it a file with an existing extension; it prints the previewer URL.
//   - documents (md, html, js, text/code) -> a.shel.sh lnkr link (m:/h: marker
//     with --rich, no marker with --safe)
//   - pdf and audio                       -> a.shel.sh #pdf: / #media: render
//     types (the payload is the file's Make share URL, which the site fetches)
//   - images and video                    -> a.shel.sh #r: executable viewer
//     whose src is that Make share URL
//   - archives                            -> the combined markdown as an
//     lnkr link; --make wraps it in the Make envelope instead
//
// Nothing is re-implemented here: every route runs through bin/encode-core.js
// encodeFile -- the same core the pooled linkodec workers and the one-shot
// cold driver call -- so a code is byte-identical whichever entry point
// produced it. This file only adds the CLI, the worker-count .env and the URL
// base each code needs: the #share: envelope opens on app.shel.sh/make/, every
// lnkr code on a.shel.sh.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeFile } from "./bin/encode-core.js";

const A_SHEL = "https://a.shel.sh/";
const MAKE_BASE = "https://app.shel.sh/make/";

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

// The core returns the bare hashtag code; only the base is chosen here.
async function encodeOne (path, flags) {
  const code = await encodeFile({ linkoder: HERE, path, ...flags });
  return (code.startsWith("#share:") ? MAKE_BASE : A_SHEL) + code;
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
  --v1..--v4    lnkr text-format codec (default v1, the frozen wire format;
                image/video/pdf/audio routes default to v3, the most robust
                codec per browser testing; v2/v4 are the lateral structural and
                deflate encoders)`);
  process.exit(code);
}

const args = process.argv.slice(2);
const flags = { rich: false, safe: false, make: false };
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
if (flags.rich && flags.safe) {
  console.error("linkoder: --rich and --safe are mutually exclusive");
  usage(2);
}

const { workers } = await loadEnv();
const urls = await pool(files, workers, path => encodeOne(resolve(path), flags));
for (const url of urls) console.log(url);
