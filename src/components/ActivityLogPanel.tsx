import React, { useState } from 'react';
import { Search, Download, Trash2, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import type { ActivityLogEntry } from '../utils/transferEngine';

interface ActivityLogPanelProps {
  logs: ActivityLogEntry[];
  onClearLogs: () => Promise<void>;
}

export const ActivityLogPanel: React.FC<ActivityLogPanelProps> = ({ logs, onClearLogs }) => {
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'transfer' | 'chunk' | 'folder' | 'session'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = logs.filter((entry) => {
    const matchesCategory =
      categoryFilter === 'all' ? true : entry.category === categoryFilter;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesCategory;
    return (
      matchesCategory &&
      (entry.message.toLowerCase().includes(q) ||
        (entry.fileName && entry.fileName.toLowerCase().includes(q)) ||
        (entry.folderPath && entry.folderPath.toLowerCase().includes(q)) ||
        (entry.checksum && entry.checksum.toLowerCase().includes(q)))
    );
  });

  const handleExportCsv = () => {
    const headers = [
      'Timestamp',
      'Category',
      'Level',
      'Source',
      'Target',
      'File',
      'Folder',
      'Packets',
      'Speed',
      'Checksum',
      'Message',
    ];
    const rows = filteredLogs.map((l) => [
      l.timestamp,
      l.category,
      l.level,
      l.sourceEndpoint,
      l.targetEndpoint || '',
      l.fileName || '',
      l.folderPath || '',
      l.packetInfo || '',
      l.speedFormatted || '',
      l.checksum || '',
      `"${l.message.replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packetbridge-activity-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Private Local Transfer Activity Log"
      className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-slate-900">Transfer Activity History</h2>
          <p className="text-xs text-slate-500">
            Private record of all transferred files and folders created during this session.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All Activity' },
              { id: 'transfer', label: 'Completed Files' },
              { id: 'folder', label: 'Folders' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategoryFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-60">
          <label htmlFor="activity-log-search" className="sr-only">
            Search activity history
          </label>
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="activity-log-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files or folders..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
          />
        </div>
      </div>

      {/* Simple Clean Activity List */}
      <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No matching activity found.
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="mt-0.5 shrink-0">
                  {entry.level === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  ) : entry.level === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  ) : (
                    <Info className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{entry.message}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                    <span>{entry.timestamp}</span>
                    {entry.packetInfo && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{entry.packetInfo}</span>
                      </>
                    )}
                    {entry.checksum && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{entry.checksum}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {entry.speedFormatted && (
                <div className="font-mono tabular-nums text-xs font-semibold text-emerald-700 shrink-0">
                  {entry.speedFormatted}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
};
