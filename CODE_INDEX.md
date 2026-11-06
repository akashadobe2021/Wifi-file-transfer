# 🗺️ CODE INDEX & AI EXPERIENCE TRAJECTORY (`CODE_INDEX.md`)

> **Single Source of Truth:** Read this file before analyzing bugs or proposing architectural changes, and update it as your final action whenever features, routes, or verified patterns change.

---

## PART 1: THE SPATIAL INDEX (The Code Map)

### 1. Framework & Stack
- **Runtime & Backend:** Node.js + Express (`^4.21.2`) + `ws` WebSocket Server (`^8.22.1`) running via `tsx server.ts` on port `3000`.
- **Frontend Framework:** React 19 (`^19.0.1`) + TypeScript (`^7.0.2`) bundled with Vite (`^8.3.0`).
- **Styling & Typography:** Tailwind CSS v4 (`@tailwindcss/vite ^4.3.3`) with `Plus Jakarta Sans` (display/body) and `JetBrains Mono` (`tabular-nums` for packet counts, throughput, and SHA-256 digests).
- **Testing:** Node built-in test runner (`node:test` + `node:assert/strict`) executed via `npx --yes tsx --test`.

### 2. Directory & Component Map
- `/server.ts` — Full-stack Express + HTTP + WebSocket (`/ws`) server and Vite middleware host. Manages real physical storage under `/storage/host` and `/storage/receiver`, binary packet chunk writes (`r+` file handles at byte offsets), cryptographic `sha256` verification, and real file downloads/deletions.
- `/src/utils/transferEngine.ts` — Pure domain logic for packet piece calculation (`calculatePieceCount`), 24-block torrent-style visual piece maps (`buildPieceVisualBlocks`), real-time throughput & ETA math (`calculateSpeedAndEta`, `calculateAggregateTransferSpeed`, `formatTransferSpeed`), concurrent multi-file stream scheduling (`scheduleConcurrentTransfers`, min 5 simultaneous files), and folder path validation (`validateFolderName`, `normalizeFolderPath`).
- `/src/utils/transferEngine.test.ts` — Deterministic unit test suite verifying packet math, real-time `MB/s` speed formatting, 5+ concurrent file scheduling, and folder path security.
- `/src/App.tsx` — Root workspace controller connecting `/api/state` and `/ws` WebSocket broadcasts to UI views, plus the browser `File.slice()` binary chunk reader with `performance.now()` per-chunk duration telemetry and 5+ concurrent worker pool.
- `/src/components/TopBar.tsx` — 3-Zone Top Bar navigation (`Home`, `Transfers`, `Folders & Files`, `History`, and primary `Upload Files` CTA).
- `/src/components/NetworkAccessPanel.tsx` — Network IP Access bar and expandable configuration card allowing users to copy `http://<LAN-IP>:3000`, open the Network IP link directly, switch between detected `os.networkInterfaces()` IPv4 addresses, or set a custom Wi-Fi / Hotspot IP address via `POST /api/network/config`.
- `/src/components/TransferQueuePanel.tsx` — CopyCase-inspired Drag-and-Drop upload card with 1-click `Send files to: Receiver Device | Host Device` destination switcher, collapsible `Transfer Options` drawer (`32 KB`/`64 KB`/`128 KB` pieces and `5`/`6`/`8` parallel files), live aggregate throughput (`Live Speed: MB/s`), per-stream real-time `MB/s` / `KB/s` transfer speeds, 24-block piece indicator, ETA, and Pause/Resume controls.
- `/src/components/DualFolderExplorer.tsx` — Side-by-side Host Device and Receiver Device folder & file manager featuring visual folder tiles, 1-click folder creation on both endpoints, and real file `Save` (download) and `Delete` actions.
- `/src/components/ActivityLogPanel.tsx` — Clean, human-friendly `Transfer Activity History` list with search, category filter tabs (`All Activity`, `Completed Files`, `Folders`), and CSV export.
- `/requirement.text` & `/requirements.txt` — Complete project runtime, package version, and Network IP setup specification files.
- `/.npmrc` — Configures `legacy-peer-deps=true` alongside `esbuild@^0.28.0` in `package.json` to guarantee clean `npm install` resolution across Windows, macOS, and Linux.
- `/AGENTS.md` & `/GLOBAL_AI_INDEXING_PROMPT.md` — Hybrid AI Memory System instructions and lifecycle protocol.
- `/ACTIVE_TASK.md` — Active task checkpointing file for anti-context-loss tracking.

