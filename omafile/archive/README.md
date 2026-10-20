> **Superseded (2026-10-19).** The *omp* and *zed* items were shipped upstream in
> v1.4.3 as settings ([issue #50](https://github.com/chr0nzz/omarchy-omafile/issues/50),
> commit `9b5bb20`) — set **Agent = `omp`**, **Editor = `zeditor`** in omafile
> *Settings → Commands*. This v1.3.5-based 4-file patch (omp/zed + LUKS) is kept
> for reference only; do not apply it on the v1.4.3+ checkout. The LUKS piece
> continues at `../omafile-local.patch` (2 files, rebased onto v1.4.3).

## Contents

| File | What it is |
|---|---|
| `omafile-local.patch` | v1.3.5-based 4-file patch (omp/zed + LUKS); superseded -- see banner above |
| `omafile-local-luks-v1.4.3.patch` | v1.4.3-based LUKS-visibility patch; shipped upstream in v1.4.4 |
| `omafile-local-luks-v1.3.5.patch` | Earlier v1.3.5-based LUKS-only draft of the same change |
| `omafile-issue50-omp-zed.patch` | omp/zed fragment filed as issue #50; shipped upstream in v1.4.3 |
| `gen-omafile-doc.py` | Generator for `../omafile-patch-consolidated.md` (reads `git diff v1.4.4` from the plugin checkout) |


# xyzlab.omafile — local patch

Customizes the Omarchy Omafile plugin (user copy at
`~/.config/omarchy/plugins/xyzlab.omafile`, a git checkout of
`chr0nzz/omarchy-omafile`, base v1.3.5):

1. **`Open 'omp' here`** — the "Open Claude Code here" menu item, relabeled and
   re-pointed at the `omp` agent (gated on `command -v omp`).
2. **`Open with zed`** — new right-click item between *Open with* and *Preview*
   (files) / before *Open in new tab* (folders); runs `zeditor <path>`.
3. **`Encrypted` drive entry** — locked LUKS partitions appear in the sidebar with
   a Nautilus-style label; clicking opens the default file manager (Nautilus),
   which handles the passphrase prompt (this system has no polkit agent, so
   omafile's own mount path cannot unlock).

## Files

| File | Purpose |
|---|---|
| `apply.sh` | Idempotent apply/revert (`apply.sh`, `apply.sh -r`, optional plugin dir arg) |
| `omafile-local.patch` | The diff itself (`git apply` format) |
| `README.md` | This file, annotated diff with line numbers |

## Usage

```sh
~/.config/omarchy/patches/xyzlab.omafile/apply.sh          # apply (no-ops if already applied)
~/.config/omarchy/patches/xyzlab.omafile/apply.sh -r       # revert
# after an upstream plugin update: re-run apply.sh; if it reports
# "neither forward nor reverse", upstream touched these lines -- rebase by hand.
```

After applying, the shell hot-reloads plugin files on save; if the live window
keeps showing the old menu, restart the shell: `omarchy restart shell`.

## Annotated diff (line numbers = post-patch state)

### `components/Browser.qml`

```diff
  989:     function separator() { items.push({ key: "sep" + (++sep), label: "", glyph: "" }) }
- 990:     var claude = service && service.claudeAvailable
+ 990:     var omp = service && service.ompAvailable
  991:     if (hasEntry) {
  992:       items.push({ key: "open", label: "Open", glyph: Icons.actionGlyph("open"), hint: "Enter" })
  993:       items.push({ key: "openwith", label: "Open with", glyph: Icons.actionGlyph("open") })
+ 994:       items.push({ key: "zed", label: "Open with zed", glyph: Icons.actionGlyph("open") })
  995:       if (entry.isDir)
  996:         items.push({ key: "opentab", label: "Open in new tab", ... })
  ...
 1020:         items.push({ key: "terminal", label: "Open in terminal", glyph: Icons.actionGlyph("terminal") })
-1021:         if (claude)
-1022:           items.push({ key: "claude", label: "Open Claude Code here", glyph: Icons.actionGlyph("terminal") })
+1021:         if (omp)
+1022:           items.push({ key: "omp", label: "Open 'omp' here", glyph: Icons.actionGlyph("terminal") })
 1023:       }
  ...
-1037:       if (claude)
-1038:         items.push({ key: "claude", label: "Open Claude Code here", glyph: Icons.actionGlyph("terminal") })
+1038:       if (omp)
+1039:         items.push({ key: "omp", label: "Open 'omp' here", glyph: Icons.actionGlyph("terminal") })
  ...
 1270:     else if (key === "openwith") showDialog("openwith", "Open " + (entry ? entry.name : "") + " with", "", entry)
+1271:     else if (key === "zed") service.openWith(["zeditor"], entry.path, false)
 1272:     else if (key === "opentab") newTab(activeSide, entry.path)
  ...
-1287:     else if (key === "claude") service.openClaude(entry && entry.isDir ? entry.path : p.path)
+1289:     else if (key === "omp") service.openOmp(entry && entry.isDir ? entry.path : p.path)
```

Notes:
- *Open with zed* is pushed unconditionally for any entry (files **and**
  folders — Zed opens folders as projects). `openWith` takes an argv **array**
  (`["zeditor"]`) and appends the path itself (`Model.expandFieldCodes` adds
  it when no `%f` field code is present) — passing a plain string gets split
  into single characters, so the array form is required. No new service
  function is needed.
- The *omp* item only shows when `omp` is on `PATH` (see `ompCheck` below);
  the empty-space menu (right-click on background) gets both *Open in terminal*
  and the omp item, the entry menu only for directories.

### `Service.qml`

```diff
-1092:   function openClaude(path) {
+1092:   function openOmp(path) {
 1093:     Quickshell.execDetached(["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--dir=" + path,
-1094:       "bash", "-c", "claude; exec bash"])
+1094:       "bash", "-c", "omp; exec bash"])
 1095:   }
  ...
-1531:   property bool claudeAvailable: false
+1531:   property bool ompAvailable: false
-1533:   property Process claudeCheck: Process {
-1534:     command: ["sh", "-c", "command -v claude"]
+1533:   property Process ompCheck: Process {
+1534:     command: ["sh", "-c", "command -v omp"]
 1535:     running: true
-1536:     onExited: function (code) { root.claudeAvailable = code === 0 }
+1536:     onExited: function (code) { root.ompAvailable = code === 0 }
 1537:   }
```

### `components/SidebarPlaces.qml`

```diff
  62:     if (row.connect === true) { sidebar.connectServer(""); return }
  63:     if (row.server === true) { sidebar.connectServer(String(row.uri || "")); return }
- 64:     if (row.unmounted === true) { sidebar.mountDrive(row.device); return }
+ 64:     if (row.unmounted === true) {
+ 65:       if (row.luks === true) Quickshell.execDetached(["gio", "open", home])
+ 66:       else sidebar.mountDrive(row.device)
+ 67:       return
+ 68:     }
  ...
 394:           removable: drive.removable === true,
+395:           luks: !isMounted && drive.fstype === "crypto_LUKS",
  ...
-639:                    if (modelData.unmounted === true) {
-640:                      sidebar.mountDrive(modelData.device)
-641:                      return
-642:                    }
+644:                    if (modelData.unmounted === true) {
+645:                      if (modelData.luks === true) Quickshell.execDetached(["gio", "open", home])
+646:                      else sidebar.mountDrive(modelData.device)
+647:                      return
+648:                    }
```

Notes:
- Clicking an unmounted **Encrypted** (LUKS) row opens the default file manager
  (`gio open <home>` -> Nautilus), where the drive shows with Nautilus's own
  passphrase prompt. The `luks` field marks LUKS rows; all other unmounted
  drives keep the normal `mountDrive` path. Both the keyboard (activateCursor)
  and mouse-click handlers are branched.

### `bin/omafile-helper`

```diff
 2153:     for d in devices or []:
 2154:         out.append(d)
+2155:         d["_has_children"] = len(d.get("children") or []) > 0
 2156:         out.extend(flatten_lsblk(d.get("children")))
  ...
-2870:     "swap", "crypto_LUKS", "LVM2_member", "linux_raid_member", "zfs_member",
+2871:     "swap", "LVM2_member", "linux_raid_member", "zfs_member",
  ...
 2885:     if not fstype or fstype in UNMOUNTABLE_FSTYPES:
 2886:         return False
+2887:     if fstype == "crypto_LUKS" and dev.get("_has_children"):
+2888:         return False
 2889:     if str(dev.get("parttype") or "").lower() in HIDDEN_PARTTYPES:
  ...
 2966:                 total, free = space_by_mount[mount]
+2967:             label = dev.get("label")
+2968:             if not label and dev.get("fstype") == "crypto_LUKS" and not mount:
+2969:                 label = "Encrypted"
 2970:             drives.append({
-2965:                 "name": dev.get("name"), "path": dev.get("path"), "label": dev.get("label"),
+2971:                 "name": dev.get("name"), "path": dev.get("path"), "label": label,
```

Notes:
- Visibility only — the helper lists locked LUKS partitions as **Encrypted**
  (Nautilus naming) and, via the `_has_children` tag, keeps *unlocked* LUKS
  containers out of the list (their cleartext dm child is what mounts, e.g. the
  root disk). No unlock/mount logic lives in the helper: the QML click handler
  routes LUKS rows to the file manager.
- `crypto_LUKS` was removed from `UNMOUNTABLE_FSTYPES`; its only consumer is
  `mountable_device`, so no other code path is affected.
- Known limitation (frozen by design): every locked LUKS drive is shown with the
  generic **Encrypted** label and the click opens Nautilus's home view, so the
  user picks the drive there. This does not scale past one LUKS drive — a second
  one would appear as another indistinguishable "Encrypted" row.

### Related: `~/.config/hypr/bindings.lua` (not part of the patch)

```lua
-- lines 30-33
-- File manager: open Omafile (the shell plugin) instead of Nautilus.
hl.unbind("SUPER + SHIFT + F")
o.bind("SUPER + SHIFT + F", "File manager", "omarchy-shell shell toggle xyzlab.omafile '{}'")
```

## Upstream status (checked 2026-10-18)

Upstream `main` (v1.4.1) still contains the exact pre-patch lines in both
files, so a future update should merge this patch cleanly; worst case it
reports "neither forward nor reverse" and needs a 2-minute manual rebase.
