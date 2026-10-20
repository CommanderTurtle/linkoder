# Ln.Kr previewer row for omafile (local patch)

## Context

omafile already opens files in editors, terminals, and the system default
app. This patch adds one more row to the right-click menu for files: the
**Ln.Kr / Make previewer links**, driven by the lateral **linkoder** API
(`~/Documents/Dev/linkoder`), which is a bun CLI plus a zero-dependency Rust
worker (`bin/linkodec`) over the `ln.kr` codec framework and the `mk.it`
share envelope.

The premise of the shel.sh sites is that they are completely static: JS
resolves the URLs on the client side, so **all share links have already been
created until the end of time** -- the encoder only picks which one to print.

- **link** -- a `a.shel.sh` v1 hashtag link for the file with the executable
  viewer marker (`#m:` markdown, `#h:` html, `#r:` javascript; images take
  the mk.it image-viewer wrapper, an executable JS link).
- **safe** -- the same `a.shel.sh` v1 link in the inert form (no marker;
  the recipient chooses Run).
- **#share** -- an `app.shel.sh/make/#share:` MKIT/1 envelope link (the
  right codec for video/media/etc.; archives become combined markdown
  ephemerally).
- Links open in a **Helium webapp window** via
  `omarchy launch or focus webapp lnkr <url>` (repeat opens focus the same
  window). **Shift-click** a label to hoist the hashtag code (the part after
  `#`) to the clipboard instead of opening it.

Base: the current plugin state (v1.4.4 + the four-feature local patch,
commit `c2cf091`), treated as upstream.

## The change

Four files, one behaviour:

1. `bin/omafile-helper` -- two new ops in `SIMPLE_OPS`:
   - `lnkrsweep` -- a depth-3 `os.walk` of the home directory for the
     literal `linkoder` folder that must contain `api.js`; first hit wins;
     answers with the path (or an empty string).
   - `lnkreencode` -- runs the encoder for one file: prefers the native
     `bin/linkodec` worker in the linkoder folder, falls back to
     `bun api.js`. `linkodec` prints only the hashtag code, so the op
     reconstructs the base URL (`#share:` -> `app.shel.sh/make/`, anything
     else -> `a.shel.sh/`); the legacy `api.js` already prints the full
     URL and is used as-is. 120 s timeout.
   Exec lives in the helper, not QML: `Quickshell.execute` is not a
   function in Quickshell 0.3.2 (only `execDetached`/`env`/`reload`), which
   is what silently broke the earlier QML-side sweep. The helper has a full
   environment and can run bun.
2. `Service.qml` -- `lnkrApiDir` / `lnkrSweepHome` / `lnkrEncode` /
   `lnkrOpen` plus a `lnkrWarning` string surfaced on the bar. All three
   working functions are async `request()` calls to the helper ops. The
   sweep runs **when the settings toggle is flipped** (`applySettingNow`):
   the hit is persisted as `lnkrApiPath`. From then on `lnkrApiDir` only
   reads the persisted setting -- button clicks never re-sweep, and a
   missing folder therefore never throws at click time; the warning is set
   once, at flip time.
3. `components/Browser.qml`
   - `contextActions`: files only, when the `lnkr` setting is on, a
     `{ key: "lnkr", kind: "lnkr" }` item directly under *Open in editor*.
   - the context-menu delegate renders the row for `kind === "lnkr"` as a
     literal text line -- `link | safe | #share` -- each label an
     independent clickable hot region (caption size, its own hover
     highlight, `|` separators dimmed). The row takes the normal 24 px item
     height and suppresses the separator line.
   - `runLnkr(mode, copyOnly)`: encodes the `menuEntry` path through
     `service.lnkrEncode(path, mode, onDone)` (callback form, since the
     encode is now asynchronous), then either copies the hashtag (after
     `#`) via `service.copyToClipboardText` (shift-click) or opens the URL
     with `service.lnkrOpen`.
   - the bar's right-hand warning text now also shows `lnkrWarning`.
   - `browsingRows()`: new toggle "Ln.Kr previewer links" (off by default);
     `applySettingNow` runs `lnkrSweepHome()` when it is turned on.
