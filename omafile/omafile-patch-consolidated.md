# [Proposal]: Transcode op, HD image previews with pan/zoom, multi-file open, double-open guard

> Filing at: https://github.com/chr0nzz/omarchy-omafile -- one consolidated commit on v1.4.4
> Base: `chr0nzz/omarchy-omafile` v1.4.4 (`a938874`), commit `c2cf091`, 5 files changed, 398 insertions(+), 16 deletions(-).
> Package: `omafile-local.patch` (the single patch file) + `apply.sh` (apply/revert) + `README.md` (overview) + this doc.

## Context

- omafile v1.4.4 (Omarchy shell plugin), Hyprland.
- Four independent asks, one clean commit: a media transcode entry, full-resolution
  image previews (with zoom/pan), whole-selection open for the app/editor menus, and a
  fix for Enter double-opening right after "Open with".

## The change

| File | Change |
| --- | --- |
| `Model.js` | Transcodable extension sets, `isTranscodable`/`transcodeMediaType`, `expandFieldCodesMulti` (`%f` -> every selected path). |
| `Service.qml` | `transcodePaths`; multi-path `openWithFiles` / `runCommandOnFiles` / `openEditorFiles`; single-invocation `openExternallyFiles` (`gio open p1 p2 ...`). |
| `components/Browser.qml` | *Transcode...* menu + dialog; multi-open dispatch; post-launch key guard; `fullResPreview` setting; native-size preview image with wheel-zoom / drag-pan / double-click reset. |
| `components/TransferBar.qml` | `transcode` transfer row. |
| `bin/omafile-helper` | `transcode` op (cancellable; per-file `omarchy-transcode`; progress + `outputs`). |

## Notes

