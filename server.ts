import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  calculatePieceCount,
  buildPieceVisualBlocks,
  calculateSpeedAndEta,
  validateFolderName,
  normalizeFolderPath,
  validateNetworkAddress,
  formatNetworkAccessUrl,
  rankLanIpv4Address,
  validateDiskMountInput,
  formatByteSize,
  formatTransferSpeed,
  normalizeClientIp,
  sanitizePeerId,
  DEFAULT_MIN_CONCURRENT_FILES,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
  type TransferJob,
  type ActivityLogEntry,
  type DiskDrivePreset,
  type LobbyPeer,
} from './src/utils/transferEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, 'storage');
const DEFAULT_HOST_STORAGE = path.join(STORAGE_ROOT, 'host');
const DEFAULT_RECEIVER_STORAGE = path.join(STORAGE_ROOT, 'receiver');
const RECEIVER_PEERS_STORAGE_ROOT = path.join(STORAGE_ROOT, 'receivers');
const LOBBY_STATE_FILE = path.join(STORAGE_ROOT, 'lobby-state.json');

let hostDiskRoot = DEFAULT_HOST_STORAGE;
let receiverDiskRoot = DEFAULT_RECEIVER_STORAGE;
let activeHostVirtualPath = '/';
let activeReceiverVirtualPath = '/';

// Custom mounted disk paths per receiver peerId (if mounted on that peer)
const peerReceiverDiskRoots = new Map<string, string>();
const peerReceiverDiskLabels = new Map<string, string>();

export function getReceiverDiskRootForPeer(peerId: string | null): string {
  if (!peerId) return DEFAULT_RECEIVER_STORAGE;
  const custom = peerReceiverDiskRoots.get(peerId);
  if (custom) return custom;
  return path.join(RECEIVER_PEERS_STORAGE_ROOT, sanitizePeerId(peerId));
}

const checksumCache = new Map<string, string>();

export interface NetworkInterfaceItem {
  name: string;
  address: string;
  url: string;
}

export interface SystemNodeInfo {
  hostname: string;
  platform: string;
  arch: string;
  lanAddresses: string[];
  interfaces: NetworkInterfaceItem[];
  activeNetworkUrl: string;
  customNetworkIp: string | null;
  port: number;
  hostDiskRoot: string;
  receiverDiskRoot: string;
  receiverDiskLabel: string;
  availableDrives: DiskDrivePreset[];
}

interface ServerState {
  nodeInfo: SystemNodeInfo;
  peers: LobbyPeer[];
  activePairedPeerId: string | null;
  folders: FolderNode[];
  completedFiles: TransferredFileRecord[];
  jobs: TransferJob[];
  logs: ActivityLogEntry[];
  minConcurrency: number;
  defaultChunkSizeBytes: number;
}

function nowTimeStr(): string {
  return new Date().toISOString().slice(11, 23);
}

/**
 * Returns ONLY Host OS disk drives and Host folders so Host Disk data
 * never leaks into the Receiver Disk section.
 */
function detectAvailableDiskDrives(): DiskDrivePreset[] {
  const presets: DiskDrivePreset[] = [
    {
      id: 'app-host',
      label: 'Host Disk Workspace',
      path: DEFAULT_HOST_STORAGE,
      kind: 'app',
    },
  ];

  const homeDir = os.homedir();
  const candidates: Array<{ id: string; label: string; dir: string; kind: 'system' | 'drive' }> = [
    { id: 'sys-home', label: 'Host User Home', dir: homeDir, kind: 'system' },
    { id: 'sys-downloads', label: 'Host Downloads', dir: path.join(homeDir, 'Downloads'), kind: 'system' },
    { id: 'sys-desktop', label: 'Host Desktop', dir: path.join(homeDir, 'Desktop'), kind: 'system' },
    { id: 'sys-documents', label: 'Host Documents', dir: path.join(homeDir, 'Documents'), kind: 'system' },
  ];

  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const driveRoot = `${letter}:\\`;
      candidates.push({
        id: `drive-${letter.toLowerCase()}`,
        label: `Host Drive (${letter}:)`,
        dir: driveRoot,
        kind: 'drive',
      });
    }
  } else {
    candidates.push({ id: 'drive-root', label: 'Host Root (/)', dir: '/', kind: 'drive' });
    candidates.push({ id: 'drive-tmp', label: 'Host Temp (/tmp)', dir: '/tmp', kind: 'drive' });
    if (fs.existsSync('/Volumes')) {
      candidates.push({ id: 'drive-volumes', label: 'Host Volumes (/Volumes)', dir: '/Volumes', kind: 'drive' });
    }
  }

  const seenPaths = new Set<string>(presets.map((p) => path.resolve(p.path)));
  for (const item of candidates) {
    try {
      const resolved = path.resolve(item.dir);
      if (!seenPaths.has(resolved) && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        seenPaths.add(resolved);
        presets.push({
          id: item.id,
          label: item.label,
          path: resolved,
          kind: item.kind,
        });
      }
    } catch {
      // Ignore inaccessible drive letter or protected path
    }
  }

  return presets;
}

function detectSystemNodeInfo(
  port: number,
  customIp: string | null = null,
  activePairedPeerId: string | null = null
): SystemNodeInfo {
  const nets = os.networkInterfaces();
  const interfaces: NetworkInterfaceItem[] = [];

  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        interfaces.push({
          name,
          address: net.address,
          url: formatNetworkAccessUrl(net.address, port),
        });
      }
    }
  }

  interfaces.sort((a, b) => rankLanIpv4Address(a.address) - rankLanIpv4Address(b.address));

  if (interfaces.length === 0) {
    interfaces.push({
      name: 'loopback',
      address: '127.0.0.1',
      url: formatNetworkAccessUrl('127.0.0.1', port),
    });
  }

  const lanAddresses = interfaces.map((i) => i.address);
  const defaultUrl = interfaces[0]?.url || `http://localhost:${port}`;
  const activeNetworkUrl = customIp
    ? formatNetworkAccessUrl(customIp, port)
    : defaultUrl;

  const currentReceiverLabel =
    (activePairedPeerId && peerReceiverDiskLabels.get(activePairedPeerId)) ||
    (activePairedPeerId
      ? `Receiver Device Disk (${activePairedPeerId})`
      : 'Receiver Device Storage (/)');

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    arch: os.arch(),
    lanAddresses,
    interfaces,
    activeNetworkUrl,
    customNetworkIp: customIp,
    port,
    hostDiskRoot,
    receiverDiskRoot,
    receiverDiskLabel: currentReceiverLabel,
    availableDrives: detectAvailableDiskDrives(),
  };
}

function getEndpointBaseDir(endpoint: EndpointRole): string {
  return endpoint === 'host' ? hostDiskRoot : receiverDiskRoot;
}

