# 🚧 ACTIVE TASK CHECKPOINT

**Problem:** 
1. As shown in the user's screenshot (`/public/assets/aistudio/image_2a31f1db.png`), `server.ts` logged `PacketBridge LAN server running on http://0.0.0.0:3000`, and when the user opened `http://0.0.0.0:3000` in Chrome on Windows, Chrome failed with `ERR_ADDRESS_INVALID` because `0.0.0.0` is an all-interfaces bind address that Windows browsers reject as a destination URL.
2. On Windows machines with virtual or disconnected adapters (`169.254.x.x`), `os.networkInterfaces()` may list link-local APIPA addresses before the real Wi-Fi/Hotspot `192.168.x.x` / `10.x.x.x` address unless interfaces are prioritized by RFC1918 LAN subnet rank.
3. `vite.config.ts` triggered a Vite 8 warning on Windows for using `__dirname` instead of `fileURLToPath(import.meta.url)`.

**Best Solution:** 
1. **Prioritize Real Wi-Fi / Hotspot LAN IPs & Guard Against `0.0.0.0` (`src/utils/transferEngine.ts`)**:
   - Add `rankLanIpv4Address(ip: string)` to sort `192.168.x.x`, `10.x.x.x`, and `172.16-31.x.x` ahead of `169.254.x.x` link-local addresses.
   - Update `formatNetworkAccessUrl` so `0.0.0.0` is normalized to `localhost` (never producing `http://0.0.0.0:3000`), and update `validateNetworkAddress` to reject `0.0.0.0` with a clear explanation.
2. **Clear Clickable Startup URLs in `server.ts`**:
   - Sort detected interfaces using `rankLanIpv4Address`.
   - Print clickable `http://localhost:3000` (for this PC) and each detected `http://<LAN-IP>:3000` (for Wi-Fi / Hotspot devices) in the terminal startup banner instead of `http://0.0.0.0:3000`.
3. **Fix Vite 8 Config Loader Warning (`vite.config.ts`)**:
   - Replace `__dirname` with `path.dirname(fileURLToPath(import.meta.url))` in `vite.config.ts`.
4. **Update `NetworkAccessPanel.tsx`**:
   - Clearly display both the **This PC (`http://localhost:3000`)** link and the **Wi-Fi / Hotspot Network IP (`http://<LAN-IP>:3000`)** link with 1-click switchers.

**Goal:** 
The terminal startup log and UI never output `http://0.0.0.0:3000`, real `192.168.x.x` / `10.x.x.x` Wi-Fi/Hotspot IPs are automatically prioritized first, `vite.config.ts` has zero warnings, and all tests and builds pass.

**Steps:**
- [x] Step 1: Read `CODE_INDEX.md`, `ACTIVE_TASK.md`, `server.ts`, `vite.config.ts`, and `src/utils/transferEngine.ts`.
- [x] Step 2: Update `src/utils/transferEngine.ts` and `src/utils/transferEngine.test.ts` with `rankLanIpv4Address` and `0.0.0.0` handling.
- [x] Step 3: Update `server.ts`, `vite.config.ts`, and `src/components/NetworkAccessPanel.tsx`.
- [x] Step 4: Run unit tests, `compile_applet`, and `lint_applet`, and update `CODE_INDEX.md` and `ACTIVE_TASK.md`.

**Status:** 
[Completed on 2026-11-06]
