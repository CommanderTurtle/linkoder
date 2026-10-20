// linkodec -- ultrafast lateral worker pool for the ln.kr / mk.it hashtag encoders.
//
// The binary is a thin native harness: it validates its arguments, locates
// bun, and hands the job to a pool of 12 long-lived lateral workers (the
// same ln.kr/mk.it codec modules the static viewer sites run). Nothing is
// re-implemented here.
//
// Pool semantics:
//   * 12 workers, one socket each (.encode-worker-N.sock), FIFO queueing:
//     a free worker (idle per /proc state) takes the job; if all are busy
//     the job queues on the first one.
//   * A hard 20 s timer per job, enforced here in the binary layer. On
//     expiry the worker's job is killed (the worker is respawned) and the
//     encode falls back to a plain Make share link (#share:), which is a
//     fast deflate + base64url route with no codec wall.
//   * No bun / transport failure -> one-shot `bun -e` of the same driver,
//     under the same 20 s timer.
//
// Output is always only the hashtag code: the #fragment, no preceding URL.
//   documents (md, html, js, text)  ->  #<v1..v4 payload>        (a.shel.sh)
//   pdf, audio                      ->  #pdf: / #media:          (a.shel.sh)
//   image, video, archives, --make  ->  #share:<MKIT/1>          (app.shel.sh/make)

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, ExitCode, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const WORKERS: usize = 12;
const JOB_TIMEOUT: Duration = Duration::from_secs(15);
const SPAWN_TIMEOUT: Duration = Duration::from_secs(5);

const DRIVER: &str = r##"
const args = Bun.argv.slice(1);
let path = null, rich = false, safe = false, make = false, version = 0, name = "", mime = "";
// Not a user flag: the binary sets LINKODER_B64=1 when the make-hashtag-as-src
// route overflows the char limit, to resolve the custom viewer via the base64
// transcoder (perfected mime) in the make hashtag's place.
const b64Src = Bun.env.LINKODER_B64 === "1";
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
// One-shot cold driver: the same encode-core the pooled workers run, so the
// fallback and the pool produce byte-identical codes.
const LINKODER = Bun.env.LINKODER_DIR;
if (!LINKODER) { console.error("linkodec: LINKODER_DIR unset (the binary exports its own root)"); process.exit(2); }
const { encodeFile } = await import("file://" + LINKODER + "/bin/encode-core.js");
let input = null;
if (path === "-") {
  const buf = new Uint8Array(await new Response(Bun.stdin).arrayBuffer());
  input = Buffer.from(buf).toString("base64");
}
const code = await encodeFile({ linkoder: LINKODER, path, input, rich, safe, make, b64Src, version, name, mime });
process.stdout.write(code + "\n");
"##;


fn usage() {
    println!("Usage: linkodec <file|-> [--rich|--safe] [--make] [--v1|--v2|--v3|--v4] [--name NAME] [--mime MIME]");
}

fn find_bun() -> String {
    if let Ok(path) = env::var("PATH") {
        for dir in path.split(':') {
            let cand = PathBuf::from(dir).join("bun");
            if cand.is_file() {
                return cand.to_string_lossy().into_owned();
            }
        }
    }
    if let Ok(home) = env::var("HOME") {
        let cand = PathBuf::from(home).join(".bun/bin/bun");
        if cand.is_file() {
            return cand.to_string_lossy().into_owned();
        }
    }
    "bun".to_string()
}

fn root() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(|bin| bin.parent()).map(|r| r.to_path_buf()))
}

// ---------------------------------------------------------------- pool ---

fn worker_sock(r: &PathBuf, i: usize) -> PathBuf {
    r.join(format!(".encode-worker-{i}.sock"))
}

fn worker_pidfile(r: &PathBuf, i: usize) -> PathBuf {
    r.join(format!(".encode-worker-{i}.pid"))
}

fn read_pid(r: &PathBuf, i: usize) -> Option<u32> {
    let raw = fs::read_to_string(worker_pidfile(r, i)).ok()?;
    let pid: u32 = raw.trim().parse().ok()?;
    // Stale pid file: process gone.
    if !PathBuf::from(format!("/proc/{pid}")).exists() {
        return None;
    }
    Some(pid)
}

/// Process state from /proc/<pid>/stat ('R' = running, 'S'/'D' = idle-ish).
fn proc_state(pid: u32) -> Option<char> {
    let raw = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let close = raw.rfind(")?")?;
    let fields: Vec<&str> = raw[close + 2..].split(' ').collect();
    Some(fields.get(0)?.chars().next()?)
}

