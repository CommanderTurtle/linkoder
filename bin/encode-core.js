// linkoder encode core: the lateral route resolver + encoder.
//
// Single source of truth for the routes: the pooled encode workers and the
// one-shot `bun -e` driver both call encodeFile, so every entry point
// produces byte-identical codes. The lateral ln.kr/mk.it modules are
// imported once per process (warmed in the workers) and never re-implemented.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Resolve the lateral roots as siblings of the linkoder root. LNKR_DOCS /
// MKIT_TOOLS are test overrides; env is just the carrier.
//
// 7z-wasm locates its binary as BASE_URL + "wasm/7zz.wasm" (the vite site
// path). Under bun that is a filesystem path, so point BASE_URL at the
// linkoder root and keep a symlink to the mk.it package wasm there; the
// lateral mk.it source stays untouched.
export function lateralRoots(linkoder) {
  const lnkr = process.env.LNKR_DOCS || resolve(linkoder, "../ln.kr/docs");
  const mkit = process.env.MKIT_TOOLS || resolve(linkoder, "../mk.it/src/tools");
  if (typeof Bun !== "undefined" && !process.env.BASE_URL) {
    const src = resolve(mkit, "../../node_modules/7z-wasm/7zz.wasm");
    const wasm = resolve(linkoder, "wasm/7zz.wasm");
    if (!fs.existsSync(wasm)) {
      fs.mkdirSync(dirname(wasm), { recursive: true });
      fs.symlinkSync(fs.existsSync(src) ? src : "/dev/null", wasm);
    }
    process.env.BASE_URL = resolve(linkoder) + "/";
  }
  return { lnkr, mkit, linkoder };
}

let core = null;

async function load (linkoder) {
  if (core) return core;
  const { lnkr, mkit } = lateralRoots(linkoder);
  const [
    { compressTextV1, compressTextV2, compressTextV3, compressTextV4 },
    { outputAlphabetASCII },
    { executablePrefixForKind },
    { mediaLinkKind },
    { encodeSharedFile, fileMime },
    { makeFileDataURL },
    { combineArchive, isSupportedArchive },
    { imageViewerSource },
    { videoViewerSource }
  ] = await Promise.all([
    import(lnkr + "/text-compress.js"),
    import(lnkr + "/alphabets.js"),
    import(lnkr + "/viewer-runtime.js"),
    import(lnkr + "/link-runtime.js"),
    import(mkit + "/share.ts"),
    import(lnkr + "/make-resource.js"),
    import(mkit + "/archiveCombine.ts"),
    import(mkit + "/imageViewer.ts"),
    import(linkoder + "/video-viewer.js")
  ]);
  core = {
    encoders: { 1: compressTextV1, 2: compressTextV2, 3: compressTextV3, 4: compressTextV4 },
    outputAlphabetASCII,
    executablePrefixForKind,
    mediaLinkKind,
    encodeSharedFile,
    fileMime,
    makeFileDataURL,
    combineArchive,
    isSupportedArchive,
    imageViewerSource,
    videoViewerSource
  };
  return core;
}

/**
 * Encode one file to a hashtag code.
 * job: { linkoder, path, input?, rich?, safe?, make?, version?, name?, mime? }
 *   path  -- absolute file path, or "-" for stdin (carried in `input`,
 *            base64)
 * Returns the code string (e.g. "#m:...", "#share:..."), no trailing newline.
 */
