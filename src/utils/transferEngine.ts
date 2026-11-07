export type EndpointRole = 'host' | 'receiver';

export type DeviceOS = 'Windows 11 Workstation' | 'macOS Sequoia Studio' | 'Android 15 Hotspot Node';

export type TransferStatus = 'queued' | 'transferring' | 'paused' | 'completed' | 'failed';

export type PieceState = 0 | 1 | 2; // 0 = pending, 1 = in-flight, 2 = verified

export interface FolderNode {
  id: string;
  endpoint: EndpointRole;
  name: string;
  path: string;
  parentPath: string;
  createdAt: string;
  fileCount: number;
}

export interface TransferredFileRecord {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  sourceEndpoint: EndpointRole;
  targetEndpoint: EndpointRole;
  targetFolderPath: string;
  chunkSizeBytes: number;
  totalPieces: number;
  checksum: string;
  completedAt: string;
}

export interface TransferJob {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  sourceEndpoint: EndpointRole;
  targetEndpoint: EndpointRole;
  targetFolderPath: string;
  chunkSizeBytes: number;
  totalPieces: number;
  completedPieces: number;
  bytesTransferred: number;
  status: TransferStatus;
  startedAtMs: number | null;
  elapsedMs: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  pieceBlocks: PieceState[]; // 24 visual blocks representing torrent-style packet pieces
  checksum: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: 'transfer' | 'chunk' | 'folder' | 'session';
  level: 'info' | 'success' | 'warning';
  sourceEndpoint: EndpointRole;
  targetEndpoint?: EndpointRole;
  fileName?: string;
  folderPath?: string;
  packetInfo?: string;
  speedFormatted?: string;
  checksum?: string;
  message: string;
}

export const DEFAULT_MIN_CONCURRENT_FILES = 5;
export const VISUAL_PIECE_BLOCK_COUNT = 24;

export function calculatePieceCount(fileSizeBytes: number, chunkSizeBytes: number): number {
  if (fileSizeBytes <= 0) return 1;
  const safeChunk = Math.max(1024, chunkSizeBytes);
  return Math.max(1, Math.ceil(fileSizeBytes / safeChunk));
}

export function calculateProgressPercentage(completedPieces: number, totalPieces: number): number {
  if (totalPieces <= 0) return 0;
  const clamped = Math.min(totalPieces, Math.max(0, completedPieces));
  return Math.round((clamped / totalPieces) * 100);
}

export function buildPieceVisualBlocks(
  completedPieces: number,
  totalPieces: number,
  status: TransferStatus,
  blockCount: number = VISUAL_PIECE_BLOCK_COUNT
): PieceState[] {
  const blocks: PieceState[] = [];
  if (totalPieces <= 0) {
    return Array.from({ length: blockCount }, () => 0);
  }
  if (status === 'completed' || completedPieces >= totalPieces) {
    return Array.from({ length: blockCount }, () => 2);
  }

  const ratio = Math.min(1, Math.max(0, completedPieces / totalPieces));
  const verifiedBlocks = Math.floor(ratio * blockCount);
  const hasInFlight = status === 'transferring' && verifiedBlocks < blockCount;

  for (let i = 0; i < blockCount; i++) {
    if (i < verifiedBlocks) {
      blocks.push(2);
    } else if (i === verifiedBlocks && hasInFlight) {
      blocks.push(1);
    } else {
      blocks.push(0);
    }
  }
  return blocks;
}

export function calculateSpeedAndEta(
  bytesTransferred: number,
  totalBytes: number,
  elapsedMs: number,
  lastChunkBytes?: number,
  lastChunkDurationMs?: number
): { speedBytesPerSec: number; etaSeconds: number | null } {
  if (bytesTransferred <= 0) {
    return { speedBytesPerSec: 0, etaSeconds: null };
  }

  const safeElapsedSec = Math.max(0.001, elapsedMs / 1000);
  const averageSpeedBytesPerSec = Math.round(bytesTransferred / safeElapsedSec);

  let effectiveSpeed = averageSpeedBytesPerSec;
  if (
    typeof lastChunkBytes === 'number' &&
    lastChunkBytes > 0 &&
    typeof lastChunkDurationMs === 'number' &&
    lastChunkDurationMs > 0
  ) {
    const instantSpeed = Math.round(lastChunkBytes / Math.max(0.0005, lastChunkDurationMs / 1000));
    // Blend 60% instantaneous chunk throughput with 40% cumulative average for responsive real-time readout
    effectiveSpeed = Math.round(instantSpeed * 0.6 + averageSpeedBytesPerSec * 0.4);
  }

  if (bytesTransferred >= totalBytes && totalBytes > 0) {
    return {
      speedBytesPerSec: Math.max(1, effectiveSpeed),
      etaSeconds: 0,
    };
  }

  if (effectiveSpeed <= 0) {
    return { speedBytesPerSec: 0, etaSeconds: null };
  }

  const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
  const etaSeconds = Math.max(1, Math.ceil(remainingBytes / effectiveSpeed));
  return { speedBytesPerSec: effectiveSpeed, etaSeconds };
}

