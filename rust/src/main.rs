// linkodec -- ultrafast lateral worker for the ln.kr / mk.it hashtag encoders.
//
// The binary is a thin native harness: it validates its arguments, locates
// bun, and hands the job to the lateral ln.kr/mk.it codecs (the same modules
// the static viewer sites run). Nothing is re-implemented here.
//
// Output is always only the hashtag code: the #fragment, no preceding URL.
//   documents (md, html, js, text)  ->  #<v1..v4 payload>        (a.shel.sh)
//   pdf, audio                      ->  #pdf: / #media:          (a.shel.sh)
//   image, video, archives, --make  ->  #share:<MKIT/1>          (app.shel.sh/make)

use std::env;
use std::fs;
use std::process::{Command, ExitCode, Stdio};
const DRIVER: &str = r##"
const args = Bun.argv.slice(1);
let path = null, rich = false, safe = false, make = false, version = 1, name = "", mime = "";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--rich") rich = true;
  else if (a === "--safe") safe = true;
  else if (a === "--make") make = true;
  else if (a === "--v1") version = 1;
  else if (a === "--v2") version = 2;
  else if (a === "--v3") version = 3;
  else if (a === "--v4") version = 4;
  else if (a === "--name") name = args[++i] ?? "";
  else if (a === "--mime") mime = args[++i] ?? "";
  else if (path === null) path = a;
  else { console.error("unexpected argument: " + a); process.exit(2); }
}
if (path === null) {
  console.error("usage: linkodec <file|-> [--rich|--safe] [--make] [--v1|--v2|--v3|--v4] [--name NAME] [--mime MIME]");
  process.exit(2);
}

const p = await import("node:path");
// The binary exports LINKODER_DIR: its own root, resolved laterally from
// the executable path on first run. ln.kr and mk.it are siblings of it.
// LNKR_DOCS / MKIT_TOOLS are test overrides; env is just the carrier.
const LINKODER = Bun.env.LINKODER_DIR;
if (!LINKODER) { console.error("linkodec: LINKODER_DIR unset (the binary exports its own root)"); process.exit(2); }
const LNKR = Bun.env.LNKR_DOCS || p.resolve(LINKODER, "../ln.kr/docs");
const MKIT = Bun.env.MKIT_TOOLS || p.resolve(LINKODER, "../mk.it/src/tools");

// 7z-wasm locates its binary as BASE_URL + "wasm/7zz.wasm" (the vite
// site path). Under bun that is a filesystem path, so point BASE_URL at
// the linkoder root and keep a symlink to the mk.it package wasm there;
// the lateral mk.it source stays untouched.
if (typeof Bun !== "undefined" && !process.env.BASE_URL) {
  const fs = await import("node:fs");
  // (node:path is the p imported above)
  const src = p.resolve(MKIT, "../../node_modules/7z-wasm/7zz.wasm");
  const wasm = p.resolve(LINKODER, "wasm/7zz.wasm");
  if (!fs.existsSync(wasm)) {
    fs.mkdirSync(p.dirname(wasm), { recursive: true });
    fs.symlinkSync(src, wasm);
  }
  process.env.BASE_URL = p.resolve(LINKODER) + "/";
}

const { compressTextV1, compressTextV2, compressTextV3, compressTextV4 } = await import(LNKR + "/text-compress.js");
const { outputAlphabetASCII } = await import(LNKR + "/alphabets.js");
const { executablePrefixForKind } = await import(LNKR + "/viewer-runtime.js");
const { mediaLinkKind } = await import(LNKR + "/link-runtime.js");
const { encodeSharedFile, fileMime } = await import(MKIT + "/share.ts");
const { combineArchive, isSupportedArchive } = await import(MKIT + "/archiveCombine.ts");
const { imageViewerSource } = await import(MKIT + "/imageViewer.ts");
const { videoViewerSource } = await import(LINKODER + "/video-viewer.js");

const encoders = { 1: compressTextV1, 2: compressTextV2, 3: compressTextV3, 4: compressTextV4 };

const display = name || (path === "-" ? "stdin" : path.split("/").pop());
const dot = display.lastIndexOf(".");
const extension = dot > 0 ? display.slice(dot + 1).toLowerCase() : "";
const kindByExtension = { md: "markdown", markdown: "markdown", html: "html", htm: "html", js: "javascript", mjs: "javascript" };
const kind = kindByExtension[extension] || "text";

const bytes = path === "-"
  ? new Uint8Array(await new Response(Bun.stdin).arrayBuffer())
  : new Uint8Array(await Bun.file(path).arrayBuffer());

const share = (nm, by, m) => encodeSharedFile({ name: nm, mime: m || fileMime({ name: nm, type: "" }), bytes: by });

if (safe && rich) { console.error("--rich and --safe are mutually exclusive"); process.exit(2); }