4. `tests/MockService.qml` -- the four functions (+ `lnkrWarning`) recorded;
   `lnkrEncode` takes the optional `onDone` callback.

## Notes

- The menu width is the fixed 230 px (`menuWidth`); the literal row
  `link | safe | #share` is caption-size and fits with margin to spare.
- The encode is asynchronous (helper op, 120 s budget): the click never
  blocks the QML thread. Archives do the most work (decompression +
  combining) and can take longest.
- The sweep matches the literal folder name `linkoder` (depth <= 3 from
  `$HOME`, e.g. `~/Documents/Dev/linkoder`) and requires `api.js` inside
  it; the first hit wins. It runs only at toggle-flip time; a later move of
  the folder needs the `lnkrApiPath` setting cleared (or the toggle flipped
  again) to re-run the sweep.
- The `lnkr` row is hidden for directories and when the setting is off --
  the menu is byte-identical to upstream for everyone who leaves it off.

## Verification

- `tests/browser-flows.sh` (offscreen `qs`): the scene loads with the patch
  applied; the failure set is identical to the unpatched checkout (the
  `FAILED_IN` cases are a pre-existing `MockService` gap from the
  four-feature commit -- `openWithFiles` / `runCommandOnFiles` /
  `openExternallyFiles` & friends are missing from the mock -- and are not
  introduced here).
- Patch hygiene: `git apply --check` and `git apply -R --check` both pass on
  a clean `c2cf091` tree; `apply.sh` is idempotent (forward, reverse, and
  already-applied paths).
- The helper ops were exercised headless: `lnkrsweep` returns
  `~/Documents/Dev/linkoder`; `lnkreencode` (rich on a markdown file)
  returns a valid `a.shel.sh` URL; a bad mode answers `EINVAL`.
- The linkoder API behind the row was exercised end-to-end: markdown, html,
  js, pdf, mp3, mp4, png and zip inputs all print well-formed links, and
  the payloads decode back through the `ln.kr` / `mk.it` decoders to the
  original content (md carries the ephemeral `style=jekyll` + newline;
  archives decode to `combined.md`; images decode to the image-viewer JS
  with the data URL intact). The native `linkodec` worker's output is
  byte-identical to `api.js` for every route, and its v2/v3/v4 text
  payloads round-trip through the lateral `decompressText`.

## Open questions

- Nothing blocking. Possible follow-ups: keyboard hints for the row, a
  per-folder "prefer #share" preference, and wiring the sweep to also accept
  a user-set path (text setting) if the folder ever leaves the depth-3 cone.

<details>
<summary>Patch (omafile-local.patch, git diff against the current state)</summary>

