# OSCP // MAP

A completely offline investigation workspace inspired by the graph, inspector,
and workspace workflow in the adjacent **ADGraph 3.0** project.

## v2.0 changes

This folder applies the redesign notes in `CHANGES.MD` on top of the existing
notebook-first app (per-host notebook, search-to-evidence, credential
suggestions, pinned next steps, and a map built from scans and bookmarks —
all already present). Two items from that document were not yet covered and
are added here, additively, with nothing removed from the original workflow:

- **References instead of silent moves.** If pasted text contains an IP
  address that matches another host already in the workspace, a non-blocking
  suggestion offers **Add reference**. Accepting it records a `lead`
  relationship from the current note to that host — the note's own host
  never changes. See **Workflow** and **Navigate** below.
- **Optional folder autosave (experimental).** Settings can additionally save
  a `workspace.json` snapshot into a folder you pick, via the browser's File
  System Access API, alongside the existing browser-storage autosave. This
  is new and only feature-detected where the API exists; it has not been
  exercised in a live desktop browser in this environment, matching the
  original caution that such a feature "must be tested in your actual
  browser." Treat it as a bonus, not a substitute for **Save backup**.

Two further UI changes were requested directly, outside `CHANGES.MD`:

- **Targets removed from the sidebar.** The quick host-switcher list under
  Workspace is gone. Open a host's notebook from the map, from **Hosts &
  services**, or from the notebook's own host selector instead.
- **Next steps, redesigned per host.** The sidebar view is now labeled
  **Check next** (previously "Next steps") and still lists every checkbox
  across the workspace with pin/complete controls, unchanged. Inside a
  host's notebook, the **Next steps** tab is no longer that list — it's a
  plain writing surface, like Notes, that already starts a line with
  `- [ ] ` so you never type it yourself; pressing Enter continues the list
  automatically, and pressing Enter on an empty item exits it. What you
  write there feeds the same checkbox/pin system as before, so it still
  shows up in Check next.

## Open it

Double-click **`index.html`** or open it in a modern desktop browser. It is a
single self-contained HTML file: no server, installation, build step, internet,
CDN, external fonts, or account is needed. You can copy just this file to another
machine. Application data is saved separately.

Choose **Explore example lab** to try the graph with clearly fictional data,
or **Import scan** to start with your own Nmap output. Settings also lets you
load the example or start an empty workspace.

## Workflow

1. Import one or more Nmap scans, or drag files onto the page. Supported formats:
   XML (`-oX`, recommended), normal text (`-oN` / `.nmap`), and grepable output
   (`-oG` / `.gnmap`). Example output command for your own lab target:

   ```sh
   nmap -sV -oA initial 192.0.2.10
   ```

   Import `initial.xml`; there is no need to import all three representations.
   Plain text must contain the `Nmap scan report for …` host headers.

2. Hosts and open or `open|filtered` services become graph nodes. IP addresses
   (including IPv6), hostnames, service versions, OS guesses, and script output
   are retained when present. Repeated scans merge by address and port/protocol.
   User notes and host progress are preserved. An explicit new observation can
   change a known port to closed or filtered. Ports missing from a later scan
   keep their previous state; absence is not treated as proof of closure.
   Exact duplicate filename/content imports are skipped. New non-open ports
   remain in the source scan instead of cluttering the graph.

3. Add or edit **hosts**, **services**, **credentials**, **findings**, and **notes**.
   Save source references, evidence, and commands for reproduction. Commands and
   imported content are treated as text; the app never executes them. Evidence
   attachments such as screenshots are referenced by filename/path, not embedded.

4. Use **Add link** to connect any two discoveries, for example an exposed file
   to a credential, or a credential to another host. Mark links as **lead** or
   **confirmed**. The automatic “recorded on” relationship captures context; it
   does not imply that a credential works on that host. If your notes mention
   the IP address of a different host already in the workspace, an **Add
   reference** suggestion offers the same kind of lead link — accepting it
   never reassigns the note to that other host.

5. Use host stages and the **Progress** checklist to track work. Stages and
   checkboxes are independent, manually maintained records. They are study aids,
   not statements about exam requirements or points.

6. **Save backup** regularly. **Export notes** produces a readable Markdown
   document for writing up your investigation, not an official exam template.

## Navigate

- Use the arrow in the **Workspace** header to hide or show the sidebar. The
  arrow remains visible while collapsed.
- Successful scan imports open the map with the workspace sidebar collapsed and
  the inspector closed. Summary cards are hidden in a populated map to leave
  more room for enumeration; they remain available in the list views.
- The inspector appears only when a discovery is selected. Close it with **×**
  or `Esc` to return that space to the map.
- Click a graph node or list entry to open the inspector.
- Drag nodes to arrange them; drag the background to pan.
- Scroll or use **+ / −** to zoom; **Fit** centers the visible graph.
- **Arrange** resets manually saved node positions and can be undone.
- Search names, IP addresses, service data, sources, and notes. Credential
  secret fields are intentionally excluded from search.
