// wasm-link.js -- keep wasm/7zz.wasm pointed at a usable 7z-wasm binary.
//
// 7z-wasm fetches its binary as BASE_URL + "wasm/7zz.wasm" (the vite site
// path). The binary ships inside the 7z-wasm package, and the package moves:
// mk.it keeps it under node_modules only until a build cleanup, after which
// bun imports it from a global install cache instead. So the link under the
// linkoder root is generated state (wasm/ is gitignored) and is re-pointed at
// the newest copy that exists on every fresh process -- the lateral mk.it pin
// first, because that is the module bun imports while node_modules is
// present, then the highest 7z-wasm version in each bun cache root, because
// that is what gets imported once it is not. The lateral mk.it source itself
// stays untouched.
//
// existsSync follows symlinks, so it cannot see a dangling one: every probe
// here goes through lstat/realpath, and a stale link is replaced rather than
// skipped. A missing binary is left missing -- the non-archive routes need no
// wasm at all, and the archive route then fails with the loader's own ENOENT
// instead of an empty /dev/null turning into an invalid-module abort later.

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PKG = "7z-wasm";
const BINARY = "7zz.wasm";

// Bun cache roots, in lookup order: the explicit override, ~/.bun, ~/.cache/.bun.
function cacheRoots () {
  const home = homedir();
  const roots = [];
  if (process.env.BUN_INSTALL_CACHE_DIR) roots.push(process.env.BUN_INSTALL_CACHE_DIR);
  if (home) roots.push(join(home, ".bun/install/cache"), join(home, ".cache/.bun/install/cache"));
  return roots;
}

function lexists (path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function pointsAt (path, target) {
  try { return realpathSync(path) === target; } catch { return false; }
}

function remove (path) {
  try { unlinkSync(path); } catch (e) { if (e.code !== "ENOENT") throw e; }
}

// Numeric version tuple of a cache entry name ("7z-wasm@1.2.0@@@1" -> [1,2,0]).
function versionOf (name) {
  const at = name.indexOf("@", PKG.length + 1);
  const raw = at < 0 ? name.slice(PKG.length + 1) : name.slice(PKG.length + 1, at);
  return raw.split(".").map(part => Number(/^\d+/.exec(part)?.[0] ?? 0));
}

function newer (a, b) {
  for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
    const d = (b.version[i] ?? 0) - (a.version[i] ?? 0);
    if (d) return d;
  }
  return b.mtime - a.mtime;
}

// The newest 7zz.wasm installed under one cache root, if any.
function cachedWasm (root) {
  let names;
  try { names = readdirSync(root); } catch { return null; }
  const found = [];
  for (const name of names) {
    if (!name.startsWith(PKG + "@")) continue;
    const path = join(root, name, BINARY);
    if (!existsSync(path)) continue;
    found.push({ path, version: versionOf(name), mtime: statSync(path).mtimeMs });
  }
  found.sort(newer);
  return found.length ? found[0].path : null;
}

/**
 * Point <linkoder>/wasm/7zz.wasm at the newest installed 7z-wasm binary.
 *
 * @param linkoder  linkoder repository root (holds the generated wasm/)
 * @param mkItRoot  lateral mk.it repository root (its node_modules pin wins)
 * @returns the binary the link resolves to, or null when none is installed
 */
export function ensureWasm (linkoder, mkItRoot) {
  const wasm = resolve(linkoder, "wasm", BINARY);
  const seen = new Set();
  const candidates = [];
  for (const path of [resolve(mkItRoot, "node_modules", PKG, BINARY), ...cacheRoots().map(cachedWasm)]) {
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    candidates.push(path);
  }
  if (!candidates.length) return null;

  // Fixed precedence, not newest-wins-by-version: mk.it's own copy is the
  // module bun imports while node_modules is installed, so it outranks every
  // cache entry; the cache entries are already ordered newest first.
  const src = candidates[0];
  let target;
  try { target = realpathSync(src); } catch { return null; } // uninstalled mid-run
  if (pointsAt(wasm, target)) return target;

  const dir = dirname(wasm);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (lexists(wasm)) remove(wasm);
    try { symlinkSync(target, wasm); return target; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (pointsAt(wasm, target)) return target; // a pool sibling won the race
    }
  }
  throw new Error(`linkoder: cannot place ${wasm} -> ${target}`);
}