export async function encodeFile (job) {
  const c = await load(job.linkoder);
  const {
    encoders, outputAlphabetASCII, executablePrefixForKind, mediaLinkKind,
    encodeSharedFile, fileMime, combineArchive, isSupportedArchive,
    imageViewerSource, videoViewerSource, makeFileDataURL
  } = c;

  const path = job.path;
  const rich = !!job.rich;
  const safe = !!job.safe;
  const make = !!job.make;
  const b64Src = !!job.b64Src;
  const name = job.name || "";
  const mime = job.mime || "";

  if (safe && rich) throw new Error("--rich and --safe are mutually exclusive");

  const display = name || (path === "-" ? "stdin" : path.split("/").pop());
  const dot = display.lastIndexOf(".");
  const extension = dot > 0 ? display.slice(dot + 1).toLowerCase() : "";
  const kindByExtension = { md: "markdown", markdown: "markdown", html: "html", htm: "html", js: "javascript", mjs: "javascript" };
  const kind = kindByExtension[extension] || "text";
  // The lnkr media route (image/video/pdf/audio) defaults to v3: the most
  // robust per browser testing (v1/v4 are the confirmed-broken ones; v2 is
  // the post-fact fallback). Other routes keep the v1 default. An explicit
  // --vN always wins.
  const mediaKind = mediaLinkKind("https://linkoder.local/" + display);
  const isMediaRoute = mediaKind === "image" || mediaKind === "video" || mediaKind === "pdf" || mediaKind === "audio";
  const version = job.version || (isMediaRoute ? 3 : 1);

  const bytes = path === "-"
    ? new Uint8Array(Buffer.from(job.input || "", "base64"))
    : new Uint8Array(await Bun.file(path).arrayBuffer());

  const share = (nm, by, m) => encodeSharedFile({ name: nm, mime: m || fileMime({ name: nm, type: "" }), bytes: by });

  const isArchive = isSupportedArchive({ name: display, type: "" });

  if (isArchive) {
    const file = {
      name: display,
      size: bytes.length,
      type: fileMime({ name: display, type: "" }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
    const combined = await combineArchive(file);
    if (make) {
      // The #share route: the Make envelope of the combined markdown.
      return "#share:" + share("combined.md", new TextEncoder().encode(combined.markdown), "text/markdown");
    }
    // The lnkr route (mkit's edit-button behaviour): the combined markdown
    // as a proper lnkr link, so archives open as a combined md through the
    // pipelines. Respects the v1-v4 codec and the rich/safe marker.
    const md = combined.markdown + "style=jekyll\n";
    const payload = encoders[version](md, outputAlphabetASCII, "markdown").payload;
    const prefix = rich ? executablePrefixForKind("markdown") : "";
    return "#" + prefix + payload;
  }
  if (make) {
    return "#share:" + share(display, bytes, mime);
  }
  if (b64Src) {
    // The base64 transcoder fallback: the deflated make hashtag as src fails
    // (deflating-a-deflate expands past the char limit), so the base64 data
    // URL (perfected mime, via makeFileDataURL) takes the make hashtag's place
    // as the src. Only for the custom viewers (image/video/pdf/audio); the
    // make share link stays canonical for everything else.
    if (mediaKind === "image" || mediaKind === "video" || mediaKind === "pdf" || mediaKind === "audio") {
      const m = mime || fileMime({ name: display, type: "" });
      const dataUrl = makeFileDataURL({ name: display, mime: m, bytes, text: null });
      if (mediaKind === "image" || mediaKind === "video") {
        const js = mediaKind === "image" ? imageViewerSource(dataUrl) : videoViewerSource(dataUrl);
        const payload = encoders[version](js, outputAlphabetASCII, "javascript").payload;
        const prefix = safe ? "" : executablePrefixForKind("javascript");
        return "#" + prefix + payload;
      }
      const route = mediaKind === "pdf" ? "pdf" : "media";
      return "#" + route + ":" + encoders[version](dataUrl, outputAlphabetASCII, "text").payload;
    }
    return "#share:" + share(display, bytes, mime);
  }
  if (mediaKind === "image") {
    // The superlink image wrapper: an executable JS viewer whose src is the
    // file's Make share link. ln.kr accepts Make links as srcs, and Make links
    // are deflated, so the embedding takes far less space than a base64 data
    // URL. Regular utf text files do not take this route (direct v1 codec).
    const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
    const js = imageViewerSource(shareUrl);
    const payload = encoders[version](js, outputAlphabetASCII, "javascript").payload;
    const prefix = safe ? "" : executablePrefixForKind("javascript");
    return "#" + prefix + payload;
  }
  if (mediaKind === "video") {
    // The video twin of the image wrapper: an executable JS <video> whose src
    // is the file's Make share link (deflated, not a base64 data URL).
    const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
    const js = videoViewerSource(shareUrl);
    const payload = encoders[version](js, outputAlphabetASCII, "javascript").payload;
    const prefix = safe ? "" : executablePrefixForKind("javascript");
    return "#" + prefix + payload;
  }
  if (mediaKind === "pdf" || mediaKind === "audio") {
    const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
    const route = mediaKind === "pdf" ? "pdf" : "media";
    return "#" + route + ":" + encoders[version](shareUrl, outputAlphabetASCII, "text").payload;
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  const ephemeral = kind === "markdown" ? text + "style=jekyll\n" : text;
  const payload = encoders[version](ephemeral, outputAlphabetASCII, kind).payload;
  const prefix = rich ? executablePrefixForKind(kind) : "";
  return "#" + prefix + payload;
}