export function calculateAggregateTransferSpeed(jobs: TransferJob[]): number {
  const activeJobs = jobs.filter((job) => job.status === 'transferring');
  if (activeJobs.length > 0) {
    return activeJobs.reduce((sum, job) => sum + Math.max(0, job.speedBytesPerSec), 0);
  }
  return 0;
}

export function formatTransferSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '0.00 MB/s';
  }
  const mbPerSec = bytesPerSec / (1024 * 1024);
  if (mbPerSec >= 0.1) {
    return `${mbPerSec >= 100 ? Math.round(mbPerSec) : mbPerSec.toFixed(2)} MB/s`;
  }
  const kbPerSec = bytesPerSec / 1024;
  if (kbPerSec >= 1) {
    return `${kbPerSec.toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

/**
 * Schedules queued transfers so that at least `minConcurrency` (5 by default)
 * files transfer simultaneously whenever multiple files are queued.
 */
export function scheduleConcurrentTransfers(
  jobs: TransferJob[],
  minConcurrency: number = DEFAULT_MIN_CONCURRENT_FILES,
  nowMs: number = Date.now()
): TransferJob[] {
  const concurrencyLimit = Math.max(DEFAULT_MIN_CONCURRENT_FILES, minConcurrency);
  let activeCount = jobs.filter((job) => job.status === 'transferring').length;

  return jobs.map((job) => {
    if (job.status === 'queued' && activeCount < concurrencyLimit) {
      activeCount += 1;
      return {
        ...job,
        status: 'transferring',
        startedAtMs: job.startedAtMs ?? nowMs,
        pieceBlocks: buildPieceVisualBlocks(job.completedPieces, job.totalPieces, 'transferring'),
      };
    }
    return job;
  });
}

export function advanceActiveTransfers(
  jobs: TransferJob[],
  tickMs: number,
  packetsPerTickPerJob: number = 3,
  minConcurrency: number = DEFAULT_MIN_CONCURRENT_FILES
): {
  updatedJobs: TransferJob[];
  newlyCompletedJobs: TransferJob[];
} {
  const newlyCompletedJobs: TransferJob[] = [];

  const stepped = jobs.map((job) => {
    if (job.status !== 'transferring') {
      return job;
    }

    const nextCompletedPieces = Math.min(
      job.totalPieces,
      job.completedPieces + Math.max(1, packetsPerTickPerJob)
    );
    const nextElapsedMs = job.elapsedMs + Math.max(1, tickMs);
    const isNowComplete = nextCompletedPieces >= job.totalPieces;
    const nextBytesTransferred = isNowComplete
      ? job.fileSizeBytes
      : Math.min(job.fileSizeBytes, nextCompletedPieces * job.chunkSizeBytes);

    const { speedBytesPerSec, etaSeconds } = calculateSpeedAndEta(
      nextBytesTransferred,
      job.fileSizeBytes,
      nextElapsedMs
    );

    const nextStatus: TransferStatus = isNowComplete ? 'completed' : 'transferring';
    const updatedJob: TransferJob = {
      ...job,
      completedPieces: nextCompletedPieces,
      bytesTransferred: nextBytesTransferred,
      elapsedMs: nextElapsedMs,
      speedBytesPerSec,
      etaSeconds,
      status: nextStatus,
      pieceBlocks: buildPieceVisualBlocks(nextCompletedPieces, job.totalPieces, nextStatus),
    };

    if (isNowComplete) {
      newlyCompletedJobs.push(updatedJob);
    }

    return updatedJob;
  });

  // Immediately promote queued jobs so 5+ files remain concurrently active
  const scheduled = scheduleConcurrentTransfers(stepped, minConcurrency);
  return {
    updatedJobs: scheduled,
    newlyCompletedJobs,
  };
}

export function validateFolderName(rawName: string): { valid: boolean; error?: string; sanitized: string } {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { valid: false, error: 'Folder name cannot be empty.', sanitized: '' };
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return {
      valid: false,
      error: 'Folder name cannot contain slashes or relative path segments.',
      sanitized: '',
    };
  }
  if (!/^[a-zA-Z0-9._\-\s()]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Use letters, numbers, spaces, hyphens, underscores, or periods.',
      sanitized: '',
    };
  }
  return { valid: true, sanitized: trimmed };
}

export function normalizeFolderPath(parentPath: string, folderName: string): string {
  const cleanParent = parentPath.trim().replace(/\/+$/, '') || '';
  const cleanName = folderName.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanName) return cleanParent || '/';
  return `${cleanParent}/${cleanName}`.replace(/\/+/g, '/');
}

export function formatByteSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatEtaSeconds(etaSeconds: number | null): string {
  if (etaSeconds === null) return 'Calculating...';
  if (etaSeconds <= 0) return 'Completed';
  if (etaSeconds < 60) return `${etaSeconds}s remaining`;
  const mins = Math.floor(etaSeconds / 60);
  const secs = etaSeconds % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export function computeDeterministicChecksum(fileName: string, sizeBytes: number): string {
  let hash = 2166136261;
  const input = `${fileName}:${sizeBytes}:packetbridge`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `sha256:${hex}${hex.split('').reverse().join('')}`;
}

export function rankLanIpv4Address(ip: string): number {
  const trimmed = ip.trim();
  if (trimmed.startsWith('192.168.')) return 1;
  if (trimmed.startsWith('10.')) return 2;
  const parts = trimmed.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 2;
  if (trimmed.startsWith('169.254.')) return 4;
  if (trimmed.startsWith('127.') || trimmed === 'localhost' || trimmed === '0.0.0.0') return 5;
  return 3;
}

export function formatNetworkAccessUrl(ipOrHost: string, defaultPort: number = 3000): string {
  const trimmed = ipOrHost
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/^0\.0\.0\.0(?=:|$)/, 'localhost');
  if (!trimmed) return `http://localhost:${defaultPort}`;
  if (trimmed.includes(':')) {
    return `http://${trimmed}`;
  }
  return `http://${trimmed}:${defaultPort}`;
}

