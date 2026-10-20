# Ln.Kr previewer row for omafile (local patch)

## Context

omafile already opens files in editors, terminals, and the system default
app. This patch adds one more row to the right-click menu for files: the
**Ln.Kr / Make previewer links**, driven by the lateral **linkoder** API
(`~/Documents/Dev/linkoder`, a bun CLI over the `ln.kr` codec framework and
the `mk.it` share envelope).

The premise of the shel.sh sites is that they are completely static: JS
resolves the URLs on the client side, so **all share links have already been
created until the end of time** -- the encoder only picks which one to print.

- **Ln.Kr (Rich)** / **Ln.Kr (Safe)** -- a `a.shel.sh` v1 hashtag link for the
  file (documents render in the previewer; `--rich` selects the expanded
  unique-origin viewer with network enabled, `--safe` the inert form).
- **#share** -- an `app.shel.sh/make/#share:` MKIT/1 envelope link (the right
  codec for pdf/media/etc.; archives become combined markdown ephemerally).
- Links open in a **Helium webapp window** via
  `omarchy launch or focus webapp lnkr <url>` (repeat opens focus the same
  window). **Shift-click** a label to hoist the hashtag code (the part after
  `#`) to the clipboard instead of opening it.

Base: the current plugin state (v1.4.4 + the four-feature local patch,
commit `c2cf091`), treated as upstream.

## The change

Three files, one behaviour:

1. `Service.qml` -- `lnkrApiDir` / `lnkrSweepHome` / `lnkrEncode` / `lnkrOpen`
   plus a `lnkrWarning` string surfaced on the bar. The sweep runs **when the
   settings toggle is flipped** (`applySettingNow`): a depth-3 `find ~` for
   the literal `linkoder` folder (must contain `api.js`), the hit persisted
   as `lnkrApiPath`. From then on `lnkrApiDir` only reads the persisted
   setting -- button clicks never re-sweep, and a missing folder therefore
   never throws at click time; the warning is set once, at flip time.
2. `components/Browser.qml`
   - `contextActions`: files only, when the `lnkr` setting is on, a
     `{ key: "lnkr", kind: "lnkr" }` item directly under *Open in editor*.
   - the context-menu delegate renders the row for `kind === "lnkr"` as a
     literal text line -- `Ln.Kr (Rich) | Ln.Kr (Safe) | #share` -- each
     label an independent clickable hot region (caption size, its own hover
     highlight, `|` separators dimmed). The row takes the normal 24 px item
     height and suppresses the separator line.
   - `runLnkr(mode, copyOnly)`: encodes the `menuEntry` path, then either
     copies the hashtag (after `#`) via `service.copyToClipboardText`
     (shift-click) or opens the URL with `service.lnkrOpen`.
   - the bar's right-hand warning text now also shows `lnkrWarning`.
   - `browsingRows()`: new toggle "Ln.Kr previewer links" (off by default);
     `applySettingNow` runs `lnkrSweepHome()` when it is turned on.
3. `tests/MockService.qml` -- the four functions + `lnkrWarning` recorded, so
   the flow tests keep loading the scene.

## Notes

- The menu width is the fixed 230 px (`menuWidth`); the literal row is
  caption-size and fits with margin to spare.
- `Quickshell.execute` blocks the QML thread for the duration of the encode;
  v1 compression is fast for normal documents. Huge files (many MB of
  markdown) will make the click feel brief-to-noticeable. The #share path for
  archives does more work (decompression + combining) and can take longer.
- The sweep matches the literal folder name `linkoder` (depth <= 3 from
  `$HOME`, e.g. `~/Documents/Dev/linkoder`) and requires `api.js` inside it;
  the first hit wins. It runs only at toggle-flip time; a later move of the
  folder needs the `lnkrApiPath` setting cleared (or the toggle flipped
  again) to re-run the sweep.
- The `lnkr` row is hidden for directories and when the setting is off -- the
  menu is byte-identical to upstream for everyone who leaves it off.

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
- The sweep command (`find ~ -maxdepth 3 -type d -name linkoder`) was
  exercised directly and returns `~/Documents/Dev/linkoder` at depth 3.
- The linkoder API behind the row was exercised end-to-end: markdown, html,
  pdf, mp3, mp4, png and zip inputs all print well-formed URLs, and the
  payloads decode back through the `ln.kr` / `mk.it` decoders to the
  original content (md carries the ephemeral `style=jekyll` + newline;
  archives decode to `combined.md`).