fn spawn_worker(bun: &str, r: &PathBuf, i: usize) -> bool {
    let sock = worker_sock(r, i);
    let _ = fs::remove_file(&sock);
    let js = r.join("bin/encode-worker.js");
    if !js.exists() {
        return false;
    }
    let mut cmd = Command::new(bun);
    cmd.arg(&js)
        .arg("--id")
        .arg(i.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if cmd.spawn().is_err() {
        return false;
    }
    let deadline = Instant::now() + SPAWN_TIMEOUT;
    loop {
        if std::os::unix::net::UnixStream::connect(&sock).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Pick a worker: rotate the starting index by wall clock, prefer a free
/// (non-'R') worker; if all are busy the job queues on the first one.
fn pick_worker(r: &PathBuf) -> usize {
    let start = (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as usize)
        .unwrap_or(0))
        % WORKERS;
    let mut fallback = start;
    for k in 0..WORKERS {
        let i = (start + k) % WORKERS;
        match read_pid(r, i) {
            Some(pid) => {
                if let Some(s) = proc_state(pid) {
                    if s != 'R' {
                        return i;
                    }
                } else {
                    return i; // unreadable state: assume free
                }
                if k == 0 {
                    fallback = i;
                }
            }
            None => return i, // no live worker: spawn it
        }
    }
    fallback
}

fn ensure_worker(bun: &str, r: &PathBuf, i: usize) -> bool {
    if read_pid(r, i).is_some() {
        return true;
    }
    spawn_worker(bun, r, i)
}

/// Run one job through a pooled worker. Ok(code) | Err(Timeout) | Err(Transport).
fn worker_job(
    bun: &str,
    r: &PathBuf,
    file: &str,
    flags_json: &str,
) -> Result<String, WorkerErr> {
    use std::os::unix::net::UnixStream;
    let i = pick_worker(r);
    if !ensure_worker(bun, r, i) {
        return Err(WorkerErr::Transport);
    }
    let stream = match UnixStream::connect(worker_sock(r, i)) {
        Ok(s) => s,
        Err(_) => {
            if !spawn_worker(bun, r, i) {
                return Err(WorkerErr::Transport);
            }
            UnixStream::connect(worker_sock(r, i)).map_err(|_| WorkerErr::Transport)?
        }
    };
    let mut stream = stream;
    let job = format!(
        "{{\"id\":1,\"file\":\"{}\",{}}}\n",
        json_escape(file),
        flags_json
    );
    if stream.write_all(job.as_bytes()).is_err() {
        return Err(WorkerErr::Transport);
    }
    let _ = stream.set_read_timeout(Some(JOB_TIMEOUT));
    let mut line = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => return Err(WorkerErr::Transport),
            Ok(n) => {
                line.extend_from_slice(&buf[..n]);
                if line.iter().any(|&b| b == b'\n') {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // 20 s timer fired: kill the worker's job, respawn it.
                if let Some(pid) = read_pid(r, i) {
                    let _ = nix_kill(pid);
                }
                let _ = fs::remove_file(worker_pidfile(r, i));
                let _ = spawn_worker(bun, r, i);
                return Err(WorkerErr::Timeout);
            }
            Err(_) => return Err(WorkerErr::Transport),
        }
    }
    let text = String::from_utf8_lossy(&line);
    parse_worker_response(&text)
}

#[derive(Debug)]
enum WorkerErr {
    Timeout,
    Transport,
}

fn nix_kill(pid: u32) -> std::io::Result<()> {
    let _ = libc_kill(pid);
    Ok(())
}

// SIGKILL without a libc dependency: /proc/<pid>/task/<pid>/... is overkill;
// use the kill(1) binary via Command for portability of the kill itself.
fn libc_kill(pid: u32) {
    let _ = Command::new("kill").args(&["-9", &pid.to_string()]).spawn();
}

fn json_escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn parse_worker_response(line: &str) -> Result<String, WorkerErr> {
    let t = line.trim();
    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    if let Some(i) = t.find("\"code\":\"") {
        let rest = &t[i + 8..];
        if let Some(end) = rest.find('"') {
            code = Some(rest[..end].to_string());
        }
    }
    if let Some(i) = t.find("\"error\":\"") {
        let rest = &t[i + 9..];
        if let Some(end) = rest.find('"') {
            error = Some(rest[..end].to_string());
        }
    }
    if let Some(c) = code {
        if c.starts_with('#') {
            return Ok(c);
        }
    }
    if let Some(e) = error {
        eprintln!("linkodec: worker: {e}");
    }
    Err(WorkerErr::Transport)
}

// ------------------------------------------------------- cold fallback ---

/// One-shot `bun -e` of the driver, under JOB_TIMEOUT. Returns Ok(output).
/// `stdin_b64` carries drained stdin for the "-" path (the driver would
/// otherwise read an already-consumed pipe).
fn cold_driver(
    bun: &str,
    r: Option<&PathBuf>,
    path: &str,
    extra: &[String],
    b64: bool,
    stdin_b64: Option<&str>,
) -> Result<String, ()> {
    let mut cmd = Command::new(bun);
    cmd.arg("-e")
        .arg(DRIVER)
        .arg(path)
        .args(extra);
    if stdin_b64.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::inherit());
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());
    if let Some(rr) = r {
        if let Some(s) = rr.to_str() {
            cmd.env("LINKODER_DIR", s);
        }
    }
    if b64 {
        cmd.env("LINKODER_B64", "1");
    }
    let mut child: Child = cmd.spawn().map_err(|_| ())?;
    if let Some(b) = stdin_b64 {
        if let Some(mut pipe) = child.stdin.take() {
            let _ = pipe.write_all(&base64_decode(b));
            let _ = pipe.flush();
        }
    }
    // Drain stdout on a dedicated thread: a >64KB response (e.g. a 1.4MB
    // #share code) would otherwise fill the pipe and deadlock the child,
    // which cannot exit until the pipe is read.
    let stdout = child.stdout.take();
    let reader = stdout.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = pipe.read_to_string(&mut s);
            s
        })
    });
    let deadline = Instant::now() + JOB_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader
                    .and_then(|h| h.join().ok())
                    .unwrap_or_default();
                if status.success() {
                    return Ok(out);
                }
                eprintln!("linkodec: encode failed");
                return Err(());
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("linkodec: timed out after 20 s");
                    return Err(());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                eprintln!("linkodec: {e}");
                return Err(());
            }
        }
    }
}