### 3. Core Architecture & Data Flow
1. **System & Directory Discovery:** On startup, `/api/state` requests, and `/api/network/config` updates, `server.ts` inspects real network interfaces via `os.networkInterfaces()` (exposing interface names, IPv4 addresses, and `activeNetworkUrl`) and recursively scans `/storage/host` and `/storage/receiver` using `fs/promises` to populate `folders` and `completedFiles`.
2. **Multi-File Chunked Upload Flow (`Client -> HTTP Relay -> Disk -> WebSocket`):**
   - User selects or drops $N$ real files in `TransferQueuePanel.tsx`.
   - `App.tsx` calls `POST /api/transfers/init` to pre-allocate `.part` files in the target directory and register transfer jobs.
   - A client-side worker pool with `minConcurrency >= 5` slices up to 5–8 files simultaneously using `file.slice(offsetBytes, endByte)`, measures high-resolution `chunkDurationMs` via `performance.now()`, converts each binary chunk to base64, and sends `POST /api/transfers/:id/chunk`.
   - `server.ts` writes each binary chunk at `offsetBytes` into the `.part` file, blends instantaneous chunk throughput with cumulative session throughput via `calculateSpeedAndEta()`, and updates `job.speedBytesPerSec`. When all pieces arrive, `server.ts` renames `.part` to the final filename, computes the real `crypto.createHash('sha256')` digest, updates the activity log, and broadcasts `state:sync` over WebSockets (`/ws`) to all connected clients.
3. **File Download & Deletion:** Users click `Save` (`GET /api/files/download`) to stream the real file from `/storage/<endpoint>/<folderPath>/<fileName>`, or `Delete` (`DELETE /api/files`) to unlink it from disk.

### 4. Immutable Guardrails
- **Zero False or Seeded Data:** Never add hardcoded/mock sample files, fake IP addresses, or simulated progress timers. All folders, files, sizes, checksums, and network addresses must come from real filesystem and OS/browser APIs.
- **Standard Transparent Networking Only:** Never implement firewall bypass, security/AV evasion, or covert traffic obfuscation. Always use standard, transparent HTTP and WebSocket protocols on port `3000`.
- **Minimum 5 Concurrent Streams:** Multi-file uploads must maintain a minimum concurrency of 5 parallel file streams when 5 or more files are queued.
- **Path Traversal Protection:** Always resolve and validate disk paths against `HOST_STORAGE` and `RECEIVER_STORAGE` in `resolveDiskPath()` before reading, writing, or deleting files.

---

## PART 2: THE TEMPORAL TRAJECTORY (AI Experience Log)

### Log Entry 1 — Accessible Hidden File Input Duplication
- **Error Capture:** Using `className="sr-only"` with `aria-label` on `<input type="file" multiple />` next to a visible `<button>` caused screen readers and Playwright accessibility snapshots to see two adjacent file-upload buttons in the header.
- **Correction Applied:** Applied `className="hidden"`, `tabIndex={-1}`, and `aria-hidden="true"` to the underlying `<input type="file" />` while keeping the visible trigger `<button>` accessible and wired via `inputRef.current?.click()`.
- **Verified Pattern:** `[2026-11 Pattern]: Always hide programmatic <input type="file"> elements with className="hidden" and aria-hidden="true" when triggered by an adjacent labeled <button> to prevent duplicate nodes in the accessibility tree.`

### Log Entry 2 — Replacing Simulated Transfers with Real Binary Offset Writes
- **Error Capture:** Initial seeded demo files and timer-driven progress did not persist real binary content to disk or allow downloading transferred files.
- **Correction Applied:** Replaced in-memory mock jobs with real `fs/promises` directory scanning (`/storage/host` and `/storage/receiver`), browser `File.slice()` binary chunk streaming over `POST /api/transfers/:id/chunk`, `fsp.open(partPath, 'r+')` offset writes, and `GET /api/files/download`.
- **Verified Pattern:** `[2026-11 Pattern]: For chunked file transfers, pre-create a .part file during batch initialization and write each incoming base64 chunk at its exact byte offset via fsp.open(path, 'r+') before renaming on final piece verification.`

### Log Entry 3 — Hybrid AI Memory System & Task Checkpointing Integration
- **Error Capture:** Multi-turn engineering tasks risk losing architectural context or reintroducing mock patterns without an explicit spatial and temporal index.
- **Correction Applied:** Integrated `/AGENTS.md`, `/GLOBAL_AI_INDEXING_PROMPT.md`, `/CODE_INDEX.md`, and `/ACTIVE_TASK.md` in the project root to enforce read-before-acting, active checkpointing, and final trajectory updates.
- **Verified Pattern:** `[2026-11 Pattern]: Always read CODE_INDEX.md and ACTIVE_TASK.md at the start of every task and commit new architectural mappings or verified patterns to CODE_INDEX.md before completing the turn.`