const mediaKind = mediaLinkKind("https://linkoder.local/" + display);
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
    process.stdout.write("#share:" + share("combined.md", new TextEncoder().encode(combined.markdown), "text/markdown") + "\n");
  } else {
    // The lnkr route (mkit's edit-button behaviour): the combined markdown
    // as a proper lnkr link, so archives open as a combined md through the
    // pipelines. Respects the v1-v4 codec and the rich/safe marker.
    const md = combined.markdown + "style=jekyll\n";
    const payload = encoders[version](md, outputAlphabetASCII, "markdown").payload;
    const prefix = rich ? executablePrefixForKind("markdown") : "";
    process.stdout.write("#" + prefix + payload + "\n");
  }
} else if (make) {
  process.stdout.write("#share:" + share(display, bytes, mime) + "\n");
} else if (mediaKind === "image") {
  // The superlink image wrapper: an executable JS viewer whose src is the
  // file's Make share link. ln.kr accepts Make links as srcs, and Make links
  // are deflated, so the embedding takes far less space than a base64 data
  // URL. Regular utf text files do not take this route (direct v1 codec).
  const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
  const js = imageViewerSource(shareUrl);
  const payload = encoders[version](js, outputAlphabetASCII, "javascript").payload;
  const prefix = safe ? "" : executablePrefixForKind("javascript");
  process.stdout.write("#" + prefix + payload + "\n");
} else if (mediaKind === "video") {
  // The video twin of the image wrapper: an executable JS <video> whose src
  // is the file's Make share link (deflated, not a base64 data URL).
  const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
  const js = videoViewerSource(shareUrl);
  const payload = encoders[version](js, outputAlphabetASCII, "javascript").payload;
  const prefix = safe ? "" : executablePrefixForKind("javascript");
  process.stdout.write("#" + prefix + payload + "\n");
} else if (mediaKind === "pdf" || mediaKind === "audio") {
  const shareUrl = "https://app.shel.sh/make/#share:" + share(display, bytes, mime);
  const route = mediaKind === "pdf" ? "pdf" : "media";
  process.stdout.write("#" + route + ":" + encoders[version](shareUrl, outputAlphabetASCII, "text").payload + "\n");
} else {
  const text = new TextDecoder("utf-8").decode(bytes);
  const ephemeral = kind === "markdown" ? text + "style=jekyll\n" : text;
  const payload = encoders[version](ephemeral, outputAlphabetASCII, kind).payload;
  const prefix = rich ? executablePrefixForKind(kind) : "";
  process.stdout.write("#" + prefix + payload + "\n");
}
"##;

fn usage() {
    println!(
        "Usage: linkodec <file|-> [--rich|--safe] [--make] [--v1|--v2|--v3|--v4] [--name NAME] [--mime MIME]\n\
         \n\
         Prints only the hashtag code (the #fragment, no URL):\n\
         \x20 documents (md, html, js, text)  ->  #<v1..v4 text payload>      (a.shel.sh)\n\
         \x20 pdf, audio                      ->  #pdf: / #media:             (a.shel.sh)\n\
         \x20 image, video, archives, --make  ->  #share:<MKIT/1>             (app.shel.sh/make)\n\
         \n\
         --safe is the default for documents; --rich adds the executable viewer marker.\n\
         --v1 is the default text codec; --v2/--v3/--v4 select the lateral alternatives."
    );
}

fn find_bun() -> String {
    if let Ok(path) = env::var("PATH") {
        for dir in path.split(':') {
            if dir.is_empty() {
            }
            let candidate = format!("{dir}/bun");
            if fs::metadata(&candidate).map(|m| m.is_file()).unwrap_or(false) {
                return candidate;
            }
        }
    }
    if let Ok(home) = env::var("HOME") {
        let fallback = format!("{home}/.bun/bin/bun");
        if fs::metadata(&fallback).map(|m| m.is_file()).unwrap_or(false) {
            return fallback;
        }
    }
    "bun".to_string()
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut file: Option<String> = None;
    let mut flags: Vec<String> = Vec::new();

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => {
                usage();
                return ExitCode::SUCCESS;
            }
            "--rich" | "--safe" | "--make" | "--v1" | "--v2" | "--v3" | "--v4" => {
                flags.push(arg.clone());
            }
            "--name" | "--mime" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("linkodec: {arg} requires a value");
                    return ExitCode::from(2);
                }
                flags.push(arg.clone());
                flags.push(args[i].clone());
            }
            _ => {
                if file.is_none() {
                    file = Some(arg.clone());
                } else {
                    eprintln!("linkodec: unexpected argument: {arg}");
                    return ExitCode::from(2);
                }
            }
        }
        i += 1;
    }

    let Some(file) = file else {
        eprintln!("linkodec: no input file");
        usage();
        return ExitCode::from(2);
    };

    let path = if file == "-" {
        "-".to_string()
    } else {
        match fs::metadata(&file) {
            Ok(m) if m.is_file() => match std::fs::canonicalize(&file) {
                Ok(c) => c.to_string_lossy().into_owned(),
                Err(e) => {
                    eprintln!("linkodec: {file}: {e}");
                    return ExitCode::from(2);
                }
            },
            Ok(_) => {
                eprintln!("linkodec: {file}: not a regular file");
                return ExitCode::from(2);
            }
            Err(e) => {
                eprintln!("linkodec: {file}: {e}");
                return ExitCode::from(2);
            }
        }
    };

    let bun = find_bun();
    // Lateral self-resolution: the binary lives at <linkoder>/bin/linkodec,
    // so the root is two levels up. The driver resolves ln.kr/mk.it as
    // siblings of it; the env var is just the carrier.
    let root = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(|bin| bin.parent()).map(|r| r.to_path_buf()));
    let mut command = Command::new(&bun);
    command
        .arg("-e")
        .arg(DRIVER)
        .arg(&path)
        .args(&flags)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if let Some(r) = &root {
        if let Some(s) = r.to_str() {
            command.env("LINKODER_DIR", s);
        }
    }
    match command.status() {
        Ok(status) => match status.code() {
            Some(c) if (0..=255).contains(&c) => ExitCode::from(c as u8),
            _ => ExitCode::from(1),
        },
        Err(e) => {
            eprintln!("linkodec: failed to run {bun}: {e}");
            ExitCode::from(127)
        }
    }
}