- **Double-open fix:** after "Open with", a stray Enter re-opened the file; the launcher timestamps launches (`lastLaunchMs`, 600 ms window, same pattern as `conflictKeyDelay`) and the pane swallows Return/Enter/Space inside that window.
- **HD image previews:** `fullResPreview` setting (default off) renders the original file at native size in the preview panel; the 64 MB preview cap still applies. The placeholder cog tracks the full-res image's load status (no faded "Making a preview" cog). Scrolling over the preview zooms (1x-8x, anchored at the cursor) and left-drag pans; double-click resets, like the image viewer. Only wheel and drag pass through to the preview; keyboard arrows keep their existing role.
- **Multi-file open:** *Open* / *Open with* / *Open in editor* act on the whole selection; `Model.expandFieldCodesMulti` expands `%f`-style codes to every path. The system-default *Open* path for a multi-selection runs one `gio open p1 p2 ...` (`Service.openExternallyFiles`, `Browser.openEntries`) so the viewer gets the collection in one window.
- **Transcode:** context-menu entry above *Compress...* for pictures/videos -> Format + Resolution dialog -> `transcode` helper op (cancellable; runs the trusted `omarchy-transcode` per file via `bash -c`, because its `wl-copy` step forks a daemon that would hold the helper's pipes) -> TransferBar entry -> pane refresh with the first output selected.

<details>
<summary>Patch -- `omafile-local.patch` (full diff, linenum = post-patch target file)</summary>

### `Model.js` (+71/-0)

```diff

@@ -718,6 +718,63 @@ function expandFieldCodes(command, path) {
   718:   return out;
   719: }
   720: 
   721: +function expandFieldCodesMulti(command, paths) {
   722: +  var list = paths && paths.length ? paths : [undefined];
   723: +  var out = [];
   724: +  var used = false;
   725: +  var length = command && command.length ? command.length : 0;
   726: +  for (var i = 0; i < length; i++) {
   727: +    var arg = String(command[i]);
   728: +    var inScript = isShellScriptArg(command, i);
   729: +    var prefix = '';
   730: +    var suffix = '';
   731: +    var sawCode = false;
   732: +    for (var j = 0; j < arg.length; j++) {
   733: +      var ch = arg.charAt(j);
   734: +      if (ch !== '%') {
   735: +        if (sawCode) suffix += ch; else prefix += ch;
   736: +        continue;
   737: +      }
   738: +      var code = arg.charAt(j + 1);
   739: +      if (code === '') {
   740: +        if (sawCode) suffix += '%'; else prefix += '%';
   741: +        continue;
   742: +      }
   743: +      j++;
   744: +      if (code === '%') {
   745: +        if (sawCode) suffix += '%'; else prefix += '%';
   746: +        continue;
   747: +      }
   748: +      if (code === 'f' || code === 'F' || code === 'u' || code === 'U') {
   749: +        sawCode = true;
   750: +        used = true;
   751: +      }
   752: +    }
   753: +    if (sawCode) {
   754: +      var parts = [];
   755: +      for (var m = 0; m < list.length; m++)
   756: +        parts.push(list[m] === undefined || list[m] === null ? '' : String(list[m]));
   757: +      if (inScript) {
   758: +        var quoted = [];
   759: +        for (var q = 0; q < parts.length; q++) quoted.push(shellQuote(parts[q]));
   760: +        out.push(prefix + quoted.join(' ') + suffix);
   761: +      } else {
   762: +        if (prefix !== '') out.push(prefix);
   763: +        for (var p = 0; p < parts.length; p++) out.push(parts[p]);
   764: +        if (suffix !== '') out.push(suffix);
   765: +      }
   766: +    } else if (prefix !== '') {
   767: +      out.push(prefix);
   768: +    }
   769: +  }
   770: +  if (out.length === 0) return [];
   771: +  if (!used) {
   772: +    for (var n = 0; n < list.length; n++)
   773: +      out.push(list[n] === undefined || list[n] === null ? '' : String(list[n]));
   774: +  }
   775: +  return out;
   776: +}
   777: +
   778: function tokenizeCommand(text) {
   779:   var source = text === undefined || text === null ? '' : String(text);
   780:   var out = [];
@@ -950,6 +1007,20 @@ function previewKind(entry) {
  1007:   return 'text';
  1008: }
  1009: 
  1010: +var transcodePictureExts = toSet(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif']);
  1011: +var transcodeVideoExts = toSet(['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi']);
  1012: +
  1013: +function isTranscodable(entry) {
  1014: +  if (!entry || entry.isDir) return false;
  1015: +  var ext = String(entry.ext || '').toLowerCase();
  1016: +  return !!transcodePictureExts[ext] || !!transcodeVideoExts[ext];
  1017: +}
  1018: +
  1019: +function transcodeMediaType(entry) {
  1020: +  var ext = String((entry && entry.ext) || '').toLowerCase();
  1021: +  return transcodeVideoExts[ext] ? 'video' : 'picture';
  1022: +}
  1023: +
  1024: function outputVolume(sliderValue) {
  1025:   var v = Number(sliderValue) || 0;
  1026:   if (v <= 0) return 0;
```

### `Service.qml` (+51/-4)

```diff

@@ -1170,6 +1170,37 @@ Item {
  1170:     return id
  1171:   }
  1172: 
  1173: +  function transcodePaths(paths, format, resolution, onDone, onError) {
  1174: +    var folder = Model.dirname(paths[0])
  1175: +    var record = {
  1176: +      id: 0, op: "transcode", label: resolution + " " + format, dest: folder, state: "running",
  1177: +      bytes: 0, total: 0, files: 0, filesTotal: paths.length, current: "", rate: 0,
  1178: +      errors: [], startedMs: Date.now(), finishedMs: 0, count: paths.length, from: folder
  1179: +    }
  1180: +    var id = request({ op: "transcode", paths: paths, format: format, resolution: resolution }, {
  1181: +      onData: function (m) {
  1182: +        if (m.t === "progress") updateTransfer(m.id, {
  1183: +          files: Number(m.files) || 0, current: String(m.current || "")
  1184: +        })
  1185: +      },
  1186: +      onDone: function (m) {
  1187: +        updateTransfer(m.id, { state: "done", result: String((m.outputs && m.outputs[0]) || "") })
  1188: +        trimTransferHistory()
  1189: +        if (onDone) onDone(m)
  1190: +      },
  1191: +      onError: function (m) {
  1192: +        updateTransfer(m.id, { state: m.code === "ECANCELED" ? "cancelled" : "failed", message: String(m.message || "") })
  1193: +        trimTransferHistory()
  1194: +        if (onError) onError(m)
  1195: +      }
  1196: +    })
  1197: +    record.id = id
  1198: +    var next = transfers.slice()
  1199: +    next.push(record)
  1200: +    transfers = next
  1201: +    return id
  1202: +  }
  1203: +
  1204:   function extractArchive(path, onDone, onError) {
  1205:     var folder = Model.dirname(path)
  1206:     var record = {
@@ -1206,8 +1237,18 @@ Item {
  1237:     Quickshell.execDetached(["gio", "open", path])
  1238:   }
  1239: 
  1209: -  function openWith(command, path, inTerminal) {
  1210: -    var argv = Model.expandFieldCodes(command, path)
  1240: +  function openExternallyFiles(paths) {
  1241: +    var list = [];
  1242: +    for (var i = 0; i < paths.length; i++)
  1243: +      if (paths[i]) list.push(String(paths[i]));
  1244: +    if (list.length === 0) return;
  1245: +    var argv = ["gio", "open"];
  1246: +    for (var j = 0; j < list.length; j++) argv.push(list[j]);
  1247: +    Quickshell.execDetached(argv)
  1248: +  }
  1249: +
  1250: +  function openWithFiles(command, paths, inTerminal) {
  1251: +    var argv = Model.expandFieldCodesMulti(command, paths)
  1252:     if (argv.length === 0) return
  1253:     if (inTerminal) argv = ["xdg-terminal-exec"].concat(argv)
  1254:     Quickshell.execDetached(argv)
@@ -1224,10 +1265,10 @@ Item {
  1265:     })
  1266:   }
  1267: 
  1227: -  function runCommandOn(text, path) {
  1268: +  function runCommandOnFiles(text, paths) {
  1269:     var argv = Model.tokenizeCommand(text)
  1270:     if (argv.length === 0) return false
  1230: -    argv.push(String(path))
  1271: +    for (var i = 0; i < paths.length; i++) argv.push(String(paths[i]))
  1272:     Quickshell.execDetached(argv)
  1273:     return true
  1274:   }
@@ -1249,6 +1290,12 @@ Item {
  1290:     else Quickshell.execDetached(["omarchy-launch-editor", path])
  1291:   }
  1292: 
  1293: +  function openEditorFiles(paths) {
  1294: +    var configured = String(settingNow("editor", "") || "").trim()
  1295: +    if (configured) Quickshell.execDetached(["sh", "-c", configured + " \"$@\"", "omafile"].concat(paths))
  1296: +    else Quickshell.execDetached(["omarchy-launch-editor"].concat(paths))
  1297: +  }
  1298: +
  1299:   function copyToClipboardText(text) {
  1300:     Quickshell.execDetached(["sh", "-c", "printf %s \"$1\" | wl-copy", "omafile", String(text)])
  1301:   }
```

### `bin/omafile-helper` (+64/-0)

```diff

@@ -4299,6 +4299,69 @@ def op_compress(req, cancel_event):
  4299:             except OSError:
  4300:                 pass
  4301:         os.close(pfd)
  4302: +TRANSCODE_FORMATS = ("jpg", "png", "mp4", "gif")
  4303: +TRANSCODE_RESOLUTIONS = ("high", "medium", "low", "4k", "1080p", "720p")
  4304: +
  4305: +
  4306: +def op_transcode(req, cancel_event):
  4307: +    req_id = req["id"]
  4308: +    paths = req.get("paths")
  4309: +    fmt = req.get("format")
  4310: +    res = req.get("resolution")
  4311: +    if (not isinstance(paths, list) or not paths
  4312: +            or not all(isinstance(p, str) and os.path.isabs(p) for p in paths)
  4313: +            or fmt not in TRANSCODE_FORMATS or res not in TRANSCODE_RESOLUTIONS):
  4314: +        send_error(req_id, "EINVAL",
  4315: +                   "absolute paths, a format (jpg, png, mp4, gif) and a resolution "
  4316: +                   "(high, medium, low, 4k, 1080p, 720p) are required")
  4317: +        return
  4318: +    try:
  4319: +        trusted_program("omarchy-transcode")
  4320: +    except FileNotFoundError:
  4321: +        send_error(req_id, "EUNSUPPORTED", "omarchy-transcode is not installed")
  4322: +        return
  4323: +    outputs = []
  4324: +    for index, raw in enumerate(paths):
  4325: +        if cancel_event is not None and cancel_event.is_set():
  4326: +            send_error(req_id, "ECANCELED", "cancelled")
  4327: +            return
  4328: +        path = os.path.normpath(raw)
  4329: +        if not os.path.isfile(path):
  4330: +            send_error(req_id, "ENOENT", "no such file", path)
  4331: +            return
  4332: +        emit({"id": req_id, "t": "progress", "files": index, "filesTotal": len(paths),
  4333: +              "current": os.path.basename(path)})
  4334: +        # The CLI copies its result to the clipboard, which forks a persistent
  4335: +        # wl-copy daemon. Running it directly would leave the daemon holding
  4336: +        # this helper's stdout/stderr pipes open, so run it through bash with
  4337: +        # its stdio redirected to a temp file; the daemon inherits the file
  4338: +        # descriptors, not the pipes.
  4339: +        errfd, errfile = tempfile.mkstemp(prefix=".omafile-transcode-")
  4340: +        os.close(errfd)
  4341: +        try:
  4342: +            proc = run_trusted("bash", ["-c",
  4343: +                "exec omarchy-transcode \"$1\" \"$2\" \"$3\" >\"$4\" 2>&1",
  4344: +                "omafile-transcode", path, fmt, res, errfile], timeout=600)
  4345: +            message = ""
  4346: +            try:
  4347: +                with open(errfile, "r", encoding="utf-8", errors="replace") as fh:
  4348: +                    message = fh.read().strip()
  4349: +            except OSError:
  4350: +                pass
  4351: +        finally:
  4352: +            try:
  4353: +                os.unlink(errfile)
  4354: +            except OSError:
  4355: +                pass
  4356: +        if cancel_event is not None and cancel_event.is_set():
  4357: +            send_error(req_id, "ECANCELED", "cancelled")
  4358: +            return
  4359: +        if proc.returncode != 0:
  4360: +            send_error(req_id, "ETRANSCODE", message or "transcode failed", path)
  4361: +            return
  4362: +        stem = os.path.splitext(os.path.basename(path))[0]
  4363: +        outputs.append(os.path.join(os.path.dirname(path), stem + "-" + res + "." + fmt))
  4364: +    send_done(req_id, outputs=outputs)
  4365: 
  4366: 
  4367: CANCELLABLE_OPS = {
@@ -4319,6 +4382,7 @@ CANCELLABLE_OPS = {
  4382:     "counts": op_counts,
  4383:     "extract": op_extract,
  4384:     "compress": op_compress,
  4385: +    "transcode": op_transcode,
  4386: }
  4387: 
  4388: SIMPLE_OPS = {
```

### `components/Browser.qml` (+207/-12)

```diff

@@ -376,7 +376,7 @@ Item {
   376:   property int pickFilter: -1
   377:   readonly property var pickBlockedActions: ({
   378:     cut: true, paste: true, rename: true, trash: true, delete: true, restore: true, emptytrash: true,
   379: -    extract: true, compress: true, properties: true, newfile: true, terminal: true, agent: true,
   379: +    extract: true, compress: true, transcode: true, properties: true, newfile: true, terminal: true, agent: true,
   380:     openwith: true, editor: true, undo: true, redo: true, drop: true, transfer: true,
   381:     "place:emptytrash": true, "place:properties": true
   382:   })
@@ -711,6 +711,12 @@ Item {
   711:       if (place && place.path) service.renameBookmark(place.path, value)
   712:       return
   713:     }
   714: +    if (dialogMode === "transcode") {
   715: +      var payload = dialogPayload
   716: +      closeDialog()
   717: +      if (payload && payload.targets) transcodeNow(payload.targets)
   718: +      return
   719: +    }
   720:     if (!value) {
   721:       dialogError = "Name cannot be empty"
   722:       return
@@ -1031,6 +1037,10 @@ Item {
  1037:   }
  1038: 
  1039:   property string compressFormat: ".zip"
  1040: +  property string transcodeFormat: ""
  1041: +  property string transcodeResolution: ""
  1042: +  property var transcodeFormats: []
  1043: +  property var transcodeResolutions: []
  1044: 
  1045:   function compressTargets(entry) {
  1046:     var p = activePane()
@@ -1073,6 +1083,62 @@ Item {
  1083:     })
  1084:   }
  1085: 
  1086: +  function openWithTargets(entry) {
  1087: +    var p = activePane()
  1088: +    if (!entry) return []
  1089: +    if (!p) return [entry]
  1090: +    var sel = p.selectedEntries
  1091: +    for (var i = 0; i < sel.length; i++) if (sel[i].path === entry.path) return sel
  1092: +    return [entry]
  1093: +  }
  1094: +
  1095: +  function transcodeTargets(entry) {
  1096: +    var list = openWithTargets(entry)
  1097: +    var out = []
  1098: +    for (var i = 0; i < list.length; i++)
  1099: +      if (Model.isTranscodable(list[i])) out.push(list[i])
  1100: +    return out
  1101: +  }
  1102: +
  1103: +  function askTranscode(entry) {
  1104: +    if (!pickAllows("transcode")) return
  1105: +    var targets = transcodeTargets(entry)
  1106: +    if (targets.length === 0) return
  1107: +    if (Model.transcodeMediaType(targets[0]) === "video") {
  1108: +      transcodeFormats = [{ label: "MP4, plays anywhere", value: "mp4" }, { label: "GIF, for chat and docs", value: "gif" }]
  1109: +      transcodeResolutions = [{ label: "4K", value: "4k" }, { label: "1080p", value: "1080p" }, { label: "720p", value: "720p" }]
  1110: +      transcodeFormat = "mp4"
  1111: +      transcodeResolution = "1080p"
  1112: +    } else {
  1113: +      transcodeFormats = [{ label: "JPG, smaller", value: "jpg" }, { label: "PNG, lossless", value: "png" }]
  1114: +      transcodeResolutions = [{ label: "High", value: "high" }, { label: "Medium", value: "medium" }, { label: "Low", value: "low" }]
  1115: +      transcodeFormat = "jpg"
  1116: +      transcodeResolution = "medium"
  1117: +    }
  1118: +    showDialog("transcode", "Transcode " + (targets.length === 1 ? targets[0].name : Model.formatCount(targets.length, "item", "items")),
  1119: +      "", { targets: targets })
  1120: +  }
  1121: +
  1122: +  function transcodeNow(targets) {
  1123: +    var p = activePane()
  1124: +    var paths = []
  1125: +    for (var i = 0; i < targets.length; i++) paths.push(targets[i].path)
  1126: +    statusText = "Transcoding " + Model.formatCount(targets.length, "item", "items")
  1127: +    service.transcodePaths(paths, transcodeFormat, transcodeResolution, function (m) {
  1128: +      var outputs = m.outputs || []
  1129: +      root.statusText = "Transcoded " + Model.formatCount(outputs.length, "file", "files")
  1130: +      p.refresh()
  1131: +      if (outputs.length === 1) {
  1132: +        selectTimer.pendingName = Model.basename(String(outputs[0]))
  1133: +        selectTimer.pendingPane = p
  1134: +        selectTimer.restart()
  1135: +      }
  1136: +    }, function (m) {
  1137: +      root.statusText = m && m.code === "ECANCELED" ? "Transcoding cancelled"
  1138: +        : "Could not transcode: " + String((m && m.message) || "")
  1139: +    })
  1140: +  }
  1141: +
  1142:   function afterLaunch() {
  1143:     if (popupMode) requestClose()
  1144:   }
@@ -1110,6 +1176,8 @@ Item {
  1176:       items.push({ key: "rename", label: "Rename", glyph: Icons.actionGlyph("rename"), hint: "F2" })
  1177:       if (archiveTargets(entry).length > 0)
  1178:         items.push({ key: "extract", label: "Extract here", glyph: Icons.actionGlyph("extract") })
  1179: +      if (transcodeTargets(entry).length > 0)
  1180: +        items.push({ key: "transcode", label: "Transcode\u2026", glyph: Icons.actionGlyph("extract") })
  1181:       if (compressTargets(entry).length > 0)
  1182:         items.push({ key: "compress", label: "Compress\u2026", glyph: Icons.actionGlyph("extract") })
  1183:       if (entry.isDir) {
@@ -1412,9 +1480,24 @@ Item {
  1480:     if (key.indexOf("sort:") === 0) applySortPreset(key.substring(5))
  1481:     else if (key.indexOf("view:") === 0) setView(key.substring(5))
  1482:     else if (key === "preview") showPreview(entry)
  1415: -    else if (key === "open") p.openEntry(entry)
  1416: -    else if (key === "openwith") showDialog("openwith", "Open " + (entry ? entry.name : "") + " with", "", entry)
  1417: -    else if (key === "editor") { service.openEditor(entry ? entry.path : p.path); afterLaunch() }
  1483: +    else if (key === "open") {
  1484: +      var ot = entry ? openWithTargets(entry) : null
  1485: +      if (ot && ot.length > 1) openEntries(ot)
  1486: +      else p.openEntry(entry)
  1487: +    }
  1488: +    else if (key === "openwith") {
  1489: +      var owt = entry ? openWithTargets(entry) : [entry]
  1490: +      showDialog("openwith", "Open " + (owt.length > 1 ? Model.formatCount(owt.length, "item", "items") : (entry ? entry.name : "")) + " with", "", entry)
  1491: +    }
  1492: +    else if (key === "editor") {
  1493: +      var et = entry ? openWithTargets(entry) : null
  1494: +      if (et && et.length > 1 && !et[0].isDir) {
  1495: +        var epaths = []
  1496: +        for (var i = 0; i < et.length; i++) epaths.push(et[i].path)
  1497: +        service.openEditorFiles(epaths)
  1498: +      } else service.openEditor(entry ? entry.path : p.path)
  1499: +      afterLaunch()
  1500: +    }
  1501:     else if (key === "opentab") newTab(activeSide, entry.path)
  1502:     else if (key === "copy") doCopy()
  1503:     else if (key === "cut") doCut()
@@ -1426,6 +1509,7 @@ Item {
  1509:     else if (key === "emptytrash") askEmptyTrash()
  1510:     else if (key === "copypath") service.copyToClipboardText(entry ? entry.path : p.path)
  1511:     else if (key === "extract") extractArchives(archiveTargets(entry))
  1512: +    else if (key === "transcode") askTranscode(entry)
  1513:     else if (key === "compress") askCompress(entry)
  1514:     else if (key === "properties") showProperties(entry)
  1515:     else if (key === "newfolder") showDialog("newfolder", "New folder", "untitled folder", null)
@@ -1449,6 +1533,14 @@ Item {
  1533:   }
  1534:   property bool previewOpen: false
  1535:   property var previewEntry: null
  1536: +  property real previewZoom: 1
  1537: +  property real previewPanX: 0
  1538: +  property real previewPanY: 0
  1539: +  function onPreviewEntryChanged() {
  1540: +    previewZoom = 1
  1541: +    previewPanX = 0
  1542: +    previewPanY = 0
  1543: +  }
  1544:   property string previewText: ""
  1545:   property bool previewBinary: false
  1546:   property bool previewTruncated: false
@@ -1469,6 +1561,8 @@ Item {
  1561:     return kind
  1562:   }
  1563: 
  1564: +  readonly property bool fullResPreview: boolSetting("fullResPreview", false)
  1565: +
  1566:   function showPreview(entry) {
  1567:     if (!entry) return
  1568:     var token = ++previewToken
@@ -1811,13 +1905,15 @@ Item {
  1905:   function openEntries(sel) {
  1906:     var dirs = []
  1907:     var archives = []
  1908: +    var files = []
  1909:     for (var i = 0; i < sel.length; i++) {
  1910:       if (sel[i].isDir && !sel[i].isBroken) dirs.push(sel[i].path)
  1911:       else if (extractsOnOpen(sel[i])) archives.push(sel[i])
  1817: -      else if (service) service.openExternally(sel[i].path)
  1912: +      else files.push(sel[i].path)
  1913:     }
  1914:     for (var d = 0; d < dirs.length; d++) newTab(activeSide, dirs[d])
  1915:     extractArchives(archives)
  1916: +    if (files.length && service) service.openExternallyFiles(files)
  1917:     if (archives.length < sel.length) afterLaunch()
  1918:   }
  1919: 
@@ -1922,7 +2018,11 @@ Item {
  2018:     var typed = appFilter
  2019:     closeDialog()
  2020:     if (!entry || !service) return
  1925: -    service.runCommandOn(typed, entry.path)
  2021: +    var targets = openWithTargets(entry)
  2022: +    var tpaths = []
  2023: +    for (var i = 0; i < targets.length; i++) tpaths.push(targets[i].path)
  2024: +    lastLaunchMs = Date.now()
  2025: +    service.runCommandOnFiles(typed, tpaths)
  2026:     afterLaunch()
  2027:   }
  2028: 
@@ -1943,7 +2043,11 @@ Item {
  2043:     var entry = dialogPayload
  2044:     closeDialog()
  2045:     if (!entry || !service) return
  1946: -    service.openWith(command, entry.path, inTerminal)
  2046: +    var targets = openWithTargets(entry)
  2047: +    var tpaths = []
  2048: +    for (var i = 0; i < targets.length; i++) tpaths.push(targets[i].path)
  2049: +    lastLaunchMs = Date.now()
  2050: +    service.openWithFiles(command, tpaths, inTerminal)
  2051:     if (appAlways && app.id && !entry.isDir)
  2052:       service.setDefaultApp(entry.path, String(app.id), null, function (m) {
  2053:         root.statusText = "Could not set the default app: " + String((m && m.message) || "")
@@ -1979,6 +2083,9 @@ Item {
  2083:       if (event.key === Qt.Key_Up) { moveAppCursor(-1); return true }
  2084:       if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { chooseApp(); return true }
  2085:     }
  2086: +    if (dialogMode === "transcode") {
  2087: +      if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { submitDialog(); return true }
  2088: +    }
  2089:     if (dialogMode === "settings" || dialogMode === "shortcuts" || dialogMode === "properties") {
  2090:       if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { closeDialog(); return true }
  2091:     }
@@ -2038,6 +2145,10 @@ Item {
  2145:     var shiftKey = (event.modifiers & Qt.ShiftModifier) !== 0
  2146:     var alt = (event.modifiers & Qt.AltModifier) !== 0
  2147: 
  2148: +    if (Date.now() - lastLaunchMs < launchKeyDelay
  2149: +        && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space))
  2150: +      return true
  2151: +
  2152:     if (event.key === Qt.Key_Escape) {
  2153:       if (p.searching || findMode) { exitFind(); return true }
  2154:       if (p.filter !== "" || pathBar.filterOpen) { pathBar.closeFilter(); return true }
@@ -2934,7 +3045,49 @@ Item {
  3045:         border.color: Color.popups.border
  3046:         radius: Style.cornerRadius
  3047: 
  2937: -        MouseArea { anchors.fill: parent }
  3048: +        MouseArea {
  3049: +          anchors.fill: parent
  3050: +          hoverEnabled: true
  3051: +          cursorShape: pressed ? Qt.SizeAllCursor : Qt.ArrowCursor
  3052: +          property real dragStartX: 0
  3053: +          property real dragStartY: 0
  3054: +          onPressed: function (mouse) {
  3055: +            if (mouse.button !== Qt.LeftButton || !previewFullImage.visible) return
  3056: +            dragStartX = mouse.x
  3057: +            dragStartY = mouse.y
  3058: +          }
  3059: +          onPositionChanged: function (mouse) {
  3060: +            if (!pressed || !previewFullImage.visible) return
  3061: +            root.previewPanX += mouse.x - dragStartX
  3062: +            root.previewPanY += mouse.y - dragStartY
  3063: +            dragStartX = mouse.x
  3064: +            dragStartY = mouse.y
  3065: +          }
  3066: +          onWheel: function (wheel) {
  3067: +            if (!previewFullImage.visible) return
  3068: +            var nz = root.previewZoom * (wheel.angleDelta.y > 0 ? 1.25 : 0.8)
  3069: +            nz = Math.max(1, Math.min(8, nz))
  3070: +            if (nz === root.previewZoom) return
  3071: +            var nx, ny
  3072: +            if (nz <= 1.0001) {
  3073: +              nz = 1
  3074: +              nx = 0
  3075: +              ny = 0
  3076: +            } else {
  3077: +              nx = wheel.x - previewBody.x - (wheel.x - previewBody.x - root.previewPanX) * (nz / root.previewZoom)
  3078: +              ny = wheel.y - previewBody.y - (wheel.y - previewBody.y - root.previewPanY) * (nz / root.previewZoom)
  3079: +            }
  3080: +            root.previewZoom = nz
  3081: +            root.previewPanX = nx
  3082: +            root.previewPanY = ny
  3083: +          }
  3084: +          onDoubleClicked: function () {
  3085: +            if (!previewFullImage.visible) return
  3086: +            root.previewZoom = 1
  3087: +            root.previewPanX = 0
  3088: +            root.previewPanY = 0
  3089: +          }
  3090: +        }
  3091: 
  3092:         Item {
  3093:           id: previewHeader
@@ -3010,7 +3163,7 @@ Item {
  3163:             objectName: "previewImage"
  3164:             anchors.fill: parent
  3165:             service: root.service
  3013: -            active: root.previewOpen && root.previewKind === "image"
  3166: +            active: root.previewOpen && root.previewKind === "image" && !root.fullResPreview
  3167:             entry: active ? root.previewEntry : null
  3168:             generated: active && root.previewThumbable()
  3169:             requestSize: 1024
@@ -3018,6 +3171,22 @@ Item {
  3171:             sourceSize.height: Math.max(1, previewBody.height * 2)
  3172:           }
  3173: 
  3174: +          Image {
  3175: +            id: previewFullImage
  3176: +            objectName: "previewFullImage"
  3177: +            anchors.fill: parent
  3178: +            visible: root.previewOpen && root.previewKind === "image" && root.fullResPreview && root.previewEntry !== null
  3179: +            source: visible ? Util.fileUrl(String(root.previewEntry.path)) : ""
  3180: +            fillMode: Image.PreserveAspectFit
  3181: +            asynchronous: true
  3182: +            cache: false
  3183: +            smooth: true
  3184: +            transform: [
  3185: +              Scale { xScale: root.previewZoom; yScale: root.previewZoom },
  3186: +              Translate { x: root.previewPanX; y: root.previewPanY }
  3187: +            ]
  3188: +          }
  3189: +
  3190:           Flickable {
  3191:             id: previewFlick
  3192:             anchors.fill: parent
@@ -3079,7 +3248,7 @@ Item {
  3248:             spacing: Style.space(10)
  3249:             visible: root.previewKind === "folder" || root.previewKind === "none" || root.previewKind === "remoteaudio"
  3250:               || (root.previewKind === "text" && (root.previewBinary || root.previewLoading))
  3082: -              || (root.previewKind === "image" && previewImage.status !== Image.Ready)
  3251: +              || (root.previewKind === "image" && (root.fullResPreview ? previewFullImage.status !== Image.Ready : previewImage.status !== Image.Ready))
  3252:               || (root.previewKind === "audio" && audioPreview.status === Loader.Error)
  3253: 
  3254:             Text {
@@ -3095,12 +3264,13 @@ Item {
  3264:               textFormat: Text.PlainText
  3265:               anchors.horizontalCenter: parent.horizontalCenter
  3266:               text: root.previewLoading ? "Reading"
  3267: +                : (root.previewKind === "image" && root.fullResPreview && previewFullImage.status !== Image.Ready ? "Loading"
  3268:                 : (root.previewKind === "image" && !previewImage.failed && root.previewThumbable() ? "Making a preview"
  3269:                 : (root.previewKind === "image" ? "No preview for this image. Turn on Previews and thumbnails, or install a thumbnailer for it"
  3270:                 : (root.previewKind === "folder" ? "Folder. Press Enter to open it."
  3271:                   : (root.previewKind === "remoteaudio" ? "Audio preview is off for network folders. Press Enter to open it."
  3272:                   : (root.previewKind === "audio" ? "Playing audio here needs the qt6-multimedia package"
  3103: -                    : "No preview for this kind of file")))))
  3273: +                    : "No preview for this kind of file"))))))
  3274:               color: Util.alpha(Color.popups.text, 0.55)
  3275:               font.family: Style.font.family
  3276:               font.pixelSize: Style.font.body
@@ -3186,6 +3356,26 @@ Item {
  3356:             onChanged: function (v) { root.compressFormat = v }
  3357:           }
  3358: 
  3359: +          Dropdown {
  3360: +            objectName: "transcodeFormat"
  3361: +            width: parent.width
  3362: +            visible: root.dialogMode === "transcode"
  3363: +            label: "Format"
  3364: +            value: root.transcodeFormat
  3365: +            options: root.transcodeFormats
  3366: +            onChanged: function (v) { root.transcodeFormat = v }
  3367: +          }
  3368: +
  3369: +          Dropdown {
  3370: +            objectName: "transcodeResolution"
  3371: +            width: parent.width
  3372: +            visible: root.dialogMode === "transcode"
  3373: +            label: "Resolution"
  3374: +            value: root.transcodeResolution
  3375: +            options: root.transcodeResolutions
  3376: +            onChanged: function (v) { root.transcodeResolution = v }
  3377: +          }
  3378: +
  3379:           Text {
  3380:             textFormat: Text.PlainText
  3381:             width: parent.width
@@ -4034,7 +4224,8 @@ Item {
  4224:                 : (root.dialogMode === "connect" ? "Connect"
  4225:                   : (root.dialogMode === "unlock" ? "Unlock"
  4226:                     : (root.dialogMode === "openwith" ? "Open"
  4037: -                      : (root.dialogMode === "compress" ? "Compress" : "Confirm"))))
  4227: +                      : (root.dialogMode === "compress" ? "Compress"
  4228: +                        : (root.dialogMode === "transcode" ? "Transcode" : "Confirm")))))
  4229:               bordered: true
  4230:               onClicked: {
  4231:                 if (root.isReadOnlyDialog()) root.closeDialog()
@@ -4209,6 +4400,8 @@ Item {
  4400:         description: "List folders above files whatever the sort order" },
  4401:       { key: "thumbnails", label: "Previews and thumbnails",
  4402:         description: "Show images, video frames and document pages instead of a generic icon" },
  4403: +      { key: "fullResPreview", label: "Full-resolution image previews", fallback: false,
  4404: +        description: "Preview images at their original size instead of the 1024 px thumbnail" },
  4405:       { key: "rememberFolderViews", label: "Remember the view for each folder",
  4406:         description: "A folder opens in the view you last picked there. Other folders open in the default view" },
  4407:       { key: "extractOnOpen", label: "Extract archives when opened", fallback: false,
@@ -4274,6 +4467,8 @@ Item {
  4467:   property var pendingConflicts: []
  4468:   property double conflictShownMs: 0
  4469:   readonly property int conflictKeyDelay: 600
  4470: +  property double lastLaunchMs: 0
  4471: +  readonly property int launchKeyDelay: 600
  4472: 
  4473:   function presentConflict(jobId, info) {
  4474:     if (dialogMode !== "" || confirm.opened) {
```

### `components/TransferBar.qml` (+5/-0)

```diff

@@ -72,6 +72,7 @@ Item {
    72:     if (t.state === "paused") return "Waiting for a decision"
    73:     if (t.op === "extract" && t.total <= 0) return "Extracting"
    74:     if (t.op === "compress" && t.total <= 0) return "Compressing"
    75: +    if (t.op === "transcode" && t.total <= 0) return "Transcoding"
    76:     var line = Model.formatSize(t.bytes) + " of " + Model.formatSize(t.total)
    77:     if (t.rate > 0) {
    78:       line += "   " + Model.formatRate(t.rate)
@@ -92,6 +93,10 @@ Item {
    93:       out.push({ key: "To", value: shortPath(t.result || Model.joinPath(t.dest, String(t.label || ""))) })
    94:       if (t.files > 0) out.push({ key: "Files", value: String(t.files) })
    95:       if (t.total > 0) out.push({ key: "Size", value: Model.formatSize(t.bytes) + " of " + Model.formatSize(t.total) })
    96: +    } else if (t.op === "transcode") {
    97: +      out.push({ key: "What", value: "Transcoding " + Model.formatCount(Number(t.count) || 1, "item", "items") + " to " + String(t.label || "") })
    98: +      out.push({ key: "Where", value: shortPath(t.result || t.dest) })
    99: +      if (t.files > 0) out.push({ key: "Files", value: String(t.files) + " of " + String(t.filesTotal || t.files) })
   100:     } else {
   101:       var verb = t.op === "move" ? "Moving" : "Copying"
   102:       out.push({ key: "What", value: verb + " " + Model.formatCount(Number(t.count) || 1, "item", "items") })
```

</details>

<details>
<summary>Script -- `apply.sh` (outline + full)</summary>

What `apply.sh` does:

- Resolves the plugin dir (default `~/.config/omarchy/plugins/xyzlab.omafile`, optional argument).
- Forward: `git apply --check` first, then `git apply` of `omafile-local.patch` against the v1.4.4 base.
- Reverse: `git apply -R --check` first, then `git apply -R`.
- Idempotent: if the patch is already applied (or already reverted) it reports so and no-ops.
- If the tree matches neither direction it reports "neither forward nor reverse" -- upstream touched these lines; rebase by hand.
- After applying, restart the shell (`omarchy restart shell`) so the QML reloads cleanly.

```sh
#!/bin/sh
# Apply (or verify) the local omafile patch on top of the v1.4.4 checkout.
# Idempotent: exits 0 if already applied, applies cleanly if not.
set -eu

PLUGIN="$HOME/.config/omarchy/plugins/xyzlab.omafile"
PATCH="$HOME/.config/omarchy/patches/xyzlab.omafile/omafile-local.patch"

[ -f "$PATCH" ] || { echo "missing $PATCH" >&2; exit 1; }
git -C "$PLUGIN" rev-parse --verify v1.4.4 >/dev/null 2>&1 \
  || { echo "plugin checkout missing v1.4.4 tag: $PLUGIN" >&2; exit 1; }

if git -C "$PLUGIN" apply -R --check "$PATCH" 2>/dev/null; then
  echo "already applied (base v1.4.4)"
  exit 0
fi

if ! git -C "$PLUGIN" apply --check "$PATCH" 2>/dev/null; then
  echo "patch does not apply cleanly onto the current tree:" >&2
  git -C "$PLUGIN" apply --check "$PATCH" 2>&1 | head -5 >&2
  echo "expected the working tree to be at v1.4.4 (git -C \"$PLUGIN\" checkout -f v1.4.4)" >&2
  exit 1
fi

git -C "$PLUGIN" apply "$PATCH"
echo "applied omafile-local.patch (base v1.4.4); run: omarchy restart shell"
```

</details>

<details>
<summary>Docs -- `README.md`</summary>

# xyzlab.omafile — local patch on v1.4.4

The Omarchy Omafile plugin (user copy at `~/.config/omarchy/plugins/xyzlab.omafile`,
a git checkout of `chr0nzz/omarchy-omafile`, **base v1.4.4**, commit `a938874`)
carries one local patch, `omafile-local.patch` -- a single consolidated commit with
four changes:

1. **"Transcode…" context-menu entry** (above *Compress…*) for pictures and videos:
   Format + Resolution dialog, new cancellable `transcode` helper op (trusted
   `omarchy-transcode` per file), TransferBar row.
2. **Full-resolution image previews** (opt-in `fullResPreview` setting): the
   original renders at native size; the placeholder tracks the full-res load;
   scroll zooms (1x-8x, cursor-anchored), left-drag pans, double-click resets.
3. **Multi-file open**: *Open* / *Open with* / *Open in editor* act on the whole
   selection; the system-default open runs one `gio open p1 p2 ...` so the viewer
   gets the collection in one window.
4. **Enter no longer double-opens after "Open with"**: launches are timestamped
   (`lastLaunchMs`, 600 ms) and the pane swallows a stray Return/Enter/Space inside
   that window.

Full write-up (issue format, annotated diff with line numbers, script outline,
verification) in `omafile-patch-consolidated.md`.

## Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `omafile-local.patch` | The single patch file, `git diff` against v1.4.4 (5 files) |
| `apply.sh` | Idempotent apply/revert (`git apply`, `-R --check` first) |
| `omafile-patch-consolidated.md` | Issue-format documentation of the patch |
| `archive/` | Superseded patches and legacy working artifacts; see `archive/README.md` |

## Usage

```sh
~/.config/omarchy/patches/xyzlab.omafile/apply.sh          # apply (no-ops if already applied)
~/.config/omarchy/patches/xyzlab.omafile/apply.sh -r       # revert
omarchy restart shell
```

After an upstream plugin update: re-run `apply.sh`; if it reports "neither forward
nor reverse", upstream touched these lines -- rebase by hand.

</details>

## Verification

- `git apply --check` of `omafile-local.patch` onto a pristine v1.4.4 worktree: clean.
- `apply.sh` on the patched checkout: reports "already applied (base v1.4.4)" (idempotent).
- `transcode` op headless (helper stdin JSON): progress -> done -> real output file written.
- Live shell after `omarchy restart shell`: zero omafile QML warnings.
- Checked by hand: *Transcode...* menu on an image; full-res preview renders; scroll zooms
  at the cursor, drag pans, double-click resets; multi-selection open lands in one viewer;
  Enter after "Open with" no longer re-opens the file.

## Open questions

- No doc files are touched in the commit (e.g. `PROTOCOL.md` documentation of the
  `transcode` op) -- left to the maintainer.
