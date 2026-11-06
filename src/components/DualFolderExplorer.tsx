import React, { useState } from 'react';
import { Folder, FolderPlus, FileText, Check, Download, Trash2, Laptop, Smartphone } from 'lucide-react';
import {
  formatByteSize,
  type EndpointRole,
  type FolderNode,
  type TransferredFileRecord,
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
}

interface DualFolderExplorerProps {
  nodeInfo: SystemNodeInfo | null;
  clientPlatform: string;
  folders: FolderNode[];
  completedFiles: TransferredFileRecord[];
  selectedHostFolder: string;
  selectedReceiverFolder: string;
  onSelectFolder: (endpoint: EndpointRole, path: string) => void;
  onCreateFolder: (
    endpoint: EndpointRole,
    parentPath: string,
    folderName: string
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
  onCreateFolder,
  onDeleteFile,
}) => {
  const [hostFolderInput, setHostFolderInput] = useState('');
  const [receiverFolderInput, setReceiverFolderInput] = useState('');
  const [hostError, setHostError] = useState<string | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [hostSuccess, setHostSuccess] = useState<string | null>(null);
  const [receiverSuccess, setReceiverSuccess] = useState<string | null>(null);

  const hostFolders = folders.filter((f) => f.endpoint === 'host');
  const receiverFolders = folders.filter((f) => f.endpoint === 'receiver');

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

  const renderEndpointPane = (
    endpoint: EndpointRole,
    title: string,
    deviceSubtitle: string,
    endpointFolders: FolderNode[],
    selectedPath: string,
    folderInput: string,
    setFolderInput: (val: string) => void,
    errorMsg: string | null,
    successMsg: string | null
  ) => {
    const filesInFolder = completedFiles.filter(
      (f) => f.targetEndpoint === endpoint && f.targetFolderPath === selectedPath
    );

    const DeviceIcon = endpoint === 'host' ? Laptop : Smartphone;

    return (
      <section
        aria-label={`${title} Directory Manager`}
        className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs flex flex-col justify-between gap-6"
      >
        <div className="space-y-5">
          {/* Device Card Header */}
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <DeviceIcon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{title}</h3>
                <p className="text-xs text-slate-500">{deviceSubtitle}</p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-400 block">Selected Folder</span>
              <code className="text-xs font-mono font-semibold text-blue-600">{selectedPath}</code>
            </div>
          </div>

          {/* Simple 1-Row New Folder Creator */}
          <form
            onSubmit={(e) => handleCreate(e, endpoint, selectedPath, folderInput)}
            className="space-y-1.5"
          >
            <label
              htmlFor={`new-folder-${endpoint}`}
              className="block text-xs font-semibold text-slate-700"
            >
              New Folder on {endpoint === 'host' ? 'Host' : 'Receiver'}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`new-folder-${endpoint}`}
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Type folder name (e.g. Photos, Work)..."
                className="flex-1 min-w-0 text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" aria-hidden="true" />
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

          {/* Visual Folder Grid (CopyCase Folder Cards) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Folders ({endpointFolders.length})
              </span>
              <span className="text-xs text-slate-400">Click a folder to open</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
              {endpointFolders.map((folder) => {
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

          {/* Files Inside Selected Folder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Files in <code className="font-mono text-slate-900">{selectedPath}</code>
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {filesInFolder.length} {filesInFolder.length === 1 ? 'file' : 'files'}
              </span>
            </div>

            {filesInFolder.length === 0 ? (
              <div className="py-6 px-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                <p className="text-xs text-slate-500">
                  This folder is empty. Drop files above to upload into{' '}
                  <code className="font-mono">{selectedPath}</code>.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {filesInFolder.map((file) => {
                  const downloadUrl = `/api/files/download?endpoint=${encodeURIComponent(
                    endpoint
                  )}&folderPath=${encodeURIComponent(selectedPath)}&fileName=${encodeURIComponent(
                    file.name
                  )}`;
                  return (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-2 p-2.5 bg-slate-50/70 hover:bg-slate-100/70 border border-slate-200/70 rounded-xl text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-blue-600 shrink-0">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{file.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {formatByteSize(file.sizeBytes)} · {file.completedAt}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={downloadUrl}
                          download={file.name}
                          aria-label={`Download ${file.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Save</span>
                        </a>
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
        'Host Device',
        `Local Wi-Fi (${hostAddress})`,
        hostFolders,
        selectedHostFolder,
        hostFolderInput,
        setHostFolderInput,
        hostError,
        hostSuccess
      )}
      {renderEndpointPane(
        'receiver',
        'Receiver Device',
        clientPlatform,
        receiverFolders,
        selectedReceiverFolder,
        receiverFolderInput,
        setReceiverFolderInput,
        receiverError,
        receiverSuccess
      )}
    </div>
  );
};