export function validateNetworkAddress(
  rawInput: string,
  defaultPort: number = 3000
): { valid: boolean; hostPort: string; url: string; error?: string } {
  const cleaned = rawInput
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

  if (!cleaned) {
    return {
      valid: false,
      hostPort: '',
      url: '',
      error: 'Please enter a valid Network IP address (e.g. 192.168.1.25).',
    };
  }

  const [hostPart, portPart] = cleaned.split(':');
  if (hostPart === '0.0.0.0') {
    return {
      valid: false,
      hostPort: '',
      url: '',
      error:
        '0.0.0.0 is a server bind address and cannot be opened in a browser on Windows. Use localhost or your Wi-Fi IPv4 address (e.g. 192.168.1.25).',
    };
  }

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostnameRegex = /^[a-zA-Z0-9.-]+$/;

  if (ipv4Regex.test(hostPart)) {
    const octets = hostPart.split('.').map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return {
        valid: false,
        hostPort: '',
        url: '',
        error: 'Each IPv4 octet must be between 0 and 255.',
      };
    }
  } else if (!hostnameRegex.test(hostPart)) {
    return {
      valid: false,
      hostPort: '',
      url: '',
      error: 'Enter a valid IPv4 address (e.g. 192.168.1.25) or local hostname.',
    };
  }

  let finalPort = defaultPort;
  if (portPart !== undefined) {
    const parsedPort = Number(portPart);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return {
        valid: false,
        hostPort: '',
        url: '',
        error: 'Port must be a number between 1 and 65535.',
      };
    }
    finalPort = parsedPort;
  }

  const hostPort = `${hostPart}:${finalPort}`;
  return {
    valid: true,
    hostPort,
    url: `http://${hostPort}`,
  };
}

export interface DiskDrivePreset {
  id: string;
  label: string;
  path: string;
  kind: 'drive' | 'system' | 'app';
}

export interface LobbyPeer {
  peerId: string;
  name: string;
  ipAddress: string;
  platform: string;
  role: EndpointRole;
  joinedAt: string;
  lastSeenMs: number;
  connected: boolean;
  receiverDiskLabel: string;
  receiverDiskPath: string;
  receiverFileCount: number;
}

export function normalizeClientIp(rawIp: string): string {
  const trimmed = (rawIp || '').trim();
  if (!trimmed) return '127.0.0.1';
  const firstForwarded = trimmed.split(',')[0].trim();
  if (firstForwarded === '::1' || firstForwarded === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }
  if (firstForwarded.startsWith('::ffff:')) {
    return firstForwarded.slice(7);
  }
  return firstForwarded;
}

export function sanitizePeerId(rawId: string): string {
  const cleaned = (rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48);
  return cleaned || 'default-receiver';
}

export function filterEndpointDiskData(
  folders: FolderNode[],
  files: TransferredFileRecord[],
  endpoint: EndpointRole
): { endpointFolders: FolderNode[]; endpointFiles: TransferredFileRecord[] } {
  return {
    endpointFolders: folders.filter((f) => f.endpoint === endpoint),
    endpointFiles: files.filter((f) => f.targetEndpoint === endpoint),
  };
}

export function getJoinedReceiverPeers(peers: LobbyPeer[]): LobbyPeer[] {
  return peers
    .filter((p) => p.role === 'receiver' && p.connected)
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

export function getParentVirtualPath(virtualPath: string): string {
  const cleaned = virtualPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!cleaned || cleaned === '/') return '/';
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return cleaned.slice(0, lastSlash);
}

export function validateDiskMountInput(rawDiskPath: string): {
  valid: boolean;
  trimmed: string;
  error?: string;
} {
  const trimmed = rawDiskPath.trim();
  if (!trimmed) {
    return {
      valid: false,
      trimmed: '',
      error: 'Please enter a valid disk drive or folder path (e.g. C:\\Users\\Public or D:\\).',
    };
  }
  if (/[\0<>|?*]/.test(trimmed)) {
    return {
      valid: false,
      trimmed: '',
      error: 'Disk path contains invalid characters.',
    };
  }
  return { valid: true, trimmed };
}
