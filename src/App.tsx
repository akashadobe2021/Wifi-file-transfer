/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Laptop, Smartphone, Users } from 'lucide-react';
import { TopBar, type ActiveSection } from './components/TopBar';
import { DualFolderExplorer, type SystemNodeInfo } from './components/DualFolderExplorer';
import { TransferQueuePanel } from './components/TransferQueuePanel';
import { ActivityLogPanel } from './components/ActivityLogPanel';
import { NetworkAccessPanel } from './components/NetworkAccessPanel';
import { LobbyScreen } from './components/LobbyScreen';
import {
  calculatePieceCount,
  formatByteSize,
  getJoinedReceiverPeers,
  DEFAULT_MIN_CONCURRENT_FILES,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
  type TransferJob,
  type ActivityLogEntry,
  type LobbyPeer,
} from './utils/transferEngine';

interface AppServerState {
  nodeInfo: SystemNodeInfo;
  peers?: LobbyPeer[];
  activePairedPeerId?: string | null;
  folders: FolderNode[];
  completedFiles: TransferredFileRecord[];
  jobs: TransferJob[];
  logs: ActivityLogEntry[];
  minConcurrency: number;
  defaultChunkSizeBytes: number;
}

function detectClientPlatform(): string {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'Android Device';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS Device';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS Device';
  if (/windows/i.test(ua)) return 'Windows Device';
  if (/linux/i.test(ua)) return 'Linux Device';
  return navigator.platform || 'Connected Device';
}

