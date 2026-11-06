/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { TopBar, type ActiveSection } from './components/TopBar';
import { DualFolderExplorer, type SystemNodeInfo } from './components/DualFolderExplorer';
import { TransferQueuePanel } from './components/TransferQueuePanel';
import { ActivityLogPanel } from './components/ActivityLogPanel';
import { NetworkAccessPanel } from './components/NetworkAccessPanel';
import {
  calculatePieceCount,
  formatByteSize,
  DEFAULT_MIN_CONCURRENT_FILES,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
  type TransferJob,
  type ActivityLogEntry,
} from './utils/transferEngine';

interface AppServerState {
  nodeInfo: SystemNodeInfo;
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
  if (/macintosh|mac os x/i.test(ua)) return 'macOS Device';
  if (/windows/i.test(ua)) return 'Windows Device';
  if (/linux/i.test(ua)) return 'Linux Device';
  return navigator.platform || 'Connected Device';
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
    setFolders(next.folders || []);
    setCompletedFiles(next.completedFiles || []);
    setJobs(next.jobs || []);
    setLogs(next.logs || []);
  };

  useEffect(() => {
    fetch('/api/state')
      .then((res) => res.json())
      .then((data: AppServerState) => applyServerState(data))
      .catch(() => {
        // Server initializing
      });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
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

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  const handleSelectFolder = (endpoint: EndpointRole, path: string) => {
    if (endpoint === 'host') {
      setSelectedHostFolder(path);
    } else {
      setSelectedReceiverFolder(path);
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

  const activeStreamsCount = jobs.filter((j) => j.status === 'transferring').length;
  const totalBytesTransferred = completedFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f8fc] text-slate-900">
      <TopBar
        activeSection={activeSection}
        activeTransfersCount={activeStreamsCount}
        onSelectSection={setActiveSection}
        onTriggerUploadModal={() => {
          setActiveSection('workspace');
          fileInputRef.current?.click();
        }}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-7 space-y-6">
        {/* Simple Friendly Welcome & Status Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Easy Wi-Fi File Transfer
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Drop files below to send them between your devices over Wi-Fi, Hotspot, or Network IP.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 bg-white border border-slate-200/80 rounded-xl px-4 py-2.5 shadow-2xs">
            <span>
              Network IP:{' '}
              <strong className="font-mono text-blue-600">
                {nodeInfo?.activeNetworkUrl || window.location.origin}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Saved Files: <strong className="font-mono text-slate-900">{completedFiles.length}</strong> ({formatByteSize(totalBytesTransferred)})
            </span>
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

        {/* Folders & Files on Host and Receiver */}
        {(activeSection === 'workspace' || activeSection === 'directories') && (
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Device Folders & Saved Files
              </h2>
              <p className="text-xs text-slate-500">
                Create folders on either your Host or Receiver device and click any folder to set where files are saved.
              </p>
            </div>
            <DualFolderExplorer
              nodeInfo={nodeInfo}
              clientPlatform={clientPlatform}
              folders={folders}
              completedFiles={completedFiles}
              selectedHostFolder={selectedHostFolder}
              selectedReceiverFolder={selectedReceiverFolder}
              onSelectFolder={handleSelectFolder}
              onCreateFolder={handleCreateFolder}
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
          <span>PacketBridge Wi-Fi & Hotspot File Transfer</span>
          <span>Fast Multi-File Packet Transfer · Windows, macOS & Android</span>
        </div>
      </footer>
    </div>
  );
}
