import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
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
  formatByteSize,
  formatTransferSpeed,
  DEFAULT_MIN_CONCURRENT_FILES,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
  type TransferJob,
  type ActivityLogEntry,
} from './src/utils/transferEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, 'storage');
const HOST_STORAGE = path.join(STORAGE_ROOT, 'host');
const RECEIVER_STORAGE = path.join(STORAGE_ROOT, 'receiver');

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
}

interface ServerState {
  nodeInfo: SystemNodeInfo;
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

function detectSystemNodeInfo(port: number, customIp: string | null = null): SystemNodeInfo {
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

  // Prioritize real Wi-Fi/Hotspot/LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x) ahead of link-local 169.254.x.x
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

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    arch: os.arch(),
    lanAddresses,
    interfaces,
    activeNetworkUrl,
    customNetworkIp: customIp,
    port,
  };
}

function resolveDiskPath(endpoint: EndpointRole, virtualFolderPath: string, fileName?: string): string {
  const baseDir = endpoint === 'host' ? HOST_STORAGE : RECEIVER_STORAGE;
  const normalizedVirtual = path.posix
    .normalize('/' + virtualFolderPath.replace(/\\/g, '/'))
    .replace(/^\/+/, '');
  const folderAbs = path.resolve(baseDir, normalizedVirtual);
  if (!folderAbs.startsWith(baseDir)) {
    throw new Error('Invalid folder path outside storage root');
  }
  if (!fileName) return folderAbs;
  const safeFile = path.basename(fileName);
  const fileAbs = path.resolve(folderAbs, safeFile);
  if (!fileAbs.startsWith(baseDir)) {
    throw new Error('Invalid file path outside storage root');
  }
  return fileAbs;
}

async function computeFileSha256(filePath: string): Promise<string> {
  const buffer = await fsp.readFile(filePath);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

async function scanEndpointStorage(
  endpoint: EndpointRole
): Promise<{ folders: FolderNode[]; files: TransferredFileRecord[] }> {
  const baseDir = endpoint === 'host' ? HOST_STORAGE : RECEIVER_STORAGE;
  await fsp.mkdir(baseDir, { recursive: true });

  const folders: FolderNode[] = [];
  const files: TransferredFileRecord[] = [];

  async function walk(currentAbs: string, virtualPath: string, parentVirtual: string) {
    const entries = await fsp.readdir(currentAbs, { withFileTypes: true });
    const dirFiles = entries.filter((e) => e.isFile() && !e.name.endsWith('.part'));
    const stat = await fsp.stat(currentAbs);

    folders.push({
      id: `fld-${endpoint}-${virtualPath}`,
      endpoint,
      name: virtualPath === '/' ? 'Root (/)' : path.posix.basename(virtualPath),
      path: virtualPath,
      parentPath: parentVirtual,
      createdAt: stat.birthtime.toISOString().slice(11, 19),
      fileCount: dirFiles.length,
    });

    for (const fileEntry of dirFiles) {
      const fileAbs = path.join(currentAbs, fileEntry.name);
      const fileStat = await fsp.stat(fileAbs);
      const checksum = await computeFileSha256(fileAbs);
      files.push({
        id: `file-${endpoint}-${virtualPath}-${fileEntry.name}`,
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
    }

    for (const subEntry of entries) {
      if (subEntry.isDirectory()) {
        const nextVirtual =
          virtualPath === '/' ? `/${subEntry.name}` : `${virtualPath}/${subEntry.name}`;
        await walk(path.join(currentAbs, subEntry.name), nextVirtual, virtualPath);
      }
    }
  }

  await walk(baseDir, '/', '/');
  return { folders, files };
}

const PORT = Number(process.env.PORT) || 3000;

const state: ServerState = {
  nodeInfo: detectSystemNodeInfo(PORT),
  minConcurrency: DEFAULT_MIN_CONCURRENT_FILES,
  defaultChunkSizeBytes: 65536,
  folders: [],
  completedFiles: [],
  jobs: [],
  logs: [],
};

async function refreshDiskState() {
  const hostScan = await scanEndpointStorage('host');
  const receiverScan = await scanEndpointStorage('receiver');
  state.folders = [...hostScan.folders, ...receiverScan.folders];
  state.completedFiles = [...hostScan.files, ...receiverScan.files];
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
  await fsp.mkdir(HOST_STORAGE, { recursive: true });
  await fsp.mkdir(RECEIVER_STORAGE, { recursive: true });
  await refreshDiskState();

  appendLog({
    category: 'session',
    level: 'info',
    sourceEndpoint: 'host',
    message: `Storage initialized at ${STORAGE_ROOT} on ${state.nodeInfo.hostname} (${state.nodeInfo.lanAddresses.join(', ')}:${PORT}).`,
  });

  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

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

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'state:sync',
        state,
      })
    );
  });

  app.get('/api/state', async (_req, res) => {
    await refreshDiskState();
    res.json(state);
  });

  // Configure or switch the active Network IP address for LAN / Hotspot access
  app.post('/api/network/config', (req, res) => {
    const { networkIp } = req.body as { networkIp?: string };
    const validation = validateNetworkAddress(networkIp ?? '', PORT);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    state.nodeInfo = detectSystemNodeInfo(PORT, validation.hostPort);

    appendLog({
      category: 'session',
      level: 'info',
      sourceEndpoint: 'host',
      message: `Updated active Network IP access address to ${state.nodeInfo.activeNetworkUrl}`,
    });

    broadcastState();
    res.json({ nodeInfo: state.nodeInfo, state });
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
        res.status(409).json({ error: `Folder "${fullVirtualPath}" already exists on ${endpoint}.` });
        return;
      }

      await fsp.mkdir(targetDiskDir, { recursive: true });
      await refreshDiskState();

      const createdFolder = state.folders.find(
        (f) => f.endpoint === endpoint && f.path === fullVirtualPath
      );

      appendLog({
        category: 'folder',
        level: 'info',
        sourceEndpoint: endpoint,
        folderPath: fullVirtualPath,
        message: `Created directory "${fullVirtualPath}" on ${endpoint === 'host' ? 'Host Storage' : 'Receiver Storage'}.`,
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

        // Pre-allocate or truncate temporary .part file on disk
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
        message: `Initialized ${files.length} real file stream(s) to ${targetEndpoint.toUpperCase()}:${targetFolderPath} (concurrency: ${effectiveConcurrency} parallel streams).`,
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

      // Write binary packet at exact byte offset
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
        const sha256 = await computeFileSha256(finalPath);
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
          )}) to ${job.targetEndpoint.toUpperCase()}:${job.targetFolderPath}`,
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

  // Download a real transferred file from disk
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

  // Delete a real file from disk
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
        message: `Deleted file "${fileName}" from ${endpoint.toUpperCase()}:${folderPath}.`,
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n============================================================');
    console.log('PacketBridge Wi-Fi & Hotspot File Transfer Server Ready!');
    console.log(`  • Local Browser (This PC):     http://localhost:${PORT}`);
    console.log(`  • Network IP (Wi-Fi/Hotspot):  ${state.nodeInfo.activeNetworkUrl}`);
    for (const iface of state.nodeInfo.interfaces) {
      console.log(`  • Interface [${iface.name}]:   ${iface.url}`);
    }
    console.log('============================================================\n');
  });
}

startServer();
