// linkoder encode worker: one member of the binary's 12-worker pool.
//
// Each member listens on <root>/.encode-worker-<id>.sock, records its pid in
// <root>/.encode-worker-<id>.pid (the binary reads these to pick a free
// worker and to kill a job that outlives its 20 s timer), and answers
// newline-JSON jobs:
//
//   -> {"id":1,"file":"/abs/path","rich":false,"safe":false,"make":false,
//       "version":1,"name":"x","mime":"y","input":"<b64, for stdin>"}
//   <- {"id":1,"code":"#..."}            (success)
//   <- {"id":1,"error":"..."}            (failure)
//
// The lateral modules are imported once at startup (warmed below), so each
// job pays only the encode itself, never the runtime or import cost. Jobs
// are CPU-bound and synchronous in the codec; the pool (not this process)
// provides the parallelism.

import net from "node:net";
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFile } from "./encode-core.js";

const argv = process.argv.slice(2);
let id = 0;
for (let i = 0; i < argv.length; i ++) {
  if (argv[i] === "--id") id = Number(argv[++i]) || 0;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOCK = join(ROOT, `.encode-worker-${id}.sock`);
const PIDF = join(ROOT, `.encode-worker-${id}.pid`);

async function handle (sock, line) {
  let job;
  try {
    job = JSON.parse(line);
  } catch {
    sock.write(JSON.stringify({ id: 1, error: "bad request" }) + "\n");
    return;
  }
  const out = { id: job.id ?? 1 };
  try {
    out.code = await encodeFile({
      linkoder: ROOT,
      path: job.file,
      input: job.input,
      rich: job.rich,
      safe: job.safe,
      make: job.make,
      version: job.version,
      name: job.name,
      mime: job.mime
    });
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  sock.write(JSON.stringify(out) + "\n");
}

try {
  await fs.promises.unlink(SOCK);
} catch {}

const server = net.createServer((sock) => {
  let buf = "";
  sock.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      handle(sock, line).catch((e) => {
        try {
          sock.write(JSON.stringify({ id: 1, error: String(e) }) + "\n");
        } catch {}
      });
    }
  });
  sock.on("error", () => {});
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") process.exit(0); // another member owns it
  console.error(String(e));
  process.exit(1);
});

server.listen(SOCK, () => {
  fs.writeFileSync(PIDF, String(process.pid));
  // Warm the lateral modules once at startup.
  encodeFile({ linkoder: ROOT, path: "/dev/null", version: 1 })
    .catch(() => {});
});

process.on("exit", () => {
  try {
    fs.unlinkSync(PIDF);
  } catch {}
});