## Open questions

- Nothing blocking. Possible follow-ups: keyboard hints for the row, a
  per-folder "prefer #share" preference, and wiring the sweep to also accept a
  user-set path (text setting) if the folder ever leaves the depth-3 cone.

<details>
<summary>Patch (omafile-local.patch, git diff against the current state)</summary>

```diff
diff --git c/Service.qml w/Service.qml
index d717c98..e007162 100644
--- c/Service.qml
+++ w/Service.qml
@@ -1300,6 +1300,62 @@ Item {
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
+  // then on (button clicks never re-sweep).
+  function lnkrSweepHome() {
+    var out = ""
+    try {
+      out = String(Quickshell.execute(["sh", "-c",
+        "find ~ -maxdepth 3 -type d -name linkoder 2>/dev/null | head -5"]) || "")
+    } catch (e) { out = "" }
+    var lines = out.split("\n")
+    for (var i = 0; i < lines.length; i++) {
+      var dir = String(lines[i]).trim()
+      if (!dir) continue
+      var ok = ""
+      try {
+        ok = String(Quickshell.execute(["sh", "-c", "test -f \"$1/api.js\" && echo ok", "omafile", dir]) || "")
+      } catch (e) { ok = "" }
+      if (ok.indexOf("ok") >= 0) {
+        updateSetting("lnkrApiPath", dir)
+        lnkrWarning = ""
+        return dir
+      }
+    }
+    lnkrWarning = "Ln.Kr: the linkoder API folder was not found under your home directory"
+    return ""
+  }
+
+  function lnkrEncode(path, mode) {
+    var dir = lnkrApiDir()
+    if (!dir) return ""
+    var out = ""
+    try {
+      out = String(Quickshell.execute(["sh", "-c", "bun \"$1/api.js\" \"$2\" --$3 2>/dev/null",
+        "omafile", dir, path, mode]) || "")
+    } catch (e) { out = "" }
+    var url = out.trim().split("\n").pop()
+    if (!/^https:\/\//.test(url)) {
+      lnkrWarning = "Ln.Kr: the linkoder API did not return a link"
+      return ""
+    }
+    lnkrWarning = ""
+    return url
+  }
+
+  function lnkrOpen(url) {
+    Quickshell.execDetached(["omarchy", "launch", "or", "focus", "webapp", "lnkr", url])
+  }
+
   function mountDrive(devicePath, onDone, onError) {
     return request({ op: "mountdev", device: String(devicePath) }, {
       onDone: function (m) {
diff --git c/components/Browser.qml w/components/Browser.qml
index 2a66b2f..67031b3 100644
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
@@ -1525,6 +1527,19 @@ Item {
       showDialog("settings", "Settings", "", null)
     }
     else if (key === "shortcuts") showDialog("shortcuts", "Keyboard shortcuts", "", null)
+    else if (key.indexOf("lnkr:") === 0) runLnkr(key.substring(5), false)
+  }
+  function runLnkr(mode, copyOnly) {
+    var entry = menuEntry
+    if (!entry || !service) return
+    var url = service.lnkrEncode(entry.path, mode)
+    if (!url) return
+    if (copyOnly) {
+      var hash = url.indexOf("#") >= 0 ? url.slice(url.indexOf("#") + 1) : url
+      service.copyToClipboardText(hash)
+      return
+    }
+    service.lnkrOpen(url)
   }
   function runZoom(action) {
     if (action === "in") nudgeViewScale(0.1)
@@ -2829,7 +2844,7 @@ Item {
           anchors.rightMargin: Style.space(10)
           anchors.verticalCenter: parent.verticalCenter
           visible: text !== ""
-          text: root.service ? (root.service.bookmarksError || root.service.helperError || "") : ""
+          text: root.service ? (root.service.bookmarksError || root.service.helperError || root.service.lnkrWarning || "") : ""
           color: Color.urgent
           font.family: Style.font.family
           font.pixelSize: Style.font.caption
@@ -2890,17 +2905,18 @@ Item {
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
 
@@ -3017,6 +3033,55 @@ Item {
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
+                  { mode: "rich", label: "Ln.Kr (Rich)" },
+                  { mode: "safe", label: "Ln.Kr (Safe)" },
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
@@ -4405,7 +4470,9 @@ Item {
       { key: "rememberFolderViews", label: "Remember the view for each folder",
         description: "A folder opens in the view you last picked there. Other folders open in the default view" },
       { key: "extractOnOpen", label: "Extract archives when opened", fallback: false,
-        description: "Double click or Enter extracts zip, tar, 7z and rar files next to themselves instead of opening them in your default app" }
+        description: "Double click or Enter extracts zip, tar, 7z and rar files next to themselves instead of opening them in your default app" },
+      { key: "lnkr", label: "Ln.Kr previewer links", fallback: false,
+        description: "Show the Ln.Kr (Rich) | Ln.Kr (Safe) | Make row in the right-click menu; links open in a Helium webapp window. On first enable, omafile looks for the linkoder folder under your home directory" }
     ]
   }
 
@@ -4445,6 +4512,8 @@ Item {
     } else if (key === "thumbnails") {
       paneA.thumbnails = value
       if (split) paneB.thumbnails = value
+    } else if (key === "lnkr") {
+      if (value === true) service.lnkrSweepHome()
     }
     rememberSession()
   }
diff --git c/tests/MockService.qml w/tests/MockService.qml
index 6d0dcfb..651c45b 100644
--- c/tests/MockService.qml
+++ w/tests/MockService.qml
@@ -152,6 +152,11 @@ QtObject {
   }
   function disconnectServer(path, onDone, onError) { record("disconnectServer", [path]) }
   function copyToClipboardText(text) { record("copyToClipboardText", [text]) }
+  property string lnkrWarning: ""
+  function lnkrApiDir() { record("lnkrApiDir", []); return "" }
+  function lnkrSweepHome() { record("lnkrSweepHome", []); return "" }
+  function lnkrEncode(path, mode) { record("lnkrEncode", [path, mode]); return "" }
+  function lnkrOpen(url) { record("lnkrOpen", [url]) }
   function emptyTrash(onDone) { record("emptyTrash", []); trashCount = 0; if (onDone) onDone({}) }
   function peekFile(path, limit, onDone, onError) { record("peekFile", [path]); onDone({ text: "key: value\n", binary: false, truncated: false }) }
   function openWith(command, path, inTerminal) { record("openWith", [command, path, inTerminal]) }
```

