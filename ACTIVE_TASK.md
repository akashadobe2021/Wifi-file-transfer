# 🚧 ACTIVE TASK CHECKPOINT

**Problem:** 
On the user's local Windows system (`http://192.168.0.184:3000` and `http://localhost:3000`), joining via the mobile IP and updating the Receiver profile still showed `0 Online` on `http://localhost:3000`.
Root causes on Windows + LAN:
1. **IPv4-only bind (`0.0.0.0`) vs Windows IPv6 `localhost` (`::1`)**: Calling `server.listen(activePort, '0.0.0.0')` binds only IPv4 on Windows. If an earlier server instance is bound to IPv6 `[::1]:3000` (`localhost`), Windows does not throw `EADDRINUSE` for `0.0.0.0:3000`, resulting in `http://localhost:3000` hitting one process and `http://192.168.0.184:3000` hitting another in-memory process!
2. **In-Memory-Only `state.peers` & Browser ETag Caching on `/api/state`**: `state.peers` lived only in process RAM, and Express's default `ETag` allowed browsers to cache `GET /api/state` responses (`304 Not Modified`).
3. **Lack of Automatic Remote IP Peer Detection**: If a mobile device connected to `http://192.168.0.184:3000` (`GET /` or `GET /api/state`), the server waited only for client JS instead of also auto-registering any non-loopback remote IP (`req.socket.remoteAddress`) in the Lobby.

**Best Solution:** 
1. **Disk-Backed Shared Lobby State (`storage/lobby-state.json` in `server.ts`)**:
   - Persist `peers` and `activePairedPeerId` to `storage/lobby-state.json` on every Lobby update and reload/merge from `storage/lobby-state.json` on every `refreshDiskState()` (`GET /api/state`). This guarantees that `localhost:3000` and `192.168.x.x:3000` ALWAYS share the exact same Lobby peer list even across server restarts or dual IPv4/IPv6 sockets.
2. **Dual-Stack Server Listen + Auto-Detection of Remote Mobile IPs (`server.ts`)**:
   - Disable Express `etag` and set `Cache-Control: no-store, no-cache, must-revalidate` on all `/api/*` responses.
   - Automatically detect any HTTP or WebSocket request from a non-loopback IP (`socketIp !== '127.0.0.1'`) and auto-register/keep-alive that mobile IP in `state.peers` as a connected Receiver (`role: 'receiver'`, `connected: true`), merging seamlessly by `ipAddress` or `peerId` when the mobile user clicks **Update My Lobby Profile**.
   - Reclaim both `127.0.0.1` and `localhost` (`[::1]`) on startup and bind dual-stack (`server.listen(activePort)`).
3. **Dedicated Receiver Peer ID & Manual Refresh Button (`src/App.tsx`, `src/components/LobbyScreen.tsx`)**:
   - Ensure Receiver profile updates use a Receiver-specific `peerId` (`recv-...`) and add a 1-click **Refresh Lobby** button alongside 1.5-second cache-busted polling (`/api/state?t=...`).

**Goal:** 
Any user joining via mobile/LAN IP (`http://192.168.x.x:3000`) or updating their Receiver profile immediately appears as `Online` on `http://localhost:3000`.

**Steps:**
- [x] Step 1: Analyze screenshot `/public/assets/aistudio/image_7f698ff2.png` and Windows `localhost` (`::1`) vs `192.168.0.184` (`0.0.0.0`) behavior.
- [x] Step 2: Update `server.ts` with `storage/lobby-state.json` persistence, `no-store` cache headers, automatic remote IP Receiver detection, IP-based peer deduplication, and dual-stack binding.
- [x] Step 3: Update `src/App.tsx` and `src/components/LobbyScreen.tsx` with cache-busted `/api/state?t=` polling and a manual Refresh Lobby button.
- [x] Step 4: Run unit tests, compile, lint, restart dev server, and verify in Playwright.
- [x] Step 5: Update `CODE_INDEX.md` and `ACTIVE_TASK.md`.

**Status:** 
[Completed on 2026-11-06]
