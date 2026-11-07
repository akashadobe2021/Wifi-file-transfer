import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  Trash2,
  FileText,
  Gauge,
  SlidersHorizontal,
} from 'lucide-react';
import {
  calculateProgressPercentage,
  calculateAggregateTransferSpeed,
  formatByteSize,
  formatTransferSpeed,
  formatEtaSeconds,
  type EndpointRole,
  type FolderNode,
  type TransferJob,
} from '../utils/transferEngine';

interface TransferQueuePanelProps {
  jobs: TransferJob[];
  folders: FolderNode[];
  selectedHostFolder: string;
  selectedReceiverFolder: string;
  minConcurrency: number;
  chunkSizeBytes: number;
  pausedJobIds: Set<string>;
  onChangeConcurrency: (val: number) => void;
  onChangeChunkSize: (val: number) => void;
  onUploadRealFiles: (
    files: File[],
    source: EndpointRole,
    target: EndpointRole,
    targetFolderPath: string
  ) => Promise<void>;
  onTogglePauseJob: (jobId: string) => void;
  onClearCompleted: () => Promise<void>;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const TransferQueuePanel: React.FC<TransferQueuePanelProps> = ({
  jobs,
  selectedHostFolder,
  selectedReceiverFolder,
  minConcurrency,
  chunkSizeBytes,
  pausedJobIds,
  onChangeConcurrency,
  onChangeChunkSize,
  onUploadRealFiles,
  onTogglePauseJob,
  onClearCompleted,
  fileInputRef,
}) => {
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = fileInputRef || localInputRef;

  const [direction, setDirection] = useState<'host-to-receiver' | 'receiver-to-host'>(
    'host-to-receiver'
  );
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const sourceEndpoint: EndpointRole = direction === 'host-to-receiver' ? 'host' : 'receiver';
  const targetEndpoint: EndpointRole = direction === 'host-to-receiver' ? 'receiver' : 'host';
  const activeTargetFolder =
    targetEndpoint === 'receiver' ? selectedReceiverFolder : selectedHostFolder;

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);
    e.target.value = '';
    await onUploadRealFiles(filesArray, sourceEndpoint, targetEndpoint, activeTargetFolder);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const droppedFiles = e.dataTransfer?.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    await onUploadRealFiles(
      Array.from(droppedFiles),
      sourceEndpoint,
      targetEndpoint,
      activeTargetFolder
    );
  };

  const activeStreamsCount = jobs.filter((j) => j.status === 'transferring').length;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const aggregateSpeedBytesPerSec = calculateAggregateTransferSpeed(jobs);

  const filteredJobs = jobs.filter((job) => {
    if (statusFilter === 'active') {
      return job.status === 'transferring' || job.status === 'queued' || job.status === 'paused';
    }
    if (statusFilter === 'completed') {
      return job.status === 'completed';
    }
    return true;
  });

  return (
    <section aria-label="Segmented Packet Transfer Queue" className="space-y-6">
      {/* CopyCase-Style Friendly Drag & Drop Upload Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 md:p-8 shadow-2xs space-y-5 overflow-hidden">
        <input
          ref={inputRef}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFileInputChange}
          className="hidden"
          id="multi-file-upload-input"
        />

        {/* Top Bar inside Card: Destination Switcher + Optional Settings Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Send files to:</span>
            <div className="grid grid-cols-2 sm:inline-flex items-center p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setDirection('host-to-receiver')}
                className={`px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                  direction === 'host-to-receiver'
                    ? 'bg-white text-blue-600 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Receiver ({selectedReceiverFolder})
              </button>
              <button
                type="button"
                onClick={() => setDirection('receiver-to-host')}
                className={`px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                  direction === 'receiver-to-host'
                    ? 'bg-white text-blue-600 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Host ({selectedHostFolder})
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedSettings((prev) => !prev)}
            aria-expanded={showAdvancedSettings}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-colors w-full sm:w-auto shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Transfer Options ({Math.round(chunkSizeBytes / 1024)} KB pieces · {minConcurrency}x parallel)
            </span>
          </button>
        </div>

        {/* Collapsible Simple Options Drawer */}
        {showAdvancedSettings && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200/80 rounded-xl">
            <div className="space-y-1">
              <label htmlFor="packet-chunk-select" className="block text-xs font-semibold text-slate-700">
                Packet Piece Size
              </label>
              <select
                id="packet-chunk-select"
                value={chunkSizeBytes}
                onChange={(e) => onChangeChunkSize(Number(e.target.value))}
                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2"
              >
                <option value={32768}>32 KB Pieces (Small packets)</option>
                <option value={65536}>64 KB Pieces (Recommended)</option>
                <option value={131072}>128 KB Pieces (Large files)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="concurrency-limit-select" className="block text-xs font-semibold text-slate-700">
                Simultaneous File Uploads
              </label>
              <select
                id="concurrency-limit-select"
                value={minConcurrency}
                onChange={(e) => onChangeConcurrency(Number(e.target.value))}
                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2"
              >
                <option value={5}>5 Files at Once (Default)</option>
                <option value={6}>6 Files at Once</option>
                <option value={8}>8 Files at Once</option>
              </select>
            </div>
          </div>
        )}

        {/* CopyCase Drag & Drop Area */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drag and drop files here, or click to browse files from your device"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`group relative flex flex-col items-center justify-center text-center py-8 sm:py-12 px-4 sm:px-6 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
            isDraggingOver
              ? 'border-blue-500 bg-blue-50/60'
              : 'border-blue-200 hover:border-blue-400 bg-slate-50/60 hover:bg-blue-50/25'
          }`}
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-blue-600/10 text-blue-600 flex items-center justify-center mb-3 sm:mb-4 group-hover:scale-105 transition-transform">
            <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            Drag & drop files here to transfer
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md">
            Or{' '}
            <span className="text-blue-600 font-semibold underline decoration-blue-300 underline-offset-2">
              browse files from your device
            </span>
            . Selecting multiple files uploads {minConcurrency}+ files together in fast {Math.round(chunkSizeBytes / 1024)} KB pieces.
          </p>

          <div className="mt-4 sm:mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
            <span>Destination: {targetEndpoint === 'receiver' ? 'Receiver' : 'Host'} ({activeTargetFolder})</span>
            <span aria-hidden="true">·</span>
            <span>{minConcurrency}+ Files Simultaneously</span>
            <span aria-hidden="true">·</span>
            <span>Any File Type</span>
          </div>
        </div>
      </div>

      {/* Active & Recent Transfers Card (Clean CopyCase File Progress Rows) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-4 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5">
            <h3 className="text-base font-bold text-slate-900">File Transfers</h3>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({jobs.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'active'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                In Progress ({activeStreamsCount + queuedCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('completed')}
                className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'completed'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Done ({completedCount})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
              <Gauge className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              <span className="font-semibold text-slate-900">
                Live Speed: {formatTransferSpeed(aggregateSpeedBytesPerSec)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Active: {activeStreamsCount}</span>
              {queuedCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Waiting: {queuedCount}</span>
                </>
              )}
            </div>
            {completedCount > 0 && (
              <button
                type="button"
                onClick={onClearCompleted}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear Completed</span>
              </button>
            )}
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="py-8 px-4 text-center bg-slate-50/70 border border-slate-100 rounded-xl">
            <p className="text-xs text-slate-500">
              No transfers in this list yet. Drop files above or click{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-blue-600 font-semibold hover:underline cursor-pointer"
              >
                Select Files
              </button>{' '}
              to start transferring.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job) => {
              const pct = calculateProgressPercentage(job.completedPieces, job.totalPieces);
              const isComplete = job.status === 'completed';
              const isPaused = pausedJobIds.has(job.id) || job.status === 'paused';
              const formattedSpeed = formatTransferSpeed(job.speedBytesPerSec);

              return (
                <div
                  key={job.id}
                  className="p-3.5 sm:p-4 bg-slate-50/70 hover:bg-slate-50 border border-slate-200/80 rounded-xl transition-colors space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isComplete
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        <FileText className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 break-all sm:truncate">
                          {job.fileName}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 font-mono tabular-nums">
                          <span>
                            {formatByteSize(job.bytesTransferred)} of {formatByteSize(job.fileSizeBytes)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            To {job.targetEndpoint === 'receiver' ? 'Receiver' : 'Host'} ({job.targetFolderPath})
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {job.completedPieces}/{job.totalPieces} pieces
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Speed, ETA, and Control */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                      <div className="text-left sm:text-right font-mono tabular-nums">
                        <div className="flex items-center sm:justify-end gap-2 text-xs">
                          <span className="font-bold text-slate-900">{pct}%</span>
                          <span className="text-slate-300" aria-hidden="true">
                            |
                          </span>
                          <span
                            aria-label={`Transfer speed for ${job.fileName}`}
                            className="font-semibold text-blue-600"
                          >
                            {formattedSpeed}
                          </span>
                        </div>
                        <div className="flex items-center sm:justify-end gap-1 text-xs text-slate-500 mt-0.5">
                          {isComplete ? (
                            <>
                              <CheckCircle2
                                className="w-3.5 h-3.5 text-emerald-600"
                                aria-hidden="true"
                              />
                              <span className="text-emerald-700 font-medium">Completed</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3 text-slate-400" aria-hidden="true" />
                              <span>
                                {isPaused ? 'Paused' : formatEtaSeconds(job.etaSeconds)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {!isComplete && (
                        <button
                          type="button"
                          onClick={() => onTogglePauseJob(job.id)}
                          aria-label={`${
                            isPaused ? 'Resume' : 'Pause'
                          } transfer for ${job.fileName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {!isPaused ? (
                            <>
                              <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                              <span>Resume</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Smooth Progress Bar */}
                  <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-transform duration-150 origin-left ${
                        isComplete
                          ? 'bg-emerald-500'
                          : isPaused
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ transform: `scaleX(${pct / 100})` }}
                    />
                  </div>

                  {/* Subtle 24-Piece Packet Indicator */}
                  <div className="flex items-center gap-1" aria-label={`Packet map for ${job.fileName}`}>
                    {job.pieceBlocks.map((blockState, idx) => (
                      <span
                        key={idx}
                        className={`h-1 flex-1 rounded-xs ${
                          blockState === 2
                            ? isComplete
                              ? 'bg-emerald-400'
                              : 'bg-blue-500'
                            : blockState === 1
                            ? 'bg-amber-400'
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