</details>

<details>
<summary>linkoder API (the encoder behind the row) -- outline</summary>

`~/Documents/Dev/linkoder/api.js` (bun, ESM). Lateral imports, nothing
reinvented:

- `../ln.kr/docs/text-compress.js` -- `compressTextV1` (v1 document payloads)
- `../ln.kr/docs/compress.js` -- `compress` (URL-target payloads for the
  `#pdf:` / `#media:` render types)
- `../ln.kr/docs/alphabets.js` -- `outputAlphabetASCII`
- `../ln.kr/docs/viewer-runtime.js` -- `executablePrefixForKind` (`m:`, `h:`,
  `r:` rich markers)
- `../ln.kr/docs/link-runtime.js` -- `mediaLinkKind` (image/video/audio/pdf
  by extension)
- `../mk.it/src/tools/share.ts` -- `encodeSharedFile` / `fileMime` (MKIT/1
  envelope, always `app.shel.sh/make/#share:`)
- `../mk.it/src/tools/archiveCombine.ts` -- `combineArchive` (zip/tar/7z ->
  combined markdown, ephemerally)

Mapping (file with an existing extension in, one previewer URL out):

| Input | Output |
|---|---|
| `.md` | `a.shel.sh/#<v1>` (ephemerally `style=jekyll` + newline); `--rich` -> `#m:` |
| `.html` | `a.shel.sh/#<v1>`; `--rich` -> `#h:` |
| `.js` / text/code | `a.shel.sh/#<v1>`; `--rich` -> `#r:` (js) |
| `.pdf` | `a.shel.sh/#pdf:<v1 of the Make share URL>` |
| audio | `a.shel.sh/#media:<v1 of the Make share URL>` |
| video, images | `app.shel.sh/make/#share:<MKIT/1>` |
| `.zip` / `.tar` / `.7z` | `app.shel.sh/make/#share:` (combined markdown, `combined.md`) |

`.env` (resolved from `.env-example` on first run) carries one setting:
`WORKERS` (concurrent encodes, CPU-based).

</details>
