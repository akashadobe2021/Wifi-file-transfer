import React, { useRef, useState } from 'react';
import {
  Folder,
  FolderPlus,
  FileText,
  Check,
  Download,
  Trash2,
  Laptop,
  Smartphone,
  HardDrive,
  CornerLeftUp,
  Upload,
  ArrowRightLeft,
} from 'lucide-react';
import {
  formatByteSize,
  getParentVirtualPath,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
  type DiskDrivePreset,
} from '../utils/transferEngine';

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
  interfaces?: NetworkInterfaceItem[];
  activeNetworkUrl?: string;
  customNetworkIp?: string | null;
  port: number;
  hostDiskRoot?: string;
  receiverDiskRoot?: string;
  availableDrives?: DiskDrivePreset[];
}

interface DualFolderExplorerProps {
  nodeInfo: SystemNodeInfo | null;
  clientPlatform: string;
  folders: FolderNode[];
  completedFiles: TransferredFileRecord[];
  selectedHostFolder: string;
  selectedReceiverFolder: string;
  onSelectFolder: (endpoint: EndpointRole, path: string) => void;
  onMountDiskPath: (
    endpoint: EndpointRole,
    diskPath: string
  ) => Promise<{ ok: boolean; error?: string; diskRoot?: string }>;
  onCreateFolder: (
    endpoint: EndpointRole,
    parentPath: string,
    folderName: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onUploadFilesToEndpoint: (
    files: File[],
    targetEndpoint: EndpointRole,
    targetFolderPath: string
  ) => Promise<void>;
  onTransferDiskFile: (
    sourceEndpoint: EndpointRole,
    sourceFolderPath: string,
    fileName: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteFile: (endpoint: EndpointRole, folderPath: string, fileName: string) => Promise<void>;
}

export const DualFolderExplorer: React.FC<DualFolderExplorerProps> = ({
  nodeInfo,
  clientPlatform,
  folders,
  completedFiles,
  selectedHostFolder,
  selectedReceiverFolder,
  onSelectFolder,
  onMountDiskPath,
  onCreateFolder,
  onUploadFilesToEndpoint,
  onTransferDiskFile,
  onDeleteFile,
}) => {
  const [hostFolderInput, setHostFolderInput] = useState('');
  const [receiverFolderInput, setReceiverFolderInput] = useState('');
  const [hostDiskInput, setHostDiskInput] = useState('');
  const [receiverDiskInput, setReceiverDiskInput] = useState('');
  const [hostError, setHostError] = useState<string | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [hostSuccess, setHostSuccess] = useState<string | null>(null);
  const [receiverSuccess, setReceiverSuccess] = useState<string | null>(null);

  const hostFilePickerRef = useRef<HTMLInputElement | null>(null);
  const receiverFilePickerRef = useRef<HTMLInputElement | null>(null);

  const hostFolders = folders.filter((f) => f.endpoint === 'host');
  const receiverFolders = folders.filter((f) => f.endpoint === 'receiver');
  const availableDrives = nodeInfo?.availableDrives || [];

  const handleMountDrive = async (endpoint: EndpointRole, diskPath: string) => {
    if (endpoint === 'host') {
      setHostError(null);
      setHostSuccess(null);
    } else {
      setReceiverError(null);
      setReceiverSuccess(null);
    }

    const res = await onMountDiskPath(endpoint, diskPath);
    if (!res.ok) {
      if (endpoint === 'host') setHostError(res.error || 'Could not mount disk path');
      else setReceiverError(res.error || 'Could not mount disk path');
      return;
    }

    if (endpoint === 'host') {
      setHostDiskInput('');
      setHostSuccess(`Mounted disk drive: ${res.diskRoot || diskPath}`);
    } else {
      setReceiverDiskInput('');
      setReceiverSuccess(`Mounted disk drive: ${res.diskRoot || diskPath}`);
    }
  };

  const handleCreate = async (
    e: React.FormEvent,
    endpoint: EndpointRole,
    parentPath: string,
    rawName: string
  ) => {
    e.preventDefault();
    if (endpoint === 'host') {
      setHostError(null);
      setHostSuccess(null);
    } else {
      setReceiverError(null);
      setReceiverSuccess(null);
    }

    const result = await onCreateFolder(endpoint, parentPath, rawName);
    if (!result.ok) {
      if (endpoint === 'host') setHostError(result.error || 'Could not create folder');
      else setReceiverError(result.error || 'Could not create folder');
      return;
    }

    if (endpoint === 'host') {
      setHostFolderInput('');
      setHostSuccess(`Created folder in ${parentPath}`);
    } else {
      setReceiverFolderInput('');
      setReceiverSuccess(`Created folder in ${parentPath}`);
    }
  };

  const handleSaveFileToLocalDisk = async (downloadUrl: string, fileName: string) => {
    const win = window as unknown as {
      showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    if (typeof win.showSaveFilePicker === 'function') {
      try {
        const handle = await win.showSaveFilePicker({ suggestedName: fileName });
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDirectSendBetweenDisks = async (
    sourceEndpoint: EndpointRole,
    sourceFolderPath: string,
    fileName: string
  ) => {
    if (sourceEndpoint === 'host') {
      setHostError(null);
      setHostSuccess(null);
    } else {
      setReceiverError(null);
      setReceiverSuccess(null);
    }

    const res = await onTransferDiskFile(sourceEndpoint, sourceFolderPath, fileName);
    if (!res.ok) {
      if (sourceEndpoint === 'host') setHostError(res.error || 'Transfer failed');
      else setReceiverError(res.error || 'Transfer failed');
      return;
    }

    const targetLabel = sourceEndpoint === 'host' ? 'Receiver Disk' : 'Host Disk';
    if (sourceEndpoint === 'host') {
      setHostSuccess(`Transferred "${fileName}" directly to ${targetLabel}`);
    } else {
      setReceiverSuccess(`Transferred "${fileName}" directly to ${targetLabel}`);
    }
  };

  const renderEndpointPane = (
    endpoint: EndpointRole,
    title: string,
    deviceSubtitle: string,
    activeDiskRoot: string,
    endpointFolders: FolderNode[],
    selectedPath: string,
    folderInput: string,
    setFolderInput: (val: string) => void,
    diskInput: string,
    setDiskInput: (val: string) => void,
    errorMsg: string | null,
    successMsg: string | null,
    pickerRef: React.RefObject<HTMLInputElement | null>
  ) => {
    const filesInFolder = completedFiles.filter(
      (f) => f.targetEndpoint === endpoint && f.targetFolderPath === selectedPath
    );

    const visibleFolders = endpointFolders.filter(
      (f) =>
        f.path === '/' ||
        f.path === selectedPath ||
        f.parentPath === selectedPath
    );

    const DeviceIcon = endpoint === 'host' ? Laptop : Smartphone;
    const otherEndpointLabel = endpoint === 'host' ? 'Receiver' : 'Host';

    return (
      <section
        aria-label={`${title} Directory Manager`}
        className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs flex flex-col justify-between gap-6 overflow-hidden"
      >
        <div className="space-y-5 min-w-0">
          {/* Device Card Header + Direct Upload to This Disk Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <DeviceIcon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">{title}</h3>
                <p className="text-xs text-slate-500 truncate">{deviceSubtitle}</p>
              </div>
            </div>

            <div className="flex items-center shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => pickerRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors w-full sm:w-auto cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Save Files to {endpoint === 'host' ? 'Host' : 'Receiver'} Disk</span>
              </button>
              <input
                ref={pickerRef}
                type="file"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const list = e.target.files ? Array.from(e.target.files) : [];
                  if (list.length > 0) {
                    onUploadFilesToEndpoint(list, endpoint, selectedPath);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />
            </div>
          </div>

          {/* Direct Physical Disk Drive Selector & Custom Disk Path Mount */}
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3 sm:p-3.5 space-y-3 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <HardDrive className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-700 shrink-0">
                  Mounted Disk Drive:
                </span>
                <code
                  title={activeDiskRoot}
                  className="text-xs font-mono font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md break-all"
                >
                  {activeDiskRoot}
                </code>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">
                Subfolder: <strong>{selectedPath}</strong>
              </span>
            </div>

            {/* 1-Click Detected OS Drives & System Folders */}
            {availableDrives.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500 mr-1">
                  Quick Disk Access:
                </span>
                {availableDrives.map((drv) => {
                  const isActiveDrive = activeDiskRoot === drv.path;
                  return (
                    <button
                      key={`${endpoint}-${drv.id}`}
                      type="button"
                      onClick={() => handleMountDrive(endpoint, drv.path)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer ${
                        isActiveDrive
                          ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {drv.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Custom Physical Disk Drive Path Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleMountDrive(endpoint, diskInput);
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <label htmlFor={`disk-path-${endpoint}`} className="sr-only">
                Custom Disk Drive Path for {title}
              </label>
              <input
                id={`disk-path-${endpoint}`}
                type="text"
                value={diskInput}
                onChange={(e) => setDiskInput(e.target.value)}
                placeholder="Enter direct disk path (e.g. C:\Users\akash\Downloads or D:\)..."
                className="flex-1 min-w-0 text-xs font-mono bg-white border border-slate-200 rounded-lg px-3 py-2 sm:py-1.5 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
              />
              <button
                type="submit"
                className="px-3 py-2 sm:py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Mount Disk
              </button>
            </form>
          </div>

          {/* Simple 1-Row New Folder Creator on Mounted Disk */}
          <form
            onSubmit={(e) => handleCreate(e, endpoint, selectedPath, folderInput)}
            className="space-y-1.5"
          >
            <label
              htmlFor={`new-folder-${endpoint}`}
              className="block text-xs font-semibold text-slate-700"
            >
              Create New Folder in <code className="font-mono text-blue-600 break-all">{selectedPath}</code> on{' '}
              {endpoint === 'host' ? 'Host' : 'Receiver'} Disk
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                id={`new-folder-${endpoint}`}
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Type folder name (e.g. Photos, Work)..."
                className="flex-1 min-w-0 text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Create on {endpoint === 'host' ? 'Host' : 'Receiver'}</span>
              </button>
            </div>
            {errorMsg && (
              <p role="alert" className="text-xs text-red-600 font-medium">
                {errorMsg}
              </p>
            )}
            {successMsg && (
              <p role="status" className="text-xs text-emerald-700 font-medium">
                {successMsg}
              </p>
            )}
          </form>

          {/* Visual Folder Grid (Browse Any Subfolder on Mounted Disk Drive) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Disk Folders ({visibleFolders.length})
              </span>
              {selectedPath !== '/' ? (
                <button
                  type="button"
                  onClick={() => onSelectFolder(endpoint, getParentVirtualPath(selectedPath))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                >
                  <CornerLeftUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Up to Parent Folder ({getParentVirtualPath(selectedPath)})</span>
                </button>
              ) : (
                <span className="text-xs text-slate-400">Click any disk folder to browse</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
              {visibleFolders.map((folder) => {
                const isSelected = folder.path === selectedPath;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => onSelectFolder(endpoint, folder.path)}
                    aria-label={`Select ${endpoint} folder ${folder.path}`}
                    className={`flex flex-col justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/80 border-blue-300 text-blue-950 shadow-2xs'
                        : 'bg-slate-50/60 border-slate-200/80 text-slate-700 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <Folder
                        className={`w-5 h-5 ${
                          isSelected ? 'text-blue-600 fill-blue-600/15' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-blue-600" aria-label="Selected target" />
                      )}
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="text-xs font-semibold truncate">{folder.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                        {folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Files Inside Selected Disk Folder (Fetch/Save or Send to Other Device) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Files on Disk in <code className="font-mono text-slate-900 break-all">{selectedPath}</code>
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {filesInFolder.length} {filesInFolder.length === 1 ? 'file' : 'files'}
              </span>
            </div>

            {filesInFolder.length === 0 ? (
              <div className="py-6 px-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                <p className="text-xs text-slate-500">
                  No files in <code className="font-mono">{selectedPath}</code> on this disk. Click{' '}
                  <strong>Save Files to {endpoint === 'host' ? 'Host' : 'Receiver'} Disk</strong>{' '}
                  or switch disk folders above to fetch existing files.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {filesInFolder.map((file) => {
                  const downloadUrl = `/api/files/download?endpoint=${encodeURIComponent(
                    endpoint
                  )}&folderPath=${encodeURIComponent(selectedPath)}&fileName=${encodeURIComponent(
                    file.name
                  )}`;
                  return (
                    <div
                      key={file.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 bg-slate-50/70 hover:bg-slate-100/70 border border-slate-200/70 rounded-xl text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-blue-600 shrink-0">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 break-all sm:truncate">
                            {file.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {formatByteSize(file.sizeBytes)} · {file.completedAt}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                        <button
                          type="button"
                          onClick={() =>
                            handleDirectSendBetweenDisks(endpoint, selectedPath, file.name)
                          }
                          title={`Transfer ${file.name} directly to ${otherEndpointLabel} Disk`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>To {otherEndpointLabel}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveFileToLocalDisk(downloadUrl, file.name)}
                          aria-label={`Fetch and save ${file.name} to disk`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Save to Disk</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFile(endpoint, selectedPath, file.name)}
                          aria-label={`Delete ${file.name}`}
                          className="inline-flex items-center p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const hostAddress = nodeInfo?.activeNetworkUrl
    ? nodeInfo.activeNetworkUrl.replace(/^https?:\/\//, '')
    : nodeInfo
    ? `${nodeInfo.lanAddresses[0]}:${nodeInfo.port}`
    : window.location.host;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {renderEndpointPane(
        'host',
        'Host Device Disk',
        `Local Wi-Fi (${hostAddress})`,
        nodeInfo?.hostDiskRoot || './storage/host',
        hostFolders,
        selectedHostFolder,
        hostFolderInput,
        setHostFolderInput,
        hostDiskInput,
        setHostDiskInput,
        hostError,
        hostSuccess,
        hostFilePickerRef
      )}
      {renderEndpointPane(
        'receiver',
        'Receiver Device Disk',
        clientPlatform,
        nodeInfo?.receiverDiskRoot || './storage/receiver',
        receiverFolders,
        selectedReceiverFolder,
        receiverFolderInput,
        setReceiverFolderInput,
        receiverDiskInput,
        setReceiverDiskInput,
        receiverError,
        receiverSuccess,
        receiverFilePickerRef
      )}
    </div>
  );
};