function getOrCreateTabPeerId(): string {
  const hostname = window.location.hostname || 'localhost';
  const isLanIpHost = hostname !== 'localhost' && hostname !== '127.0.0.1';
  const prefix = isLanIpHost ? 'recv' : 'peer';
  const storageKey = `packetbridge_peer_id_${window.location.host}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing && (!isLanIpHost || existing.startsWith('recv-'))) {
      return existing;
    }
    const created = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `${prefix}-${Date.now().toString(36)}`;
  }
}

function detectInitialPreferredRole(): EndpointRole | undefined {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');
  if (roleParam === 'receiver' || roleParam === 'host') {
    return roleParam;
  }
  const hostname = window.location.hostname;
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return 'receiver';
  }
  return undefined;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkStep = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkStep) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkStep));
  }
  return btoa(binary);
}

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('workspace');
  const [nodeInfo, setNodeInfo] = useState<SystemNodeInfo | null>(null);
  const [clientPlatform] = useState<string>(() => detectClientPlatform());
  const [clientPeerId] = useState<string>(() => getOrCreateTabPeerId());
  const receiverPeerId = clientPeerId.startsWith('recv-')
    ? clientPeerId
    : `recv-${clientPeerId}`;
  const [clientRole, setClientRole] = useState<EndpointRole>(
    () => detectInitialPreferredRole() || 'host'
  );
  const hasManualRoleChoiceRef = useRef<boolean>(Boolean(detectInitialPreferredRole()));

  const [peers, setPeers] = useState<LobbyPeer[]>([]);
  const [activePairedPeerId, setActivePairedPeerId] = useState<string | null>(null);
  const [showLobbyOverride, setShowLobbyOverride] = useState<boolean>(false);

  const [selectedHostFolder, setSelectedHostFolder] = useState<string>('/');
  const [selectedReceiverFolder, setSelectedReceiverFolder] = useState<string>('/');

  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [completedFiles, setCompletedFiles] = useState<TransferredFileRecord[]>([]);
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [minConcurrency, setMinConcurrency] = useState<number>(DEFAULT_MIN_CONCURRENT_FILES);
  const [chunkSizeBytes, setChunkSizeBytes] = useState<number>(65536);
  const [pausedJobIds, setPausedJobIds] = useState<Set<string>>(new Set());

  const pausedJobsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyServerState = (next: AppServerState) => {
    if (next.nodeInfo) setNodeInfo(next.nodeInfo);
    if (Array.isArray(next.peers)) {
      setPeers(next.peers);
      if (!hasManualRoleChoiceRef.current) {
        const myPeer = next.peers.find(
          (p) => p.peerId === clientPeerId || p.peerId === receiverPeerId
        );
        if (myPeer) {
          setClientRole(myPeer.role);
        }
      }
    }
    if (next.activePairedPeerId !== undefined) {
      setActivePairedPeerId(next.activePairedPeerId);
      if (next.activePairedPeerId) {
        setShowLobbyOverride(false);
      }
    }
    setFolders(next.folders || []);
    setCompletedFiles(next.completedFiles || []);
    setJobs(next.jobs || []);
    setLogs(next.logs || []);
  };

  const fetchLatestLobbyState = async () => {
    try {
      const res = await fetch(`/api/state?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data: AppServerState = await res.json();
        applyServerState(data);
      }
    } catch {
      // Ignore transient network error
    }
  };

  useEffect(() => {
    const preferredRole = detectInitialPreferredRole();
    const initialPeerId = preferredRole === 'receiver' ? receiverPeerId : clientPeerId;

    fetch('/api/lobby/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        peerId: initialPeerId,
        platform: clientPlatform,
        preferredRole,
        accessHost: window.location.host,
      }),
    })
      .then((res) => res.json())
      .then((data: { peer?: LobbyPeer; state?: AppServerState }) => {
        if (data.peer && !hasManualRoleChoiceRef.current) {
          setClientRole(data.peer.role);
        }
        if (data.state) {
          applyServerState(data.state);
        }
      })
      .catch(() => {
        fetchLatestLobbyState();
      });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?peerId=${encodeURIComponent(
      initialPeerId
    )}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'state:sync' && parsed.state) {
            applyServerState(parsed.state);
          }
        } catch {
          // Ignore malformed WS frames
        }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connectWs, 1500);
      };
    };

    connectWs();

    // Poll /api/state with cache-busting every 1.5 seconds as a rock-solid sync across localhost & LAN IP
    const pollInterval = setInterval(() => {
      fetchLatestLobbyState();
    }, 1500);

    const handleWindowFocus = () => {
      fetchLatestLobbyState();
    };
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [clientPeerId, receiverPeerId, clientPlatform]);

  const handleSwitchClientRole = async (nextRole: EndpointRole) => {
    hasManualRoleChoiceRef.current = true;
    setClientRole(nextRole);

    if (nextRole === 'receiver') {
      try {
        const res = await fetch('/api/lobby/update-peer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            peerId: receiverPeerId,
            role: 'receiver',
            platform: clientPlatform,
            accessHost: window.location.host,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          applyServerState(data.state);
        }
      } catch {
        // Ignore transient network error
      }
    } else {
      await fetchLatestLobbyState();
    }
  };

  const handleUpdatePeerProfile = async (name: string, receiverDiskLabel?: string) => {
    hasManualRoleChoiceRef.current = true;
    try {
      const res = await fetch('/api/lobby/update-peer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          peerId: receiverPeerId,
          name,
          role: 'receiver',
          platform: clientPlatform,
          accessHost: window.location.host,
          receiverDiskLabel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        applyServerState(data.state);
      }
    } catch {
      // Ignore error
    }
  };

  const handleRegisterLocalReceiverPeer = async (customName?: string) => {
    const newReceiverId = `receiver-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const defaultIp = nodeInfo?.lanAddresses?.[0] || '192.168.1.42';
    const receiverName = customName || `Joined User (${defaultIp})`;

    try {
      const res = await fetch('/api/lobby/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: newReceiverId,
          name: receiverName,
          platform: 'Wi-Fi / Network IP Device',
          preferredRole: 'receiver',
          accessHost: defaultIp,
          receiverDiskLabel: `${receiverName} Local Disk (/)`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        applyServerState(data.state);
      }
    } catch {
      // Ignore error
    }
  };

  const handleSelectLobbyPeer = async (peerId: string) => {
    try {
      const res = await fetch('/api/lobby/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowLobbyOverride(false);
        setSelectedReceiverFolder('/');
        applyServerState(data.state);
      }
    } catch {
      // Ignore error
    }
  };

  const handleReturnToLobby = async () => {
    setShowLobbyOverride(true);
    try {
      const res = await fetch('/api/lobby/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: null }),
      });
      if (res.ok) {
        const data = await res.json();
        applyServerState(data.state);
      }
    } catch {
      // Ignore error
    }
  };

  const handleSelectFolder = async (endpoint: EndpointRole, folderPath: string) => {
    if (endpoint === 'host') {
      setSelectedHostFolder(folderPath);
    } else {
      setSelectedReceiverFolder(folderPath);
    }

    try {
      const res = await fetch('/api/storage/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, folderPath }),
      });
      if (res.ok) {
        const data = await res.json();
        applyServerState(data.state);
      }
    } catch {
      // Ignore transient navigation error
    }
  };

  const handleMountDiskPath = async (
    endpoint: EndpointRole,
    diskPath: string
  ): Promise<{ ok: boolean; error?: string; diskRoot?: string }> => {
    try {
      const res = await fetch('/api/storage/mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, diskPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to mount disk drive.' };
      }
      applyServerState(data.state);
      if (endpoint === 'host') {
        setSelectedHostFolder('/');
      } else {
        setSelectedReceiverFolder('/');
      }
      return { ok: true, diskRoot: data.diskRoot };
    } catch {
      return { ok: false, error: 'Failed to reach local server.' };
    }
  };

  const handleTransferDiskFile = async (
    sourceEndpoint: EndpointRole,
    sourceFolderPath: string,
    fileName: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const targetEndpoint: EndpointRole = sourceEndpoint === 'host' ? 'receiver' : 'host';
    const targetFolderPath =
      targetEndpoint === 'host' ? selectedHostFolder : selectedReceiverFolder;

    try {
      const res = await fetch('/api/files/transfer-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceEndpoint,
          sourceFolderPath,
          fileName,
          targetEndpoint,
          targetFolderPath,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Could not transfer disk file.' };
      }
      applyServerState(data.state);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Failed to reach local server.' };
    }
  };

  const handleCreateFolder = async (
    endpoint: EndpointRole,
    parentPath: string,
    folderName: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, parentPath, folderName }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to create folder.' };
      }
      applyServerState(data.state);
      if (data.folder?.path) {
        handleSelectFolder(endpoint, data.folder.path);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error communicating with local relay.' };
    }
  };

  const handleDeleteFile = async (
    endpoint: EndpointRole,
    folderPath: string,
    fileName: string
  ) => {
    const res = await fetch('/api/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, folderPath, fileName }),
    });
    if (res.ok) {
      const data = await res.json();
      applyServerState(data.state);
    }
  };

  const handleTogglePauseJob = (jobId: string) => {
    setPausedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      pausedJobsRef.current = next;
      return next;
    });
  };

  const handleUploadRealFiles = async (
    selectedFiles: File[],
    sourceEndpoint: EndpointRole,
    targetEndpoint: EndpointRole,
    targetFolderPath: string
  ) => {
    if (selectedFiles.length === 0) return;

    const currentChunkSize = chunkSizeBytes;
    const currentConcurrency = Math.max(DEFAULT_MIN_CONCURRENT_FILES, minConcurrency);

    const fileEntries = selectedFiles.map((file, idx) => ({
      clientId: `job-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
    }));

    const initRes = await fetch('/api/transfers/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: fileEntries.map((f) => ({
          clientId: f.clientId,
          name: f.name,
          sizeBytes: f.sizeBytes,
          mimeType: f.mimeType,
        })),
        sourceEndpoint,
        targetEndpoint,
        targetFolderPath,
        chunkSizeBytes: currentChunkSize,
        minConcurrency: currentConcurrency,
      }),
    });

    if (!initRes.ok) return;
    const initData = await initRes.json();
    applyServerState(initData.state);

    let cursor = 0;

    const uploadSingleFileInChunks = async (entry: (typeof fileEntries)[number]) => {
      const { clientId, file } = entry;
      const totalPieces = calculatePieceCount(file.size, currentChunkSize);
      let lastChunkCompletedPerfMs = performance.now();

      for (let pieceIndex = 0; pieceIndex < totalPieces; pieceIndex++) {
        while (pausedJobsRef.current.has(clientId)) {
          await new Promise((r) => setTimeout(r, 200));
          lastChunkCompletedPerfMs = performance.now();
        }

        const sliceStartPerfMs = performance.now();
        const offsetBytes = pieceIndex * currentChunkSize;
        const endByte = Math.min(file.size, offsetBytes + currentChunkSize);
        const blobSlice = file.slice(offsetBytes, endByte);
        const buffer = await blobSlice.arrayBuffer();
        const dataBase64 = arrayBufferToBase64(buffer);
        const chunkDurationMs = Math.max(
          0.5,
          performance.now() - Math.min(lastChunkCompletedPerfMs, sliceStartPerfMs)
        );

        await fetch(`/api/transfers/${encodeURIComponent(clientId)}/chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceIndex,
            totalPieces,
            offsetBytes,
            dataBase64,
            chunkDurationMs,
          }),
        });
        lastChunkCompletedPerfMs = performance.now();
      }
    };

    const workerCount = Math.min(fileEntries.length, currentConcurrency);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < fileEntries.length) {
        const index = cursor;
        cursor += 1;
        await uploadSingleFileInChunks(fileEntries[index]);
      }
    });

    await Promise.all(workers);
  };

  const handleSyncReceiverLocalFolder = async (folderLabel: string, files: File[]) => {
    const targetPeerId = activePairedPeerId || clientPeerId;
    await fetch('/api/lobby/update-peer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerId: targetPeerId,
        role: 'receiver',
        platform: clientPlatform,
        accessHost: window.location.host,
        receiverDiskLabel: folderLabel,
      }),
    });
    if (files.length > 0) {
      await handleUploadRealFiles(files, 'receiver', 'receiver', selectedReceiverFolder);
    }
  };

  const handleClearCompleted = async () => {
    const res = await fetch('/api/transfers/clear-completed', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      applyServerState(data.state);
    }
  };

  const handleClearLogs = async () => {
    const res = await fetch('/api/logs/clear', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      applyServerState(data.state);
    }
  };

  const handleUpdateNetworkIp = async (
    networkIp: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/network/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkIp }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Could not update Network IP.' };
      }
      applyServerState(data.state);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Failed to reach local server.' };
    }
  };

  const currentPeer =
    (clientRole === 'receiver'
      ? peers.find((p) => p.peerId === receiverPeerId || p.peerId === clientPeerId)
      : peers.find((p) => p.peerId === clientPeerId)) || null;
  const activePairedPeer = peers.find((p) => p.peerId === activePairedPeerId) || null;
  const joinedReceivers = getJoinedReceiverPeers(peers);

  // Show Lobby Window first on launch until the Host selects a joined user
  const shouldShowLobby = !activePairedPeerId || showLobbyOverride;

  if (shouldShowLobby) {
    return (
      <LobbyScreen
        nodeInfo={nodeInfo}
        peers={peers}
        currentPeer={currentPeer}
        clientRole={clientRole}
        clientPlatform={clientPlatform}
        onSwitchClientRole={handleSwitchClientRole}
        onUpdatePeerProfile={handleUpdatePeerProfile}
        onSelectPeer={handleSelectLobbyPeer}
        onRegisterLocalReceiverPeer={handleRegisterLocalReceiverPeer}
        onUpdateNetworkIp={handleUpdateNetworkIp}
        onRefreshLobby={fetchLatestLobbyState}
      />
    );
  }

  const activeStreamsCount = jobs.filter((j) => j.status === 'transferring').length;
  const totalBytesTransferred = completedFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f8fc] text-slate-900 overflow-x-hidden">
      <TopBar
        activeSection={activeSection}
        activeTransfersCount={activeStreamsCount}
        joinedLobbyCount={joinedReceivers.length}
        onSelectSection={setActiveSection}
        onTriggerUploadModal={() => {
          setActiveSection('workspace');
          fileInputRef.current?.click();
        }}
        onReturnToLobby={handleReturnToLobby}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-7 space-y-5 sm:space-y-6">
        {/* Connected Session Bar Between Host and Selected Receiver User */}
        <section
          aria-label="Active Connected Users Session"
          className="bg-white border border-blue-200/90 rounded-2xl p-3.5 sm:p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-800 text-xs font-semibold border border-blue-200/60">
              <Laptop className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              <span>Host: {nodeInfo?.hostname || 'Local PC'}</span>
            </div>

            <ArrowRightLeft className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />

            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200/60">
              <Smartphone className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                Receiver: {activePairedPeer?.name || 'Connected User'} (
                {activePairedPeer?.ipAddress || 'Network IP'})
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5">
            <span className="text-xs text-slate-500">
              Saved Files: <strong className="font-mono text-slate-900">{completedFiles.length}</strong> (
              {formatByteSize(totalBytesTransferred)})
            </span>
            <button
              type="button"
              onClick={handleReturnToLobby}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Switch User in Lobby</span>
            </button>
          </div>
        </section>

        {/* Network IP Access Card (Copy Link, Open IP, Switch Interface, or Enter Custom LAN/Hotspot IP) */}
        <NetworkAccessPanel
          nodeInfo={nodeInfo}
          onUpdateNetworkIp={handleUpdateNetworkIp}
        />

        {/* CopyCase Drag & Drop + Active Transfers */}
        {(activeSection === 'workspace' || activeSection === 'queue') && (
          <TransferQueuePanel
            jobs={jobs}
            folders={folders}
            selectedHostFolder={selectedHostFolder}
            selectedReceiverFolder={selectedReceiverFolder}
            minConcurrency={minConcurrency}
            chunkSizeBytes={chunkSizeBytes}
            pausedJobIds={pausedJobIds}
            onChangeConcurrency={setMinConcurrency}
            onChangeChunkSize={setChunkSizeBytes}
            onUploadRealFiles={handleUploadRealFiles}
            onTogglePauseJob={handleTogglePauseJob}
            onClearCompleted={handleClearCompleted}
            fileInputRef={fileInputRef}
          />
        )}

        {/* Folders & Files on Host Disk (Host Data Only) and Receiver Disk (Receiver Data Only) */}
        {(activeSection === 'workspace' || activeSection === 'directories') && (
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Direct Host Disk &amp; Receiver Disk Drives
              </h2>
              <p className="text-xs text-slate-500">
                Host Device Disk shows only Host disk data and OS drives. Receiver Device Disk shows only {activePairedPeer?.name || 'the connected Receiver'}&apos;s disk data.
              </p>
            </div>
            <DualFolderExplorer
              nodeInfo={nodeInfo}
              clientPlatform={clientPlatform}
              clientRole={clientRole}
              activePairedPeer={activePairedPeer}
              folders={folders}
              completedFiles={completedFiles}
              selectedHostFolder={selectedHostFolder}
              selectedReceiverFolder={selectedReceiverFolder}
              onSelectFolder={handleSelectFolder}
              onMountDiskPath={handleMountDiskPath}
              onSyncReceiverLocalFolder={handleSyncReceiverLocalFolder}
              onCreateFolder={handleCreateFolder}
              onUploadFilesToEndpoint={(files, targetEndpoint, targetFolderPath) =>
                handleUploadRealFiles(
                  files,
                  targetEndpoint === 'host' ? 'receiver' : 'host',
                  targetEndpoint,
                  targetFolderPath
                )
              }
              onTransferDiskFile={handleTransferDiskFile}
              onDeleteFile={handleDeleteFile}
            />
          </div>
        )}

        {/* Simple Activity History */}
        {(activeSection === 'workspace' || activeSection === 'logs') && (
          <ActivityLogPanel logs={logs} onClearLogs={handleClearLogs} />
        )}
      </main>

      <footer className="mt-auto border-t border-slate-200/80 bg-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <span>PacketBridge Wi-Fi &amp; Hotspot File Transfer</span>
          <span>Fast Multi-File Packet Transfer · Windows, macOS &amp; Android</span>
        </div>
      </footer>
    </div>
  );
}