- Use the host selector in the map toolbar to focus on one host. Type chips
  hide/show node kinds. Search-matched discoveries retain host context when
  the host type is enabled.
- Use **Add link**, a relationship's graph label, or the inspector to manage links.
- **Undo last change** keeps up to eight in-memory workspace snapshots. It also
  recovers deleted records or a replaced workspace during the same page session.
- `/` focuses search, `?` opens help, and `Esc` closes a dialog or selection.
  With the graph focused, `+` / `−` zoom and `F` fits the graph. Nodes can be
  selected with the keyboard, and the list views provide a table alternative.

## Saving and privacy

The app starts in **session-only mode**. Closing or reloading the page can lose
work unless you have saved a backup or enabled browser storage.

**Save backup** downloads a versioned JSON file containing the entire workspace:
all discoveries, credential secrets, relationships, original scan files,
checklists, activity, and manually arranged node positions. **Open backup**
validates and replaces the current workspace; it does not merge workspaces.
The HTML application file itself is never updated with your investigation data.
Current search/type filters and zoom are temporary view preferences.

In Settings, **Remember this workspace in this browser** enables localStorage.
It is optional, unencrypted, and subject to browser storage quotas. `file://`
storage behavior varies between browsers, and moving the HTML file can change
its storage location. The status bar explicitly reports a failed local save.
Use JSON backups as the portable copy, and use one active tab per workspace.
Turning off browser storage removes this app's saved workspace from that
browser; it does not delete downloaded backups.

Settings also offers an **experimental** "save continuously to a chosen
folder" option, where supported by the browser. Choosing a folder writes an
unencrypted `workspace.json` snapshot there on every change, in addition to
(never instead of) browser storage. The folder handle lives only in that
tab's memory — reloading the page always requires choosing the folder again.
This has not been verified in a live desktop browser in this environment;
confirm it behaves as expected in yours before relying on it, and keep using
**Save backup** regardless.

Credentials are masked in the UI but **are not encrypted** in memory, backups,
or browser storage. Markdown exports omit the dedicated secret fields by
default, with an explicit option to include them. Notes, commands, and source
evidence may themselves contain secrets; review any export before sharing.

All styles and scripts are inline. A Content Security Policy blocks network
connections, remote assets, frames, objects, and form submission. There is no
telemetry, remote API, or scan execution. Imported content is escaped before
rendering. The app supports manually recorded relationships, not BloodHound
ingestion, automatic attack-path inference, or an exploitation engine.

## Limits

- Up to 30 files per import, 20 MB per scan, and 20,000 nodes per workspace.
- Backup imports are limited to 50 MB. Scan imports and discovery edits check
  the resulting backup size and reject changes that would exceed this limit.
  Use separate workspaces for large scan collections.
- The map displays at most 300 matching nodes at once. Narrow by host, type, or
  search for large imports; list views and backups retain all records.
- Activity retains the most recent 1,000 events. It records operation summaries,
  not every historical field value. Full original scans remain in the workspace.
- Import merging uses the literal address, case-insensitively; it cannot infer
  that an IP address and a manually entered DNS name identify the same machine.
- Passwords, hashes, and tokens are text fields; external screenshots and other
  attachments are not bundled.

## Source and checks

`index.html` is the ready-to-use artifact. Editable source is in `src/`:

| File | Purpose |
| --- | --- |
| `src/shell.html` | Page structure and offline content policy |
| `src/styles.css` | Responsive dark workspace and graph styling |
| `src/core.js` | Nmap parsing, data model, merging, validation, layout, export |
| `src/notebook.js` | Per-host notebooks, tasks, credential/reference detection, search, Markdown + ZIP export |
| `src/storage.js` | IndexedDB/localStorage autosave, plus the experimental folder-autosave helper |
| `src/app.js` | UI, SVG interactions, forms, import, and browser persistence |
| `build.js` | Dependency-free bundling into one HTML file |

After source changes, also run `node tests/notebook.test.js` alongside
`tests/core.test.js` — it covers notebooks, tasks, credential/reference
detection, search, and export.

After source changes:

```sh
node --check src/core.js
node --check src/app.js
node tests/core.test.js
node build.js
```

`tests/browser.test.cjs` is an optional Playwright/Electron integration check
for direct `file://` operation, XML parsing, graph interactions, forms, escaping,
credential masking, backups, browser persistence, and mobile layout. It uses
existing local installations, with paths configurable via `OSCP_PLAYWRIGHT` and
`OSCP_ELECTRON`. It is development tooling, not an app dependency.

The core regression checks have been run. The browser suite could not launch
in the build environment because the sandbox blocked an Electron system call;
visual behavior and browser integration remain unverified there.