function isSubPathOrEqual(baseDir: string, targetAbs: string): boolean {
  const rel = path.relative(baseDir, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveDiskPath(endpoint: EndpointRole, virtualFolderPath: string, fileName?: string): string {
  const baseDir = path.resolve(getEndpointBaseDir(endpoint));
  const normalizedVirtual = path.posix
    .normalize('/' + virtualFolderPath.replace(/\\/g, '/'))
    .replace(/^\/+/, '');
  const folderAbs = path.resolve(baseDir, normalizedVirtual);
  if (!isSubPathOrEqual(baseDir, folderAbs)) {
    throw new Error('Invalid folder path outside mounted disk root');
  }
  if (!fileName) return folderAbs;
  const safeFile = path.basename(fileName);
  const fileAbs = path.resolve(folderAbs, safeFile);
  if (!isSubPathOrEqual(baseDir, fileAbs)) {
    throw new Error('Invalid file path outside mounted disk root');
  }
  return fileAbs;
}

async function computeFileSha256(filePath: string, forceCompute = false): Promise<string> {
  try {
    const stat = await fsp.stat(filePath);
    const cacheKey = `${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    const cached = checksumCache.get(cacheKey);
    if (cached) return cached;

    // For fast directory browsing on large real disk drives (e.g. C:\ or Downloads),
    // only hash files <= 1 MB during listing unless forceCompute is true.
    if (!forceCompute && stat.size > 1024 * 1024) {
      return 'sha256:disk-verified';
    }

    const buffer = await fsp.readFile(filePath);
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const formatted = `sha256:${digest.slice(0, 16)}`;
    checksumCache.set(cacheKey, formatted);
    return formatted;
  } catch {
    return 'sha256:unreadable';
  }
}

const IGNORED_SYSTEM_DIRS = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'Recovery',
  'PerfLogs',
  'node_modules',
  '.git',
]);

async function scanEndpointStorage(
  endpoint: EndpointRole,
  focusedVirtualPath: string
): Promise<{ folders: FolderNode[]; files: TransferredFileRecord[] }> {
  const baseDir = path.resolve(getEndpointBaseDir(endpoint));
  try {
    await fsp.mkdir(baseDir, { recursive: true });
  } catch {
    // Mounted system drive root (e.g. C:\ or /) already exists
  }

  const foldersMap = new Map<string, FolderNode>();
  const filesMap = new Map<string, TransferredFileRecord>();

  async function scanSingleDirectory(virtualPath: string, includeSubfolders: boolean) {
    let dirAbs: string;
    try {
      dirAbs = resolveDiskPath(endpoint, virtualPath);
    } catch {
      return;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    let dirStat: fs.Stats | null = null;
    try {
      dirStat = await fsp.stat(dirAbs);
    } catch {
      // Ignore stat error
    }

    const dirFiles = entries
      .filter((e) => e.isFile() && !e.name.endsWith('.part'))
      .slice(0, 100);
    const subDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_SYSTEM_DIRS.has(e.name))
      .slice(0, 60);

    const parentVirtual =
      virtualPath === '/'
        ? '/'
        : path.posix.dirname(virtualPath) === '.'
        ? '/'
        : path.posix.dirname(virtualPath);

    foldersMap.set(virtualPath, {
      id: `fld-${endpoint}-${virtualPath}`,
      endpoint,
      name: virtualPath === '/' ? 'Disk Root (/)' : path.posix.basename(virtualPath),
      path: virtualPath,
      parentPath: parentVirtual,
      createdAt: dirStat ? dirStat.mtime.toISOString().slice(11, 19) : '00:00:00',
      fileCount: dirFiles.length,
    });

    for (const fileEntry of dirFiles) {
      const fileAbs = path.join(dirAbs, fileEntry.name);
      try {
        const fileStat = await fsp.stat(fileAbs);
        const checksum = await computeFileSha256(fileAbs, false);
        const fileId = `file-${endpoint}-${virtualPath}-${fileEntry.name}`;
        filesMap.set(fileId, {
          id: fileId,
          name: fileEntry.name,
          sizeBytes: fileStat.size,
          mimeType: 'application/octet-stream',
          sourceEndpoint: endpoint === 'receiver' ? 'host' : 'receiver',
          targetEndpoint: endpoint,
          targetFolderPath: virtualPath,
          chunkSizeBytes: 65536,
          totalPieces: calculatePieceCount(fileStat.size, 65536),
          checksum,
          completedAt: fileStat.mtime.toISOString().slice(11, 19),
        });
      } catch {
        // Skip unreadable locked OS files (e.g. pagefile.sys)
      }
    }

    if (includeSubfolders) {
      for (const subEntry of subDirs) {
        const subVirtual =
          virtualPath === '/' ? `/${subEntry.name}` : `${virtualPath}/${subEntry.name}`;
        if (!foldersMap.has(subVirtual)) {
          const subAbs = path.join(dirAbs, subEntry.name);
          let subFileCount = 0;
          let subCreatedAt = '00:00:00';
          try {
            const subEntries = await fsp.readdir(subAbs, { withFileTypes: true });
            subFileCount = subEntries.filter((e) => e.isFile() && !e.name.endsWith('.part')).length;
            const subStat = await fsp.stat(subAbs);
            subCreatedAt = subStat.mtime.toISOString().slice(11, 19);
          } catch {
            // Unreadable subfolder
          }
          foldersMap.set(subVirtual, {
            id: `fld-${endpoint}-${subVirtual}`,
            endpoint,
            name: subEntry.name,
            path: subVirtual,
            parentPath: virtualPath,
            createdAt: subCreatedAt,
            fileCount: subFileCount,
          });
        }
      }
    }
  }

  // Always scan the root of the mounted disk drive plus the currently active virtual path
  await scanSingleDirectory('/', true);
  if (focusedVirtualPath && focusedVirtualPath !== '/') {
    await scanSingleDirectory(focusedVirtualPath, true);
  }

  return {
    folders: Array.from(foldersMap.values()),
    files: Array.from(filesMap.values()),
  };
}

let activePort = Number(process.env.PORT) || 3000;

const state: ServerState = {
  nodeInfo: detectSystemNodeInfo(activePort),
  peers: [],
  activePairedPeerId: null,
  minConcurrency: DEFAULT_MIN_CONCURRENT_FILES,
  defaultChunkSizeBytes: 65536,
  folders: [],
  completedFiles: [],
  jobs: [],
  logs: [],
};

interface PersistedLobbyState {
  peers?: LobbyPeer[];
  activePairedPeerId?: string | null;
  customNetworkIp?: string | null;
  peerDiskRoots?: Record<string, string>;
  peerDiskLabels?: Record<string, string>;
  updatedAt?: number;
}

function detectPlatformFromUserAgent(ua: string): string {
  if (/android/i.test(ua)) return 'Android Device';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS Device';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS Device';
  if (/windows/i.test(ua)) return 'Windows Device';
  if (/linux/i.test(ua)) return 'Linux Device';
  return 'Wi-Fi / Network IP Device';
}

function isPrivateLanIpv4(ip: string): boolean {
  return (
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(ip)
  );
}

async function loadLobbyStateFromDisk() {
  try {
    if (!fs.existsSync(LOBBY_STATE_FILE)) return;
    const raw = await fsp.readFile(LOBBY_STATE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as PersistedLobbyState;

    if (parsed.peerDiskRoots && typeof parsed.peerDiskRoots === 'object') {
      for (const [k, v] of Object.entries(parsed.peerDiskRoots)) {
        if (typeof v === 'string' && v.trim()) {
          peerReceiverDiskRoots.set(k, v);
        }
      }
    }
    if (parsed.peerDiskLabels && typeof parsed.peerDiskLabels === 'object') {
      for (const [k, v] of Object.entries(parsed.peerDiskLabels)) {
        if (typeof v === 'string' && v.trim()) {
          peerReceiverDiskLabels.set(k, v);
        }
      }
    }

    if (Array.isArray(parsed.peers)) {
      const mergedMap = new Map<string, LobbyPeer>();
      for (const p of state.peers) {
        if (p.peerId.startsWith('ip-') && !isPrivateLanIpv4(p.ipAddress)) continue;
        mergedMap.set(p.peerId, p);
      }
      for (const diskPeer of parsed.peers) {
        if (!diskPeer || !diskPeer.peerId) continue;
        if (diskPeer.peerId.startsWith('ip-') && !isPrivateLanIpv4(diskPeer.ipAddress)) {
          continue;
        }
        const memPeer = mergedMap.get(diskPeer.peerId);
        if (!memPeer) {
          mergedMap.set(diskPeer.peerId, {
            ...diskPeer,
            connected: diskPeer.role === 'receiver' ? true : Boolean(diskPeer.connected),
          });
        } else {
          // Prefer whichever record is newer, and never downgrade a 'receiver' role to 'host'
          const newer =
            (diskPeer.lastSeenMs || 0) >= (memPeer.lastSeenMs || 0) ? diskPeer : memPeer;
          const preservedRole: EndpointRole =
            diskPeer.role === 'receiver' || memPeer.role === 'receiver'
              ? 'receiver'
              : newer.role;
          mergedMap.set(diskPeer.peerId, {
            ...newer,
            role: preservedRole,
            connected: preservedRole === 'receiver' ? true : Boolean(newer.connected),
          });
        }
      }

      // Deduplicate auto-detected IP peers (`ip-...`) if an explicit Receiver profile exists for the same IP
      const allPeers = Array.from(mergedMap.values());
      const explicitReceiverIps = new Set(
        allPeers
          .filter((p) => p.role === 'receiver' && !p.peerId.startsWith('ip-'))
          .map((p) => p.ipAddress)
      );
      state.peers = allPeers.filter(
        (p) => !(p.peerId.startsWith('ip-') && explicitReceiverIps.has(p.ipAddress))
      );
    }

    if (parsed.activePairedPeerId !== undefined && state.activePairedPeerId === null) {
      const exists = state.peers.some((p) => p.peerId === parsed.activePairedPeerId);
      if (exists) {
        state.activePairedPeerId = parsed.activePairedPeerId;
      }
    }
  } catch {
    // Ignore transient JSON read error
  }
}

async function saveLobbyStateToDisk() {
  try {
    await fsp.mkdir(STORAGE_ROOT, { recursive: true });
    const payload: PersistedLobbyState = {
      peers: state.peers,
      activePairedPeerId: state.activePairedPeerId,
      customNetworkIp: state.nodeInfo.customNetworkIp,
      peerDiskRoots: Object.fromEntries(peerReceiverDiskRoots.entries()),
      peerDiskLabels: Object.fromEntries(peerReceiverDiskLabels.entries()),
      updatedAt: Date.now(),
    };
    await fsp.writeFile(LOBBY_STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // Ignore transient disk write error
  }
}

async function autoTrackIncomingClient(req: http.IncomingMessage): Promise<boolean> {
  try {
    const socketIp = normalizeClientIp(req.socket.remoteAddress || '127.0.0.1');
    const rawHost = String(req.headers.host || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split(':')[0];
    const ua = String(req.headers['user-agent'] || '');

    const isLanHostHeader = isPrivateLanIpv4(rawHost);
    const isRemoteLanSocketIp =
      isPrivateLanIpv4(socketIp) && !state.nodeInfo.lanAddresses.includes(socketIp);
    const isMobileUa = /android|iphone|ipad|ipod|mobile/i.test(ua);

    // Automatically register any genuine remote LAN client IP or mobile device accessing a private LAN IP URL
    if (!isRemoteLanSocketIp && !(isLanHostHeader && isMobileUa)) {
      return false;
    }

    const effectiveIp = isRemoteLanSocketIp
      ? socketIp
      : isLanHostHeader
      ? rawHost
      : state.nodeInfo.lanAddresses[0] || socketIp;

    await loadLobbyStateFromDisk();

    // Check if any receiver peer already exists for this IP address
    const existingForIp = state.peers.find(
      (p) => p.role === 'receiver' && p.ipAddress === effectiveIp
    );
    if (existingForIp) {
      existingForIp.connected = true;
      existingForIp.lastSeenMs = Date.now();
      return false;
    }

    const autoPeerId = sanitizePeerId(`ip-${effectiveIp}`);
    const platform = detectPlatformFromUserAgent(ua);
    const name = `${platform} (${effectiveIp})`;
    const peerDiskDir = getReceiverDiskRootForPeer(autoPeerId);
    await fsp.mkdir(peerDiskDir, { recursive: true });

    const newPeer: LobbyPeer = {
      peerId: autoPeerId,
      name,
      ipAddress: effectiveIp,
      platform,
      role: 'receiver',
      joinedAt: nowTimeStr().slice(0, 8),
      lastSeenMs: Date.now(),
      connected: true,
      receiverDiskLabel: `${name} Local Disk (/)`,
      receiverDiskPath: peerDiskDir,
      receiverFileCount: 0,
    };

    state.peers.push(newPeer);
    await saveLobbyStateToDisk();
    return true;
  } catch {
    return false;
  }
}

async function refreshDiskState() {
  await loadLobbyStateFromDisk();
  receiverDiskRoot = getReceiverDiskRootForPeer(state.activePairedPeerId);
  state.nodeInfo = detectSystemNodeInfo(
    activePort,
    state.nodeInfo.customNetworkIp,
    state.activePairedPeerId
  );
  const hostScan = await scanEndpointStorage('host', activeHostVirtualPath);
  const receiverScan = await scanEndpointStorage('receiver', activeReceiverVirtualPath);
  state.folders = [...hostScan.folders, ...receiverScan.folders];
  state.completedFiles = [...hostScan.files, ...receiverScan.files];

  // Update file count metadata for the active receiver peer
  if (state.activePairedPeerId) {
    const activePeer = state.peers.find((p) => p.peerId === state.activePairedPeerId);
    if (activePeer) {
      activePeer.receiverFileCount = receiverScan.files.length;
      activePeer.receiverDiskPath = receiverDiskRoot;
      activePeer.receiverDiskLabel =
        peerReceiverDiskLabels.get(activePeer.peerId) ||
        `${activePeer.name} Disk (/)`;
    }
  }
}

function appendLog(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>): ActivityLogEntry {
  const fullEntry: ActivityLogEntry = {
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: nowTimeStr(),
  };
  state.logs = [fullEntry, ...state.logs.slice(0, 199)];
  return fullEntry;
}

async function startServer() {
  await fsp.mkdir(DEFAULT_HOST_STORAGE, { recursive: true });
  await fsp.mkdir(DEFAULT_RECEIVER_STORAGE, { recursive: true });
  await fsp.mkdir(RECEIVER_PEERS_STORAGE_ROOT, { recursive: true });
  await refreshDiskState();

  appendLog({
    category: 'session',
    level: 'info',
    sourceEndpoint: 'host',
    message: `Storage initialized on ${state.nodeInfo.hostname} (Host Disk: ${hostDiskRoot}). Waiting for users in Network IP Lobby.`,
  });

  const app = express();
  app.set('etag', false);
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsPeerMap = new Map<WebSocket, string>();
  const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Prevent unhandled 'error' event on WebSocketServer when http.Server encounters EADDRINUSE
  wss.on('error', () => {
    // Handled by server.on('error') recovery logic below
  });

  function broadcastState() {
    const payload = JSON.stringify({
      type: 'state:sync',
      state,
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  wss.on('connection', async (ws, req) => {
    await autoTrackIncomingClient(req);
    try {
      const reqUrl = new URL(req.url || '/ws', 'http://localhost');
      const peerId = reqUrl.searchParams.get('peerId');
      if (peerId) {
        wsPeerMap.set(ws, peerId);
        const timer = disconnectTimers.get(peerId);
        if (timer) {
          clearTimeout(timer);
          disconnectTimers.delete(peerId);
        }
        const existing = state.peers.find((p) => p.peerId === peerId);
        if (existing) {
          existing.connected = true;
          existing.lastSeenMs = Date.now();
          await saveLobbyStateToDisk();
          broadcastState();
        }
      }
    } catch {
      // Ignore URL parse error
    }

    await refreshDiskState();
    ws.send(
      JSON.stringify({
        type: 'state:sync',
        state,
      })
    );

    ws.on('close', () => {
      const peerId = wsPeerMap.get(ws);
      wsPeerMap.delete(ws);
      if (!peerId) return;

      // Check if another active WebSocket is open for the same peerId
      for (const [otherWs, otherPeerId] of wsPeerMap.entries()) {
        if (otherPeerId === peerId && otherWs.readyState === WebSocket.OPEN) {
          return;
        }
      }

      // Note: Do not set receiver peer.connected = false on transient mobile WebSocket drops
      // so mobile users joining over Wi-Fi / Hotspot remain visible in the Host Lobby.
    });
  });

  // Loopback-only graceful port handover when a newer `npm run dev` starts
  app.post('/api/server/takeover', (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
      res.json({ ok: true });
      setTimeout(() => {
        wss.close();
        server.close(() => process.exit(0));
      }, 50);
      return;
    }
    res.status(403).json({ error: 'Localhost only' });
  });

  app.get('/api/state', async (req, res) => {
    const added = await autoTrackIncomingClient(req);
    await refreshDiskState();
    if (added) {
      broadcastState();
    }
    res.json(state);
  });

  // Register or heartbeat a device/person in the Network IP Lobby
  app.post('/api/lobby/register', async (req, res) => {
    await loadLobbyStateFromDisk();

    const {
      peerId: rawPeerId,
      name: rawName,
      platform: rawPlatform,
      preferredRole,
      accessHost,
      receiverDiskLabel,
    } = req.body as {
      peerId?: string;
      name?: string;
      platform?: string;
      preferredRole?: EndpointRole;
      accessHost?: string;
      receiverDiskLabel?: string;
    };

    const peerId = sanitizePeerId(rawPeerId || `peer-${Date.now()}`);
    const socketIp = normalizeClientIp(req.socket.remoteAddress || '127.0.0.1');
    const cleanAccessHost = (accessHost || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split(':')[0];

    const isLanHostHeader =
      Boolean(cleanAccessHost) &&
      cleanAccessHost !== 'localhost' &&
      cleanAccessHost !== '127.0.0.1';

    const resolvedIp = isPrivateLanIpv4(socketIp)
      ? socketIp
      : isLanHostHeader
      ? cleanAccessHost
      : state.nodeInfo.lanAddresses[0] || socketIp;

    const existingPeer = state.peers.find((p) => p.peerId === peerId);
    const activeHostPeer = state.peers.find(
      (p) => p.role === 'host' && p.connected && p.peerId !== peerId
    );

    let role: EndpointRole;
    if (existingPeer?.role === 'receiver' || peerId.startsWith('recv-') || peerId.startsWith('receiver-')) {
      role = 'receiver';
    } else if (preferredRole === 'host' || preferredRole === 'receiver') {
      role = preferredRole;
    } else if (existingPeer) {
      role = existingPeer.role;
    } else if (isLanHostHeader || isPrivateLanIpv4(socketIp) || Boolean(activeHostPeer)) {
      role = 'receiver';
    } else {
      role = 'host';
    }

    const ua = String(req.headers['user-agent'] || '');
    const platform = (
      rawPlatform ||
      existingPeer?.platform ||
      detectPlatformFromUserAgent(ua)
    ).trim();
    const defaultName =
      role === 'host'
        ? `${state.nodeInfo.hostname} (Host)`
        : `${platform} (${resolvedIp})`;
    const name = (rawName || existingPeer?.name || defaultName).trim();

    const peerDiskDir = getReceiverDiskRootForPeer(peerId);
    let receiverFileCount = 0;
    if (role === 'receiver') {
      try {
        await fsp.mkdir(peerDiskDir, { recursive: true });
        const entries = await fsp.readdir(peerDiskDir, { withFileTypes: true });
        receiverFileCount = entries.filter((e) => e.isFile() && !e.name.endsWith('.part')).length;
      } catch {
        // Ignore directory read error
      }
    }

    if (receiverDiskLabel) {
      peerReceiverDiskLabels.set(peerId, receiverDiskLabel.trim());
    }
    const diskLabel =
      peerReceiverDiskLabels.get(peerId) ||
      (role === 'receiver' ? `${name} Local Disk (/)` : 'Host Disk');

    const nowMs = Date.now();
    let peer: LobbyPeer;
    if (existingPeer) {
      existingPeer.name = name;
      existingPeer.ipAddress = resolvedIp;
      existingPeer.platform = platform;
      existingPeer.role = role;
      existingPeer.lastSeenMs = nowMs;
      existingPeer.connected = true;
      existingPeer.receiverDiskLabel = diskLabel;
      existingPeer.receiverDiskPath = role === 'receiver' ? peerDiskDir : hostDiskRoot;
      existingPeer.receiverFileCount = receiverFileCount;
      peer = existingPeer;
    } else {
      peer = {
        peerId,
        name,
        ipAddress: resolvedIp,
        platform,
        role,
        joinedAt: nowTimeStr().slice(0, 8),
        lastSeenMs: nowMs,
        connected: true,
        receiverDiskLabel: diskLabel,
        receiverDiskPath: role === 'receiver' ? peerDiskDir : hostDiskRoot,
        receiverFileCount,
      };
      state.peers.push(peer);

      if (role === 'receiver') {
        appendLog({
          category: 'session',
          level: 'info',
          sourceEndpoint: 'receiver',
          message: `User "${name}" joined the Lobby via Network IP (${resolvedIp}).`,
        });
      }
    }

    // Remove any temporary auto-IP placeholder (`ip-...`) for the same IP if an explicit receiver peer joined
    if (role === 'receiver' && !peerId.startsWith('ip-')) {
      state.peers = state.peers.filter(
        (p) => !(p.peerId.startsWith('ip-') && p.ipAddress === resolvedIp)
      );
    }

    await saveLobbyStateToDisk();
    await refreshDiskState();
    broadcastState();
    res.json({ peer, state });
  });

  // Upsert (create or update) a peer's display name, role, or local Receiver Disk label
  app.post('/api/lobby/update-peer', async (req, res) => {
    await loadLobbyStateFromDisk();

    const {
      peerId: rawPeerId,
      name: rawName,
      role: rawRole,
      platform: rawPlatform,
      accessHost,
      receiverDiskLabel,
    } = req.body as {
      peerId?: string;
      name?: string;
      role?: EndpointRole;
      platform?: string;
      accessHost?: string;
      receiverDiskLabel?: string;
    };

    const cleanId = sanitizePeerId(rawPeerId || `recv-${Date.now()}`);
    const socketIp = normalizeClientIp(req.socket.remoteAddress || '127.0.0.1');
    const cleanAccessHost = (accessHost || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split(':')[0];
    const isLanHostHeader =
      Boolean(cleanAccessHost) &&
      cleanAccessHost !== 'localhost' &&
      cleanAccessHost !== '127.0.0.1';

    const resolvedIp = isPrivateLanIpv4(socketIp)
      ? socketIp
      : isLanHostHeader
      ? cleanAccessHost
      : state.nodeInfo.lanAddresses[0] || socketIp;

    let peer = state.peers.find((p) => p.peerId === cleanId);
    const effectiveRole: EndpointRole =
      rawRole === 'host' || rawRole === 'receiver'
        ? rawRole
        : peer?.role || 'receiver';

    const ua = String(req.headers['user-agent'] || '');
    const platform = (
      rawPlatform ||
      peer?.platform ||
      detectPlatformFromUserAgent(ua)
    ).trim();
    const effectiveName = (
      rawName ||
      peer?.name ||
      `${platform} (${resolvedIp})`
    ).trim();

    const peerDiskDir = getReceiverDiskRootForPeer(cleanId);
    let receiverFileCount = 0;
    if (effectiveRole === 'receiver') {
      try {
        await fsp.mkdir(peerDiskDir, { recursive: true });
        const entries = await fsp.readdir(peerDiskDir, { withFileTypes: true });
        receiverFileCount = entries.filter((e) => e.isFile() && !e.name.endsWith('.part')).length;
      } catch {
        // Ignore directory read error
      }
    }

    if (typeof receiverDiskLabel === 'string' && receiverDiskLabel.trim()) {
      peerReceiverDiskLabels.set(cleanId, receiverDiskLabel.trim());
    }
    const diskLabel =
      peerReceiverDiskLabels.get(cleanId) ||
      `${effectiveName} Local Disk (/)`;

    if (!peer) {
      peer = {
        peerId: cleanId,
        name: effectiveName,
        ipAddress: resolvedIp,
        platform,
        role: effectiveRole,
        joinedAt: nowTimeStr().slice(0, 8),
        lastSeenMs: Date.now(),
        connected: true,
        receiverDiskLabel: diskLabel,
        receiverDiskPath: effectiveRole === 'receiver' ? peerDiskDir : hostDiskRoot,
        receiverFileCount,
      };
      state.peers.push(peer);
    } else {
      peer.name = effectiveName;
      peer.role = effectiveRole;
      peer.ipAddress = resolvedIp;
      peer.platform = platform;
      peer.receiverDiskLabel = diskLabel;
      peer.receiverDiskPath = effectiveRole === 'receiver' ? peerDiskDir : hostDiskRoot;
      peer.receiverFileCount = receiverFileCount;
      peer.lastSeenMs = Date.now();
      peer.connected = true;
    }

    if (effectiveRole === 'receiver' && !cleanId.startsWith('ip-')) {
      state.peers = state.peers.filter(
        (p) => !(p.peerId.startsWith('ip-') && p.ipAddress === resolvedIp)
      );
    }

    if (effectiveRole === 'receiver') {
      appendLog({
        category: 'session',
        level: 'info',
        sourceEndpoint: 'receiver',
        message: `Receiver "${peer.name}" (${peer.ipAddress}) is active in the Host Lobby.`,
      });
    }

    await saveLobbyStateToDisk();
    await refreshDiskState();
    broadcastState();
    res.json({ peer, state });
  });

  // Host selects a joined person from the Lobby to open the full connected workspace
  app.post('/api/lobby/select', async (req, res) => {
    await loadLobbyStateFromDisk();

    const { peerId } = req.body as { peerId?: string | null };

    if (!peerId) {
      state.activePairedPeerId = null;
      activeReceiverVirtualPath = '/';
      await saveLobbyStateToDisk();
      await refreshDiskState();
      appendLog({
        category: 'session',
        level: 'info',
        sourceEndpoint: 'host',
        message: 'Host returned to the Network IP Lobby.',
      });
      broadcastState();
      res.json({ activePairedPeerId: null, state });
      return;
    }

    const cleanId = sanitizePeerId(peerId);
    const targetPeer = state.peers.find((p) => p.peerId === cleanId);
    if (!targetPeer) {
      res.status(404).json({ error: 'Selected user is no longer in the lobby.' });
      return;
    }

    targetPeer.role = 'receiver';
    targetPeer.connected = true;
    targetPeer.lastSeenMs = Date.now();
    state.activePairedPeerId = targetPeer.peerId;
    activeReceiverVirtualPath = '/';

    const peerDiskDir = getReceiverDiskRootForPeer(targetPeer.peerId);
    await fsp.mkdir(peerDiskDir, { recursive: true });

    await saveLobbyStateToDisk();
    await refreshDiskState();

    appendLog({
      category: 'session',
      level: 'success',
      sourceEndpoint: 'host',
      targetEndpoint: 'receiver',
      message: `Host connected with "${targetPeer.name}" (${targetPeer.ipAddress}). Showing Host Disk and ${targetPeer.name}'s Receiver Disk.`,
    });

    broadcastState();
    res.json({ activePairedPeerId: state.activePairedPeerId, peer: targetPeer, state });
  });

  // Configure or switch the active Network IP address for LAN / Hotspot access
  app.post('/api/network/config', async (req, res) => {
    const { networkIp } = req.body as { networkIp?: string };
    const validation = validateNetworkAddress(networkIp ?? '', activePort);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    state.nodeInfo = detectSystemNodeInfo(
      activePort,
      validation.hostPort,
      state.activePairedPeerId
    );

    await saveLobbyStateToDisk();

    appendLog({
      category: 'session',
      level: 'info',
      sourceEndpoint: 'host',
      message: `Updated active Network IP access address to ${state.nodeInfo.activeNetworkUrl}`,
    });

    broadcastState();
    res.json({ nodeInfo: state.nodeInfo, state });
  });

  // Mount a real physical disk drive or directory for Host or Receiver
  app.post('/api/storage/mount', async (req, res) => {
    const { endpoint, diskPath } = req.body as {
      endpoint?: EndpointRole;
      diskPath?: string;
    };

    if (endpoint !== 'host' && endpoint !== 'receiver') {
      res.status(400).json({ error: 'Endpoint must be host or receiver.' });
      return;
    }

    const validation = validateDiskMountInput(diskPath ?? '');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    try {
      const resolvedPath = path.resolve(validation.trimmed);
      if (!fs.existsSync(resolvedPath)) {
        await fsp.mkdir(resolvedPath, { recursive: true });
      }
      const stat = await fsp.stat(resolvedPath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: `"${resolvedPath}" is a file, not a disk directory.` });
        return;
      }

      if (endpoint === 'host') {
        hostDiskRoot = resolvedPath;
        activeHostVirtualPath = '/';
      } else {
        receiverDiskRoot = resolvedPath;
        if (state.activePairedPeerId) {
          peerReceiverDiskRoots.set(state.activePairedPeerId, resolvedPath);
          peerReceiverDiskLabels.set(state.activePairedPeerId, resolvedPath);
        }
        activeReceiverVirtualPath = '/';
      }

      await saveLobbyStateToDisk();
      await refreshDiskState();

      appendLog({
        category: 'folder',
        level: 'info',
        sourceEndpoint: endpoint,
        folderPath: resolvedPath,
        message: `Mounted physical disk drive "${resolvedPath}" on ${
          endpoint === 'host' ? 'Host Device' : 'Receiver Device'
        }.`,
      });

      broadcastState();
      res.json({ diskRoot: resolvedPath, state });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? `Cannot access disk path: ${err.message}`
            : 'Cannot access the specified disk drive or directory.',
      });
    }
  });

  // Navigate to a specific subfolder on the mounted Host or Receiver disk drive
  app.post('/api/storage/navigate', async (req, res) => {
    const { endpoint, folderPath = '/' } = req.body as {
      endpoint?: EndpointRole;
      folderPath?: string;
    };

    if (endpoint !== 'host' && endpoint !== 'receiver') {
      res.status(400).json({ error: 'Endpoint must be host or receiver.' });
      return;
    }

    const cleanVirtual =
      '/' +
      path.posix
        .normalize('/' + String(folderPath).replace(/\\/g, '/'))
        .replace(/^\/+|\/+$/g, '');

    try {
      const targetAbs = resolveDiskPath(endpoint, cleanVirtual);
      if (!fs.existsSync(targetAbs) || !(await fsp.stat(targetAbs)).isDirectory()) {
        res.status(404).json({ error: `Folder "${cleanVirtual}" does not exist on disk.` });
        return;
      }

      if (endpoint === 'host') {
        activeHostVirtualPath = cleanVirtual;
      } else {
        activeReceiverVirtualPath = cleanVirtual;
      }

      await refreshDiskState();
      broadcastState();
      res.json({ folderPath: cleanVirtual, state });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not open disk folder.',
      });
    }
  });

  // Directly transfer an existing file from Host disk drive to Receiver disk drive (or vice versa)
  app.post('/api/files/transfer-disk', async (req, res) => {
    const {
      sourceEndpoint,
      sourceFolderPath = '/',
      fileName,
      targetEndpoint,
      targetFolderPath = '/',
    } = req.body as {
      sourceEndpoint?: EndpointRole;
      sourceFolderPath?: string;
      fileName?: string;
      targetEndpoint?: EndpointRole;
      targetFolderPath?: string;
    };

    if (
      (sourceEndpoint !== 'host' && sourceEndpoint !== 'receiver') ||
      (targetEndpoint !== 'host' && targetEndpoint !== 'receiver') ||
      !fileName
    ) {
      res.status(400).json({ error: 'Valid sourceEndpoint, targetEndpoint, and fileName are required.' });
      return;
    }

    try {
      const sourceFileAbs = resolveDiskPath(sourceEndpoint, sourceFolderPath, fileName);
      if (!fs.existsSync(sourceFileAbs)) {
        res.status(404).json({ error: `Source file "${fileName}" not found on disk.` });
        return;
      }

      const stat = await fsp.stat(sourceFileAbs);
      const targetDirAbs = resolveDiskPath(targetEndpoint, targetFolderPath);
      await fsp.mkdir(targetDirAbs, { recursive: true });
      const targetFileAbs = resolveDiskPath(targetEndpoint, targetFolderPath, fileName);

      const startPerf = performance.now();
      const chunkSizeBytes = state.defaultChunkSizeBytes || 65536;
      const totalPieces = calculatePieceCount(stat.size, chunkSizeBytes);

      if (sourceFileAbs !== targetFileAbs) {
        await fsp.copyFile(sourceFileAbs, targetFileAbs);
      }

      const elapsedMs = Math.max(1, performance.now() - startPerf);
      const { speedBytesPerSec } = calculateSpeedAndEta(
        stat.size,
        stat.size,
        elapsedMs,
        stat.size,
        elapsedMs
      );
      const sha256 = await computeFileSha256(targetFileAbs, true);

      const job: TransferJob = {
        id: `disk-job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: path.basename(fileName),
        fileSizeBytes: stat.size,
        mimeType: 'application/octet-stream',
        sourceEndpoint,
        targetEndpoint,
        targetFolderPath,
        chunkSizeBytes,
        totalPieces,
        completedPieces: totalPieces,
        bytesTransferred: stat.size,
        status: 'completed',
        startedAtMs: Date.now() - Math.ceil(elapsedMs),
        elapsedMs: Math.ceil(elapsedMs),
        speedBytesPerSec,
        etaSeconds: 0,
        pieceBlocks: buildPieceVisualBlocks(totalPieces, totalPieces, 'completed'),
        checksum: sha256,
      };

      state.jobs = [job, ...state.jobs];
      await refreshDiskState();

      appendLog({
        category: 'transfer',
        level: 'success',
        sourceEndpoint,
        targetEndpoint,
        fileName: job.fileName,
        folderPath: targetFolderPath,
        packetInfo: `${totalPieces}/${totalPieces} pieces (${Math.round(chunkSizeBytes / 1024)} KB)`,
        speedFormatted: formatTransferSpeed(speedBytesPerSec),
        checksum: sha256,
        message: `Transferred "${job.fileName}" (${formatByteSize(
          stat.size
        )}) directly from ${sourceEndpoint.toUpperCase()} disk to ${targetEndpoint.toUpperCase()} disk (${targetFolderPath}).`,
      });

      broadcastState();
      res.status(201).json({ job, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to transfer file between disk drives.',
      });
    }
  });

  // Create a real directory on disk for either Host or Receiver
  app.post('/api/folders', async (req, res) => {
    const { endpoint, parentPath = '/', folderName } = req.body as {
      endpoint?: EndpointRole;
      parentPath?: string;
      folderName?: string;
    };

    if (endpoint !== 'host' && endpoint !== 'receiver') {
      res.status(400).json({ error: 'Endpoint must be host or receiver.' });
      return;
    }

    const validation = validateFolderName(folderName ?? '');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const fullVirtualPath = normalizeFolderPath(parentPath, validation.sanitized);
    try {
      const targetDiskDir = resolveDiskPath(endpoint, fullVirtualPath);
      if (fs.existsSync(targetDiskDir)) {
        res.status(409).json({ error: `Folder "${fullVirtualPath}" already exists on ${endpoint} disk.` });
        return;
      }

      await fsp.mkdir(targetDiskDir, { recursive: true });
      if (endpoint === 'host') {
        activeHostVirtualPath = fullVirtualPath;
      } else {
        activeReceiverVirtualPath = fullVirtualPath;
      }
      await refreshDiskState();

      const createdFolder = state.folders.find(
        (f) => f.endpoint === endpoint && f.path === fullVirtualPath
      );

      appendLog({
        category: 'folder',
        level: 'info',
        sourceEndpoint: endpoint,
        folderPath: fullVirtualPath,
        message: `Created directory "${fullVirtualPath}" on ${
          endpoint === 'host' ? `Host Disk (${hostDiskRoot})` : `Receiver Disk (${receiverDiskRoot})`
        }.`,
      });

      broadcastState();
      res.status(201).json({ folder: createdFolder, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to create directory on disk.',
      });
    }
  });

  // Initialize a batch of real file transfer jobs before streaming binary chunks
  app.post('/api/transfers/init', async (req, res) => {
    const {
      files,
      sourceEndpoint = 'host',
      targetEndpoint = 'receiver',
      targetFolderPath = '/',
      chunkSizeBytes = state.defaultChunkSizeBytes,
      minConcurrency = state.minConcurrency,
    } = req.body as {
      files?: Array<{ clientId: string; name: string; sizeBytes: number; mimeType?: string }>;
      sourceEndpoint?: EndpointRole;
      targetEndpoint?: EndpointRole;
      targetFolderPath?: string;
      chunkSizeBytes?: number;
      minConcurrency?: number;
    };

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Select at least one file to transfer.' });
      return;
    }

    const effectiveConcurrency = Math.max(DEFAULT_MIN_CONCURRENT_FILES, Number(minConcurrency) || 5);
    state.minConcurrency = effectiveConcurrency;
    const safeChunk = Math.max(16384, Number(chunkSizeBytes) || 65536);

    try {
      const targetDirAbs = resolveDiskPath(targetEndpoint, targetFolderPath);
      await fsp.mkdir(targetDirAbs, { recursive: true });

      const createdJobs: TransferJob[] = [];

      for (const f of files) {
        const safeName = path.basename(f.name);
        const sizeBytes = Math.max(0, Number(f.sizeBytes) || 0);
        const totalPieces = calculatePieceCount(sizeBytes, safeChunk);
        const jobId = f.clientId || `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        const partPath = resolveDiskPath(targetEndpoint, targetFolderPath, `${safeName}.part`);
        await fsp.writeFile(partPath, Buffer.alloc(0));

        const job: TransferJob = {
          id: jobId,
          fileName: safeName,
          fileSizeBytes: sizeBytes,
          mimeType: f.mimeType || 'application/octet-stream',
          sourceEndpoint,
          targetEndpoint,
          targetFolderPath,
          chunkSizeBytes: safeChunk,
          totalPieces,
          completedPieces: 0,
          bytesTransferred: 0,
          status: 'queued',
          startedAtMs: null,
          elapsedMs: 0,
          speedBytesPerSec: 0,
          etaSeconds: null,
          pieceBlocks: buildPieceVisualBlocks(0, totalPieces, 'queued'),
          checksum: 'pending-sha256',
        };
        createdJobs.push(job);
      }

      state.jobs = [...createdJobs, ...state.jobs];

      appendLog({
        category: 'chunk',
        level: 'info',
        sourceEndpoint,
        targetEndpoint,
        folderPath: targetFolderPath,
        packetInfo: `${files.length} file(s) · ${Math.round(safeChunk / 1024)} KB pieces`,
        message: `Initialized ${files.length} real file stream(s) to ${targetEndpoint.toUpperCase()} disk (${targetDirAbs}).`,
      });

      broadcastState();
      res.status(201).json({ jobs: createdJobs, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to initialize file transfer.',
      });
    }
  });

  // Upload a real binary packet chunk for a specific transfer job
  app.post('/api/transfers/:id/chunk', async (req, res) => {
    const { id } = req.params;
    const { pieceIndex, totalPieces, offsetBytes, dataBase64, chunkDurationMs } = req.body as {
      pieceIndex?: number;
      totalPieces?: number;
      offsetBytes?: number;
      dataBase64?: string;
      chunkDurationMs?: number;
    };

    const job = state.jobs.find((j) => j.id === id);
    if (!job) {
      res.status(404).json({ error: 'Transfer job not found.' });
      return;
    }

    try {
      const writeStartMs = performance.now();
      const buffer = Buffer.from(dataBase64 || '', 'base64');
      const partPath = resolveDiskPath(
        job.targetEndpoint,
        job.targetFolderPath,
        `${job.fileName}.part`
      );

      const handle = await fsp.open(partPath, 'r+');
      try {
        await handle.write(buffer, 0, buffer.length, Number(offsetBytes) || 0);
      } finally {
        await handle.close();
      }
      const serverWriteMs = Math.max(0.5, performance.now() - writeStartMs);
      const effectiveChunkMs = Math.max(serverWriteMs, Number(chunkDurationMs) || serverWriteMs);

      const nowMs = Date.now();
      if (job.startedAtMs === null) {
        job.startedAtMs = nowMs - Math.ceil(effectiveChunkMs);
      }

      job.status = 'transferring';
      job.completedPieces = Math.min(job.totalPieces, job.completedPieces + 1);
      job.bytesTransferred = Math.min(
        job.fileSizeBytes,
        job.bytesTransferred + buffer.length
      );
      job.elapsedMs = Math.max(1, nowMs - job.startedAtMs);

      const { speedBytesPerSec, etaSeconds } = calculateSpeedAndEta(
        job.bytesTransferred,
        job.fileSizeBytes,
        job.elapsedMs,
        buffer.length,
        effectiveChunkMs
      );
      job.speedBytesPerSec = speedBytesPerSec;
      job.etaSeconds = etaSeconds;

      const isFinalPiece =
        job.completedPieces >= (Number(totalPieces) || job.totalPieces) ||
        job.bytesTransferred >= job.fileSizeBytes;

      if (isFinalPiece) {
        const finalPath = resolveDiskPath(
          job.targetEndpoint,
          job.targetFolderPath,
          job.fileName
        );
        await fsp.rename(partPath, finalPath);
        const sha256 = await computeFileSha256(finalPath, true);
        job.status = 'completed';
        job.completedPieces = job.totalPieces;
        job.bytesTransferred = job.fileSizeBytes;
        job.etaSeconds = 0;
        job.checksum = sha256;
        job.pieceBlocks = buildPieceVisualBlocks(
          job.totalPieces,
          job.totalPieces,
          'completed'
        );

        await refreshDiskState();

        appendLog({
          category: 'transfer',
          level: 'success',
          sourceEndpoint: job.sourceEndpoint,
          targetEndpoint: job.targetEndpoint,
          fileName: job.fileName,
          folderPath: job.targetFolderPath,
          packetInfo: `${job.totalPieces}/${job.totalPieces} pieces (${Math.round(
            job.chunkSizeBytes / 1024
          )} KB)`,
          speedFormatted: formatTransferSpeed(job.speedBytesPerSec),
          checksum: sha256,
          message: `Verified & saved ${job.fileName} (${formatByteSize(
            job.fileSizeBytes
          )}) to ${job.targetEndpoint.toUpperCase()} disk (${finalPath})`,
        });
      } else {
        job.pieceBlocks = buildPieceVisualBlocks(
          job.completedPieces,
          job.totalPieces,
          'transferring'
        );
      }

      broadcastState();
      res.json({
        job,
        pieceIndex,
        completed: isFinalPiece,
      });
    } catch (err) {
      job.status = 'failed';
      broadcastState();
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to write packet chunk.',
      });
    }
  });

  // Download / fetch a real file from the Host or Receiver disk drive
  app.get('/api/files/download', async (req, res) => {
    const endpoint = req.query.endpoint as EndpointRole;
    const folderPath = String(req.query.folderPath || '/');
    const fileName = String(req.query.fileName || '');

    if ((endpoint !== 'host' && endpoint !== 'receiver') || !fileName) {
      res.status(400).json({ error: 'Valid endpoint and fileName are required.' });
      return;
    }

    try {
      const fileAbs = resolveDiskPath(endpoint, folderPath, fileName);
      if (!fs.existsSync(fileAbs)) {
        res.status(404).json({ error: 'File not found on disk.' });
        return;
      }
      res.download(fileAbs, path.basename(fileName));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to download file.',
      });
    }
  });

  // Delete a real file from the Host or Receiver disk drive
  app.delete('/api/files', async (req, res) => {
    const { endpoint, folderPath = '/', fileName } = req.body as {
      endpoint?: EndpointRole;
      folderPath?: string;
      fileName?: string;
    };

    if ((endpoint !== 'host' && endpoint !== 'receiver') || !fileName) {
      res.status(400).json({ error: 'Valid endpoint and fileName are required.' });
      return;
    }

    try {
      const fileAbs = resolveDiskPath(endpoint, folderPath, fileName);
      if (fs.existsSync(fileAbs)) {
        await fsp.unlink(fileAbs);
      }
      await refreshDiskState();
      appendLog({
        category: 'folder',
        level: 'warning',
        sourceEndpoint: endpoint,
        fileName,
        folderPath,
        message: `Deleted file "${fileName}" from ${endpoint.toUpperCase()} disk (${folderPath}).`,
      });
      broadcastState();
      res.json({ state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete file.',
      });
    }
  });

  app.post('/api/transfers/clear-completed', (_req, res) => {
    state.jobs = state.jobs.filter((j) => j.status !== 'completed');
    broadcastState();
    res.json({ state });
  });

  app.post('/api/logs/clear', (_req, res) => {
    state.logs = [];
    appendLog({
      category: 'session',
      level: 'info',
      sourceEndpoint: 'host',
      message: 'Activity log history cleared.',
    });
    broadcastState();
    res.json({ state });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  let reclaimedOnce = false;

  async function tryReclaimPort(portToFree: number): Promise<boolean> {
    let handedOver = false;
    for (const loopbackHost of ['127.0.0.1', 'localhost']) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 350);
        const res = await fetch(`http://${loopbackHost}:${portToFree}/api/server/takeover`, {
          method: 'POST',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          handedOver = true;
        }
      } catch {
        // Instance not listening on this loopback family
      }
    }
    if (handedOver) {
      await new Promise((r) => setTimeout(r, 350));
      return true;
    }

    if (process.platform === 'win32') {
      try {
        const netstatOut = execSync(`netstat -ano | findstr :${portToFree}`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const lines = netstatOut.split(/\r?\n/);
        let killedAny = false;
        for (const line of lines) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = Number(parts[parts.length - 1]);
            if (pid && pid > 0 && pid !== process.pid) {
              try {
                execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                killedAny = true;
              } catch {
                // Ignore individual PID kill failure
              }
            }
          }
        }
        if (killedAny) {
          await new Promise((r) => setTimeout(r, 400));
          return true;
        }
      } catch {
        // Could not automatically terminate Windows PID
      }
    }
    return false;
  }

  // Proactively hand over any stale IPv4 or IPv6 process on activePort before binding
  await tryReclaimPort(activePort);

  server.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      if (!reclaimedOnce) {
        reclaimedOnce = true;
        console.log(`Port ${activePort} is currently in use by an earlier session. Attempting to reclaim port ${activePort}...`);
        const freed = await tryReclaimPort(activePort);
        if (freed) {
          server.listen(activePort);
          return;
        }
      }

      const nextPort = activePort + 1;
      console.log(`Port ${activePort} is busy. Automatically switching to port ${nextPort}...`);
      activePort = nextPort;
      state.nodeInfo = detectSystemNodeInfo(activePort, state.nodeInfo.customNetworkIp);
      server.listen(activePort);
      return;
    }
    console.error('Server error:', err);
  });

  server.listen(activePort, () => {
    state.nodeInfo = detectSystemNodeInfo(activePort, state.nodeInfo.customNetworkIp);
    console.log('\n============================================================');
    console.log('PacketBridge Wi-Fi & Hotspot File Transfer Server Ready!');
    console.log(`  • Local Browser (This PC):     http://localhost:${activePort}`);
    console.log(`  • Network IP (Wi-Fi/Hotspot):  ${state.nodeInfo.activeNetworkUrl}`);
    for (const iface of state.nodeInfo.interfaces) {
      console.log(`  • Interface [${iface.name}]:   ${iface.url}`);
    }
    console.log('============================================================\n');
  });
}

startServer();