### Log Entry 4 — Sub-50ms Local Chunk Transfer Speed Calculation
- **Error Capture:** High-speed local loopback/LAN transfers often complete individual chunks or small files in under 50ms, causing a naive `elapsedMs <= 50` guard or queue-time `startedAtMs` timestamp to report `0 B/s`.
- **Correction Applied:** Deferred `job.startedAtMs` initialization until the first packet chunk arrives, passed `performance.now()` `chunkDurationMs` from the client on each chunk upload, removed the 50ms floor in `calculateSpeedAndEta()`, and added `formatTransferSpeed()` and `calculateAggregateTransferSpeed()`.
- **Verified Pattern:** `[2026-11 Pattern]: Measure per-chunk transfer duration with performance.now() and initialize startedAtMs on the first active chunk so fast local transfers compute non-zero MB/s and KB/s throughput.`

### Log Entry 5 — CopyCase Drag-and-Drop Simplification & Progressive Disclosure
- **Error Capture:** Exposing technical packet parameters, raw SHA-256 hashes, and dense tables on the primary surface overwhelmed users looking for a simple drag-and-drop file transfer experience.
- **Correction Applied:** Adopted a CopyCase-inspired visual hierarchy with a large central drag-and-drop zone, a 1-click segmented destination toggle (`Receiver Device` vs `Host Device`), visual folder tiles, and a collapsible `Transfer Options` drawer for packet size and concurrency settings.
- **Verified Pattern:** `[2026-11 Pattern]: Lead file-transfer interfaces with a single prominent drag-and-drop dropzone and 1-click destination switcher, tucking packet-level tuning controls inside a collapsible options drawer.`

### Log Entry 6 — Multi-Interface Network IP Access & Custom Hotspot IP Override
- **Error Capture:** Devices on Wi-Fi or mobile hotspots often have multiple network interfaces (`eth0`, `wlan0`, virtual bridges) where the first OS interface may not match the user's active Wi-Fi/Hotspot subnet IP.
- **Correction Applied:** Exposed all non-internal IPv4 interfaces in `detectSystemNodeInfo()`, added `POST /api/network/config` with `validateNetworkAddress()` validation, enabled CORS headers on `server.ts`, and built `NetworkAccessPanel.tsx` for 1-click IP switching, custom LAN/Hotspot IP entry, and link copying.
- **Verified Pattern:** `[2026-11 Pattern]: Expose all detected IPv4 interfaces alongside a validated custom IP override and CORS headers so users on multi-homed or hotspot networks can select and share the exact reachable LAN URL.`

### Log Entry 7 — Resolving Vite 8 & esbuild ERESOLVE Peer Dependency Conflict & Windows `tsx` Binary
- **Error Capture:** Running `npm install` on Windows failed with `ERESOLVE could not resolve` (`esbuild@^0.25.0` vs `vite@^8.3.0`), which left `node_modules/.bin/tsx` uninstalled and caused `'tsx' is not recognized as an internal or external command` on `npm run dev`.
- **Correction Applied:** Updated `"esbuild"` to `"^0.28.0"` and moved both `"tsx"` and `"esbuild"` into `dependencies` in `package.json` (so `tsx` is installed even when `NODE_ENV=production`), added `/.npmrc` with `legacy-peer-deps=true`, and synced `/requirement.text` and `/requirements.txt`.
- **Verified Pattern:** `[2026-11 Pattern]: Place tsx and esbuild@^0.28.0 in dependencies alongside .npmrc (legacy-peer-deps=true) so npm install always provisions the tsx binary without ERESOLVE conflicts on Windows, macOS, and Linux.`

### Log Entry 8 — Preventing Windows Chrome `ERR_ADDRESS_INVALID` on `http://0.0.0.0:3000` & Ranking RFC1918 LAN IPs
- **Error Capture:** Printing `http://0.0.0.0:3000` in the server startup log caused Windows users to click or copy `0.0.0.0:3000` into Chrome, resulting in `ERR_ADDRESS_INVALID` because `0.0.0.0` is a wildcard bind address rather than a routable browser target on Windows. Additionally, unsorted `os.networkInterfaces()` can place Windows `169.254.x.x` APIPA virtual adapters ahead of real `192.168.x.x` Wi-Fi IPs.
- **Correction Applied:** Added `rankLanIpv4Address()` in `src/utils/transferEngine.ts` to sort `192.168.x.x` and `10.x.x.x` interfaces ahead of `169.254.x.x`, normalized `0.0.0.0` to `localhost` in `formatNetworkAccessUrl()`, rejected `0.0.0.0` in `validateNetworkAddress()`, updated `server.ts` startup logs to print clickable `http://localhost:3000` and `http://<LAN-IP>:3000` URLs, and replaced `__dirname` in `vite.config.ts` with `fileURLToPath(import.meta.url)`.
- **Verified Pattern:** `[2026-11 Pattern]: Bind local LAN servers to 0.0.0.0 internally but never output http://0.0.0.0:PORT as a user-facing URL; always display http://localhost:PORT and RFC1918-sorted LAN IPv4 URLs (192.168.x.x / 10.x.x.x) to prevent ERR_ADDRESS_INVALID on Windows browsers.`


