import React, { useState } from 'react';
import { Wifi, Copy, Check, ExternalLink, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import type { SystemNodeInfo } from './DualFolderExplorer';

interface NetworkAccessPanelProps {
  nodeInfo: SystemNodeInfo | null;
  onUpdateNetworkIp: (ipOrHostPort: string) => Promise<{ ok: boolean; error?: string }>;
}

export const NetworkAccessPanel: React.FC<NetworkAccessPanelProps> = ({
  nodeInfo,
  onUpdateNetworkIp,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [customIpInput, setCustomIpInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const activeUrl =
    nodeInfo?.activeNetworkUrl ||
    (nodeInfo?.lanAddresses?.[0]
      ? `http://${nodeInfo.lanAddresses[0]}:${nodeInfo.port}`
      : window.location.origin);

  const interfaces = nodeInfo?.interfaces || [];

  const handleCopyUrl = async (urlToCopy: string) => {
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      setStatusMsg(`Network URL ready: ${urlToCopy}`);
    }
  };

  const handleSelectInterface = async (address: string, port: number) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await onUpdateNetworkIp(`${address}:${port}`);
    if (res.ok) {
      setStatusMsg(`Switched active Network IP to http://${address}:${port}`);
    } else {
      setErrorMsg(res.error || 'Could not switch network IP');
    }
  };

  const handleCustomIpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await onUpdateNetworkIp(customIpInput);
    if (!res.ok) {
      setErrorMsg(res.error || 'Invalid Network IP address.');
      return;
    }
    setCustomIpInput('');
    setStatusMsg('Updated active Network IP address for device access.');
  };

  return (
    <section
      aria-label="Network IP Access Configuration"
      className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Compact Always-Visible Network IP Access Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Wifi className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                Access on Network IP (Wi-Fi / Hotspot):
              </span>
              <code className="text-xs sm:text-sm font-mono font-bold text-blue-600 bg-blue-50/70 px-2.5 py-0.5 rounded-lg truncate">
                {activeUrl}
              </code>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500">
                On this PC:{' '}
                <a
                  href={`http://localhost:${nodeInfo?.port || 3000}`}
                  className="font-mono font-semibold text-slate-700 hover:text-blue-600 underline decoration-slate-300"
                >
                  http://localhost:{nodeInfo?.port || 3000}
                </a>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Open <strong className="font-semibold text-slate-700">{activeUrl}</strong> on other Wi-Fi/Hotspot devices, or{' '}
              <strong className="font-semibold text-slate-700">http://localhost:{nodeInfo?.port || 3000}</strong> on this computer (never use <code className="font-mono">0.0.0.0</code> in Chrome).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleCopyUrl(activeUrl)}
            aria-label="Copy Network IP URL"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedUrl ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span className="text-emerald-700">Copied IP Link</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy IP Link</span>
              </>
            )}
          </button>

          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${activeUrl}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Open IP</span>
          </a>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Change Network IP</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Network IP Selector & Custom LAN/Hotspot IP Input */}
      {isExpanded && (
        <div className="pt-4 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Detected Network Interfaces */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700">
              Detected Network Interfaces ({interfaces.length})
            </span>
            <div className="flex flex-wrap gap-2">
              {interfaces.map((iface) => {
                const isCurrent = activeUrl === iface.url;
                return (
                  <button
                    key={`${iface.name}-${iface.address}`}
                    type="button"
                    onClick={() =>
                      handleSelectInterface(iface.address, nodeInfo?.port || 3000)
                    }
                    className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-mono rounded-xl border transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-blue-50 border-blue-300 text-blue-900 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{iface.name}:</span>
                    <span>{iface.url}</span>
                    {isCurrent && (
                      <Check className="w-3.5 h-3.5 text-blue-600" aria-label="Active IP" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Wi-Fi / Hotspot IP Form */}
          <form onSubmit={handleCustomIpSubmit} className="space-y-2">
            <label
              htmlFor="custom-network-ip-input"
              className="block text-xs font-semibold text-slate-700"
            >
              Set Custom Wi-Fi or Hotspot Network IP (e.g. 192.168.1.45 or 192.168.43.1:3000)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="custom-network-ip-input"
                type="text"
                value={customIpInput}
                onChange={(e) => setCustomIpInput(e.target.value)}
                placeholder="e.g. 192.168.1.45:3000"
                className="flex-1 min-w-0 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Use Network IP
              </button>
            </div>
            {errorMsg && (
              <p role="alert" className="text-xs text-red-600 font-medium">
                {errorMsg}
              </p>
            )}
            {statusMsg && (
              <p role="status" className="text-xs text-emerald-700 font-medium">
                {statusMsg}
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  );
};