```diff
diff --git c/Service.qml w/Service.qml
index d717c98..139f0cc 100644
--- c/Service.qml
+++ w/Service.qml
@@ -1300,6 +1300,63 @@ Item {
     Quickshell.execDetached(["sh", "-c", "printf %s \"$1\" | wl-copy", "omafile", String(text)])
   }
 
+  // Ln.Kr / Make previewer links, driven by the lateral linkoder API.
+  property string lnkrWarning: ""
+
+  function lnkrApiDir() {
+    return String(settingNow("lnkrApiPath", "") || "").trim()
+  }
+
+  // First enablement: a depth-3 sweep of the home directory looking for the
+  // literal "linkoder" folder that carries the API. Runs when the settings
+  // toggle is flipped; the hit is persisted as lnkrApiPath and reused from
+  // then on (label clicks never re-sweep).
+  function lnkrSweepHome() {
+    request({ op: "lnkrsweep" }, {
+      onDone: function (m) {
+        var dir = String(m.path || "")
+        if (dir) {
+          updateSetting("lnkrApiPath", dir)
+          lnkrWarning = ""
+        } else {
+          lnkrWarning = "Ln.Kr: the linkoder API folder was not found under your home directory"
+        }
+      },
+      onError: function (e) {
+        lnkrWarning = "Ln.Kr: the home sweep failed"
+      }
+    })
+  }
+
+  function lnkrEncode(path, mode, onDone) {
+    var dir = lnkrApiDir()
+    if (!dir) {
+      if (onDone) onDone("")
+      return
+    }
+    request({ op: "lnkrencode", dir: dir, path: path, mode: mode }, {
+      onDone: function (m) {
+        var url = String(m.url || "")
+        if (!/^https:\/\//.test(url)) {
+          lnkrWarning = "Ln.Kr: the linkoder API did not return a link"
+          if (onDone) onDone("")
+          return
+        }
+        lnkrWarning = ""
+        if (onDone) onDone(url)
+        else lnkrOpen(url)
+      },
+      onError: function (e) {
+        lnkrWarning = "Ln.Kr: the linkoder API did not return a link"
+        if (onDone) onDone("")
+      }
+    })
+  }
+
+  function lnkrOpen(url) {
+    Quickshell.execDetached(["omarchy", "launch", "or", "focus", "webapp", "lnkr", url])
+  }
+
   function mountDrive(devicePath, onDone, onError) {
     return request({ op: "mountdev", device: String(devicePath) }, {
       onDone: function (m) {
diff --git c/bin/omafile-helper w/bin/omafile-helper
index c1a405d..6ae3650 100755
--- c/bin/omafile-helper
+++ w/bin/omafile-helper
@@ -4364,6 +4364,102 @@ def op_transcode(req, cancel_event):
     send_done(req_id, outputs=outputs)
 
 
+LNKR_MODES = ("rich", "safe", "make")
+
+
+def lnkr_bun():
+    # Prefer a trusted location; fall back to the user's own PATH (bun is a
+    # user-installed tool, typically in ~/.bun/bin or a mise shim).
+    try:
+        return trusted_program("bun")
+    except FileNotFoundError:
+        pass
+    for directory in os.environ.get("PATH", "").split(os.pathsep):
+        candidate = os.path.join(directory, "bun")
+        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
+            return candidate
+    raise FileNotFoundError(errno.ENOENT, "no bun executable found")
+
+
+def op_lnkrsweep(req):
+    # Depth-3 sweep of the home directory for the literal "linkoder" folder
+    # that carries the API (must contain api.js). First hit wins.
+    req_id = req["id"]
+    home = HOME
+    found = ""
+    for dirpath, dirnames, _ in os.walk(home, topdown=True, followlinks=False):
+        rel = os.path.relpath(dirpath, home)
+        depth = 0 if rel == "." else rel.count(os.sep) + 1
+        if depth <= 2 and "linkoder" in dirnames:
+            candidate = os.path.join(dirpath, "linkoder")
+            if os.path.isfile(os.path.join(candidate, "api.js")):
+                found = candidate
+                break
+        if depth >= 3:
+            dirnames[:] = []
+    send_done(req_id, path=found)
+
+
+def op_lnkreencode(req):
+    req_id = req["id"]
+    api_dir = req.get("dir")
+    path = req.get("path")
+    mode = req.get("mode")
+    if (not isinstance(api_dir, str) or not os.path.isabs(api_dir)
+            or not isinstance(path, str) or not os.path.isabs(path)
+            or mode not in LNKR_MODES):
+        send_error(req_id, "EINVAL",
+                   "absolute dir and path and a mode (rich, safe, make) are required")
+        return
+    if not os.path.isfile(path):
+        send_error(req_id, "ENOENT", "no such file", path)
+        return
+    binary = os.path.join(api_dir, "bin", "linkodec")
+    if os.path.isfile(binary) and os.access(binary, os.X_OK):
+        cmd = [binary, path, "--" + mode]
+    else:
+        if not os.path.isfile(os.path.join(api_dir, "api.js")):
+            send_error(req_id, "ENOENT", "no linkoder API in the folder", api_dir)
+            return
+        try:
+            bun = lnkr_bun()
+        except FileNotFoundError:
+            send_error(req_id, "EUNSUPPORTED", "bun is not installed")
+            return
+        cmd = [bun, os.path.join(api_dir, "api.js"), path, "--" + mode]
+    env = trusted_env()
+    env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin")
+    try:
+        proc = subprocess.run(
+            cmd,
+            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
+            env=env, timeout=120, check=False)
+    except (OSError, subprocess.TimeoutExpired) as e:
+        send_error(req_id, errno_code(e), "linkoder encode failed", path)
+        return
+    if proc.returncode != 0:
+        message = proc.stderr.decode("utf-8", "replace").strip()
+        send_error(req_id, "ELNKR", message or "linkoder encode failed", path)
+        return
+    # The native worker prints only the hashtag code; the legacy api.js
+    # prints the full URL. Reconstruct the base from the code when needed.
+    url = ""
+    for line in proc.stdout.decode("utf-8", "replace").splitlines():
+        line = line.strip()
+        if line.startswith("https://"):
+            url = line
+        elif line.startswith("#"):
+            base = ("https://app.shel.sh/make/" if line.startswith("#share:")
+                    else "https://a.shel.sh/")
+            url = base + line
+        if url:
+            break
+    if not url:
+        send_error(req_id, "ELNKR", "linkoder did not return a link", path)
+        return
+    send_done(req_id, url=url)
+
+
 CANCELLABLE_OPS = {
     "list": op_list,
     "search": op_search,
@@ -4422,6 +4518,8 @@ SIMPLE_OPS = {
     "unwatch": op_unwatch,
     "baricon": op_baricon,
     "barsettings": op_barsettings,
+    "lnkrsweep": op_lnkrsweep,
+    "lnkreencode": op_lnkreencode,
 }
 
 def dispatch(req):
diff --git c/components/Browser.qml w/components/Browser.qml
index 2a66b2f..e8a54ed 100644
--- c/components/Browser.qml
+++ w/components/Browser.qml
@@ -1160,6 +1160,8 @@ Item {
       items.push({ key: "open", label: "Open", glyph: Icons.actionGlyph("open"), hint: "Enter" })
       items.push({ key: "openwith", label: "Open with", glyph: Icons.actionGlyph("open") })
       items.push({ key: "editor", label: "Open in editor", glyph: Icons.actionGlyph("editor") })
+      if (!entry.isDir && boolSetting("lnkr", false))
+        items.push({ key: "lnkr", label: "", glyph: "", kind: "lnkr" })
       if (entry.isDir)
         items.push({ key: "opentab", label: "Open in new tab", glyph: Icons.actionGlyph("add"), hint: "Ctrl+Enter" })
       else
@@ -1525,6 +1527,20 @@ Item {
       showDialog("settings", "Settings", "", null)
     }
     else if (key === "shortcuts") showDialog("shortcuts", "Keyboard shortcuts", "", null)
+    else if (key.indexOf("lnkr:") === 0) runLnkr(key.substring(5), false)
+  }
+  function runLnkr(mode, copyOnly) {
+    var entry = menuEntry
+    if (!entry || !service) return
+    if (copyOnly) {
+      service.lnkrEncode(entry.path, mode, function (url) {
+        if (!url) return
+        var hash = url.indexOf("#") >= 0 ? url.slice(url.indexOf("#") + 1) : url
+        service.copyToClipboardText(hash)
+      })
+      return
+    }
+    service.lnkrEncode(entry.path, mode)
   }
   function runZoom(action) {
     if (action === "in") nudgeViewScale(0.1)
@@ -2829,7 +2845,7 @@ Item {
           anchors.rightMargin: Style.space(10)
           anchors.verticalCenter: parent.verticalCenter
           visible: text !== ""
-          text: root.service ? (root.service.bookmarksError || root.service.helperError || "") : ""
+          text: root.service ? (root.service.bookmarksError || root.service.helperError || root.service.lnkrWarning || "") : ""
           color: Color.urgent
           font.family: Style.font.family
           font.pixelSize: Style.font.caption
@@ -2890,17 +2906,18 @@ Item {
             required property int index
             readonly property bool isHeader: modelData.kind === "header"
             readonly property bool isZoom: modelData.kind === "zoom"
+            readonly property bool isLnkr: modelData.kind === "lnkr"
             readonly property bool highlighted: !modelData.disabled && !isHeader
               && (root.menuCursor === index || (itemHover.hovered && !isZoom))
             width: menuColumn.width
-            height: modelData.label === "" ? Style.space(7)
+            height: modelData.label === "" ? (isLnkr ? Style.space(24) : Style.space(7))
               : (isHeader ? Style.space(20) : Style.space(24))
 
             Rectangle {
               anchors.centerIn: parent
               width: parent.width - Style.space(8)
               height: 1
-              visible: modelData.label === ""
+              visible: modelData.label === "" && !menuRow.isLnkr
               color: Util.alpha(Color.menu.text, 0.15)
             }
 
@@ -3017,6 +3034,55 @@ Item {
                 }
               }
             }
+
+            Row {
+              anchors.left: parent.left
+              anchors.verticalCenter: parent.verticalCenter
+              anchors.leftMargin: Style.space(8)
+              visible: menuRow.isLnkr
+              spacing: Style.space(6)
+
+              Repeater {
+                model: menuRow.isLnkr ? [
+                  { mode: "rich", label: "link" },
+                  { mode: "safe", label: "safe" },
+                  { mode: "make", label: "#share" }
+                ] : []
+
+                delegate: Row {
+                  required property var modelData
+                  spacing: Style.space(6)
+
+                  Text {
+                    textFormat: Text.PlainText
+                    visible: index > 0
+                    text: "|"
+                    color: Util.alpha(Color.menu.text, 0.4)
+                    font.family: Style.font.family
+                    font.pixelSize: Style.font.caption
+                    anchors.verticalCenter: parent.verticalCenter
+                  }
+
+                  Text {
+                    textFormat: Text.PlainText
+                    text: modelData.label
+                    color: lnkrLabelHover.hovered ? Color.menu.selectedText : Color.menu.text
+                    font.family: Style.font.family
+                    font.pixelSize: Style.font.caption
+                    anchors.verticalCenter: parent.verticalCenter
+
+                    HoverHandler { id: lnkrLabelHover }
+
+                    MouseArea {
+                      anchors.fill: parent
+                      onClicked: function (mouse) {
+                        root.runLnkr(modelData.mode, (mouse.modifiers & Qt.ShiftModifier) !== 0)
+                      }
+                    }
+                  }
+                }
+              }
+            }
           }
         }
       }
@@ -4405,7 +4471,9 @@ Item {
       { key: "rememberFolderViews", label: "Remember the view for each folder",
         description: "A folder opens in the view you last picked there. Other folders open in the default view" },
       { key: "extractOnOpen", label: "Extract archives when opened", fallback: false,
-        description: "Double click or Enter extracts zip, tar, 7z and rar files next to themselves instead of opening them in your default app" }
+        description: "Double click or Enter extracts zip, tar, 7z and rar files next to themselves instead of opening them in your default app" },
+      { key: "lnkr", label: "Ln.Kr previewer links", fallback: false,
+        description: "Show the link | safe | #share row in the right-click menu; links open in a Helium webapp window. On first enable, omafile looks for the linkoder folder under your home directory" }
     ]
   }
 
@@ -4445,6 +4513,8 @@ Item {
     } else if (key === "thumbnails") {
       paneA.thumbnails = value
       if (split) paneB.thumbnails = value
+    } else if (key === "lnkr") {
+      if (value === true) service.lnkrSweepHome()
     }
     rememberSession()
   }
diff --git c/tests/MockService.qml w/tests/MockService.qml
index 6d0dcfb..42c8131 100644
--- c/tests/MockService.qml
+++ w/tests/MockService.qml
@@ -152,6 +152,11 @@ QtObject {
   }
   function disconnectServer(path, onDone, onError) { record("disconnectServer", [path]) }
   function copyToClipboardText(text) { record("copyToClipboardText", [text]) }
+  property string lnkrWarning: ""
+  function lnkrApiDir() { record("lnkrApiDir", []); return "" }
+  function lnkrSweepHome() { record("lnkrSweepHome", []); return "" }
+  function lnkrEncode(path, mode, onDone) { record("lnkrEncode", [path, mode]); if (onDone) onDone("") }
+  function lnkrOpen(url) { record("lnkrOpen", [url]) }
   function emptyTrash(onDone) { record("emptyTrash", []); trashCount = 0; if (onDone) onDone({}) }
   function peekFile(path, limit, onDone, onError) { record("peekFile", [path]); onDone({ text: "key: value\n", binary: false, truncated: false }) }
   function openWith(command, path, inTerminal) { record("openWith", [command, path, inTerminal]) }
```

</details>