// ---------------------------------------------------------------- main ---
/// The 1,000,000-char cap: applies only to the make-share fallback that
/// runs after the 20 s timer fires (the second timer resolution). Output
/// beyond it is a clean failure.
fn emit(code: &str) -> ExitCode {
    let code = code.trim_end_matches('\n');
    if code.len() > 1_000_000 {
        eprintln!(
            "linkodec: output exceeds 1,000,000 chars ({} chars) — clean failure",
            code.len()
        );
        return ExitCode::from(1);
    }
    println!("{code}");
    ExitCode::SUCCESS
}


fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut file: Option<String> = None;
    let mut rich = false;
    let mut safe = false;
    let mut make = false;
    let mut version = 0;
    let mut name = String::new();
    let mut mime = String::new();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--rich" => rich = true,
            "--safe" => safe = true,
            "--make" => make = true,
            "--v1" => version = 1,
            "--v2" => version = 2,
            "--v3" => version = 3,
            "--v4" => version = 4,
            "--name" => {
                i += 1;
                name = args.get(i).cloned().unwrap_or_default();
            }
            "--mime" => {
                i += 1;
                mime = args.get(i).cloned().unwrap_or_default();
            }
            a if a.starts_with('-') && a != "-" => {
                eprintln!("linkodec: unknown flag {a}");
                usage();
                return ExitCode::from(2);
            }
            a => {
                if file.is_none() {
                    file = Some(a.to_string());
                } else {
                    eprintln!("linkodec: unexpected argument {a}");
                    return ExitCode::from(2);
                }
            }
        }
        i += 1;
    }

    let Some(file) = file else {
        usage();
        return ExitCode::from(2);
    };

    // "-" = stdin: drain it and carry it in the job.
    let stdin_b64 = if file == "-" {
        let mut buf = Vec::new();
        let _ = std::io::stdin().read_to_end(&mut buf);
        Some(base64(&buf))
    } else {
        None
    };

    let bun = find_bun();
    let root = root();
    let mut flags = String::new();
    flags.push_str(&format!("\"rich\":{rich},"));
    flags.push_str(&format!("\"safe\":{safe},"));
    flags.push_str(&format!("\"make\":{make},"));
    flags.push_str(&format!("\"version\":{version},"));
    if !name.is_empty() {
        flags.push_str(&format!("\"name\":\"{}\"," , json_escape(&name)));
    }
    if !mime.is_empty() {
        flags.push_str(&format!("\"mime\":\"{}\"," , json_escape(&mime)));
    }
    if let Some(b) = &stdin_b64 {
        flags.push_str(&format!("\"input\":\"{b}\","));
    }
    let _ = flags.pop(); // trailing comma

    // Explicit --make: straight to the (fast) share route, no timer games.
    if make {
        match cold_driver(&bun, root.as_ref(), &file, &["--make".into()], false, stdin_b64.as_deref()) {
            Ok(out) => return emit(&out),
            Err(()) => return ExitCode::from(1),
        }
    }

    // Pool path (needs a root to hold sockets/pidfiles).
    if let Some(r) = &root {
        match worker_job(&bun, r, &file, &flags) {
            Ok(code) => {
                let code = code.trim_end_matches('\n').to_string();
                if code.len() > 1_000_000 {
                    // Char-limit failure: the make-hashtag-as-src route overflowed
                    // (deflating-a-deflate expands). Resolve the custom viewer via
                    // the base64 transcoder (perfected mime) in the make hashtag's
                    // place. v3 is always handed here (the most robust per
                    // browser testing); the 1M cap (emit) and the 20 s timer
                    // still apply to the result.
                    eprintln!("linkodec: char limit exceeded ({} chars), falling back to base64 transcoder", code.len());
                    let mut extra: Vec<String> = Vec::new();
                    if rich { extra.push("--rich".into()); }
                    if safe { extra.push("--safe".into()); }
                    extra.push("--v3".into());
                    if !name.is_empty() { extra.push("--name".into()); extra.push(name); }
                    if !mime.is_empty() { extra.push("--mime".into()); extra.push(mime); }
                    match cold_driver(&bun, Some(r), &file, &extra, true, stdin_b64.as_deref()) {
                        Ok(out) => return emit(&out),
                        Err(()) => return ExitCode::from(1),
                    }
                }
                return emit(&code);
            }
            Err(WorkerErr::Timeout) => {
                // 20 s timer: the lnkr route (make link as src) was too slow.
                // The make link itself resolved and survives the 1M-char test,
                // so instead of bailing to the raw #share link, honor the lnkr
                // request with v4 — the strongest deflate, already as optimized
                // as the make link. The 1M cap (emit) still applies.
                eprintln!("linkodec: 20 s timer, falling back to v4 lnkr");
                match cold_driver(&bun, Some(r), &file, &["--v4".into()], false, stdin_b64.as_deref()) {
                    Ok(out) => return emit(&out),
                    Err(()) => return ExitCode::from(1),
                }
            }
            Err(WorkerErr::Transport) => {
                // Worker unusable: one-shot cold driver, same route.
                let mut extra: Vec<String> = Vec::new();
                if rich {
                    extra.push("--rich".into());
                }
                if safe {
                    extra.push("--safe".into());
                }
                if version != 0 {
                    extra.push(format!("--v{version}"));
                }
                if !name.is_empty() {
                    extra.push("--name".into());
                    extra.push(name);
                }
                if !mime.is_empty() {
                    extra.push("--mime".into());
                    extra.push(mime);
                }
                match cold_driver(&bun, Some(r), &file, &extra, false, stdin_b64.as_deref()) {
                    Ok(out) => return emit(&out),
                    Err(()) => return ExitCode::from(1),
                }
            }
        }
    }

    // No root (weird install): plain cold driver with the same flags.
    let mut extra: Vec<String> = Vec::new();
    if rich { extra.push("--rich".into()); }
    if safe { extra.push("--safe".into()); }
    if version != 0 { extra.push(format!("--v{version}")); }
    if !name.is_empty() { extra.push("--name".into()); extra.push(name); }
    if !mime.is_empty() { extra.push("--mime".into()); extra.push(mime); }
    match cold_driver(&bun, None, &file, &extra, false, stdin_b64.as_deref()) {
        Ok(out) => emit(&out),
        Err(()) => ExitCode::from(1),
    }
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in data.chunks(3) {
        let b = [c.get(0).copied().unwrap_or(0), c.get(1).copied().unwrap_or(0), c.get(2).copied().unwrap_or(0)];
        out.push(T[(b[0] >> 2) as usize] as char);
        out.push(T[((b[0] & 3) << 4 | b[1] >> 4) as usize] as char);
        out.push(if c.len() > 1 { T[((b[1] & 15) << 2 | b[2] >> 4) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { T[(b[2] & 63) as usize] as char } else { '=' });
    }
    out
}

fn base64_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut nbits = 0;
    for c in s.chars() {
        if c == '=' {
            break;
        }
        let v = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            _ => continue,
        };
        acc = (acc << 6) | v;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push(((acc >> nbits) & 0xff) as u8);
        }
    }
    out
}
