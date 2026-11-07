import React, { useEffect, useState } from 'react';
import {
  Users,
  Wifi,
  Laptop,
  Smartphone,
  ArrowRight,
  CheckCircle2,
  UserPlus,
  HardDrive,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  getJoinedReceiverPeers,
  type EndpointRole,
  type LobbyPeer,
} from '../utils/transferEngine';
import { NetworkAccessPanel } from './NetworkAccessPanel';
import type { SystemNodeInfo } from './DualFolderExplorer';

interface LobbyScreenProps {
  nodeInfo: SystemNodeInfo | null;
  peers: LobbyPeer[];
  currentPeer: LobbyPeer | null;
  clientRole: EndpointRole;
  clientPlatform: string;
  onSwitchClientRole: (role: EndpointRole) => Promise<void>;
  onUpdatePeerProfile: (name: string, receiverDiskLabel?: string) => Promise<void>;
  onSelectPeer: (peerId: string) => Promise<void>;
  onRegisterLocalReceiverPeer: (customName?: string) => Promise<void>;
  onUpdateNetworkIp: (networkIp: string) => Promise<{ ok: boolean; error?: string }>;
  onRefreshLobby?: () => Promise<void>;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  nodeInfo,
  peers,
  currentPeer,
  clientRole,
  clientPlatform,
  onSwitchClientRole,
  onUpdatePeerProfile,
  onSelectPeer,
  onRegisterLocalReceiverPeer,
  onUpdateNetworkIp,
  onRefreshLobby,
}) => {
  const [nameInput, setNameInput] = useState(currentPeer?.name || '');
  const [diskLabelInput, setDiskLabelInput] = useState(currentPeer?.receiverDiskLabel || '');
  const [hasEditedName, setHasEditedName] = useState(false);
  const [hasEditedDisk, setHasEditedDisk] = useState(false);
  const [quickJoinName, setQuickJoinName] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const joinedReceivers = getJoinedReceiverPeers(peers);
  const defaultIp =
    currentPeer?.ipAddress ||
    nodeInfo?.lanAddresses?.[0] ||
    window.location.hostname ||
    '192.168.1.42';

  useEffect(() => {
    if (!hasEditedName && currentPeer?.name) {
      setNameInput(currentPeer.name);
    } else if (!hasEditedName && !nameInput) {
      setNameInput(`${clientPlatform} (${defaultIp})`);
    }
  }, [currentPeer?.name, clientPlatform, defaultIp, hasEditedName, nameInput]);

  useEffect(() => {
    if (!hasEditedDisk && currentPeer?.receiverDiskLabel) {
      setDiskLabelInput(currentPeer.receiverDiskLabel);
    } else if (!hasEditedDisk && !diskLabelInput) {
      setDiskLabelInput(`${clientPlatform} Local Disk (/)`);
    }
  }, [currentPeer?.receiverDiskLabel, clientPlatform, hasEditedDisk, diskLabelInput]);

  const networkUrl =
    nodeInfo?.activeNetworkUrl ||
    (nodeInfo?.lanAddresses?.[0]
      ? `http://${nodeInfo.lanAddresses[0]}:${nodeInfo.port}`
      : window.location.origin);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName =
      nameInput.trim() || currentPeer?.name || `${clientPlatform} (${defaultIp})`;
    const finalDisk =
      diskLabelInput.trim() ||
      currentPeer?.receiverDiskLabel ||
      `${finalName} Local Disk (/)`;

    setNameInput(finalName);
    setDiskLabelInput(finalDisk);
    await onUpdatePeerProfile(finalName, finalDisk);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 3500);
  };

  const handleQuickAddReceiver = async (e: React.FormEvent) => {
    e.preventDefault();
    await onRegisterLocalReceiverPeer(quickJoinName.trim() || undefined);
    setQuickJoinName('');
  };

  const renderJoinedReceiversGrid = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
      {joinedReceivers.map((peer) => (
        <div
          key={peer.peerId}
          className="flex flex-col justify-between gap-4 p-4 rounded-2xl border border-slate-200/90 bg-slate-50/60 hover:bg-blue-50/30 hover:border-blue-300 transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Smartphone className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 break-all">
                    {peer.name}
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Joined via IP
                  </span>
                </div>
                <div className="text-xs font-mono text-blue-700 font-semibold mt-1 break-all">
                  IP: {peer.ipAddress}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {peer.platform} · Joined at {peer.joinedAt}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200/70">
                  <HardDrive className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    Receiver Disk: <strong>{peer.receiverDiskLabel}</strong> ({peer.receiverFileCount} files)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectPeer(peer.peerId)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <span>Select {peer.name} &amp; Open App</span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f8fc] text-slate-900 overflow-x-hidden">
      {/* Top Lobby Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <Wifi className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-bold text-base sm:text-lg tracking-tight text-slate-900 leading-none">
                PacketBridge
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                Wi-Fi &amp; Network IP Lobby
              </div>
            </div>
          </div>

          {/* Role Mode Switcher (Host vs Joined Receiver) */}
          <div
            role="group"
            aria-label="Lobby Device Role"
            className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 w-full sm:w-auto"
          >
            <button
              type="button"
              onClick={() => onSwitchClientRole('host')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                clientRole === 'host'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Host Lobby ({joinedReceivers.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchClientRole('receiver')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                clientRole === 'receiver'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Join as Receiver</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-3.5 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Step 1: Share Network IP Link */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Step 1 · Share Network IP Link
              </span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
                {clientRole === 'host'
                  ? 'Select a Person Who Joined via Network IP'
                  : 'Connected to Network IP Lobby as Receiver'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {clientRole === 'host'
                  ? 'Anyone who opens your Network IP address on Wi-Fi or Hotspot appears in the live lobby below. Select a person to open the file transfer workspace between both of your devices.'
                  : 'You are registered as a Receiver in the Host Lobby. Customize your display name below or click Connect with Host to open the transfer workspace.'}
              </p>
            </div>
          </div>

          <NetworkAccessPanel
            nodeInfo={nodeInfo}
            onUpdateNetworkIp={onUpdateNetworkIp}
          />
        </section>

        {/* Step 2: Host View (Select Joined User) OR Receiver View (Your Joined Profile + Live Lobby List) */}
        {clientRole === 'host' ? (
          <section
            aria-label="Persons Joined via Network IP"
            className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">
                      Persons Joined via Network IP
                    </h2>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                      {joinedReceivers.length} Online
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select any joined person below to open the full transfer workspace between Host Disk and their Receiver Disk.
                  </p>
                </div>
              </div>

              {onRefreshLobby && (
                <button
                  type="button"
                  onClick={() => onRefreshLobby()}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-colors self-start sm:self-center cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Refresh Lobby</span>
                </button>
              )}
            </div>

            {joinedReceivers.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-6 sm:p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                  <RefreshCw className="w-6 h-6 animate-spin" aria-hidden="true" />
                </div>
                <div className="max-w-md mx-auto space-y-1.5">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Waiting for a person to join on {networkUrl}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Open <strong className="font-mono text-slate-800 break-all">{networkUrl}</strong> on your mobile phone, another laptop, or click <strong>Join as Receiver</strong> above. As soon as a Receiver joins, their name and IP appear here automatically.
                  </p>
                </div>

                {/* Add / Register Receiver Device Form for Instant Pairing or Local Testing */}
                <form
                  onSubmit={handleQuickAddReceiver}
                  className="max-w-md mx-auto pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <label htmlFor="quick-join-receiver-name" className="sr-only">
                    Add Receiver Person Name
                  </label>
                  <input
                    id="quick-join-receiver-name"
                    type="text"
                    value={quickJoinName}
                    onChange={(e) => setQuickJoinName(e.target.value)}
                    placeholder="Or enter receiver name (e.g. Rahul's Phone) to add..."
                    className="flex-1 min-w-0 text-xs bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Add &amp; Join Receiver</span>
                  </button>
                </form>
              </div>
            ) : (
              <div className="space-y-4">
                {renderJoinedReceiversGrid()}

                {/* Also allow adding another receiver device in lobby */}
                <form
                  onSubmit={handleQuickAddReceiver}
                  className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2"
                >
                  <span className="text-xs text-slate-500">
                    Want to register another Receiver device in the lobby?
                  </span>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={quickJoinName}
                      onChange={(e) => setQuickJoinName(e.target.value)}
                      placeholder="Receiver person or device name..."
                      aria-label="Additional Receiver Person Name"
                      className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Add Receiver</span>
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>
        ) : (
          /* Receiver View: Person who joined the app using Network IP */
          <div className="space-y-6">
            <section
              aria-label="Receiver Lobby Status"
              className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base sm:text-lg font-bold text-slate-900">
                        You Are in the Host&apos;s Lobby
                      </h2>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Visible to Host ({defaultIp})
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Your device is actively listed in the Host Lobby. Update your profile below or connect directly.
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="receiver-display-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Your Name Shown to Host
                  </label>
                  <input
                    id="receiver-display-name"
                    type="text"
                    value={nameInput}
                    onChange={(e) => {
                      setHasEditedName(true);
                      setNameInput(e.target.value);
                    }}
                    placeholder="e.g. Akash's Android Phone"
                    className="w-full text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="receiver-disk-label"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Your Receiver Disk Label
                  </label>
                  <input
                    id="receiver-disk-label"
                    type="text"
                    value={diskLabelInput}
                    onChange={(e) => {
                      setHasEditedDisk(true);
                      setDiskLabelInput(e.target.value);
                    }}
                    placeholder="e.g. Receiver Phone Storage (/Downloads)"
                    className="w-full text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
                  />
                </div>

                <div className="sm:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {profileSaved
                        ? 'Profile Updated & Visible in Host Lobby!'
                        : 'Update My Lobby Profile'}
                    </span>
                  </button>

                  {currentPeer && (
                    <button
                      type="button"
                      onClick={() => onSelectPeer(currentPeer.peerId)}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <span>Connect with Host &amp; Open Workspace</span>
                      <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </form>

              {profileSaved && (
                <div
                  role="status"
                  className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    Your Receiver profile <strong>{nameInput}</strong> is now live in the Host Lobby!
                  </span>
                  <button
                    type="button"
                    onClick={() => onSwitchClientRole('host')}
                    className="underline font-bold text-emerald-900 hover:text-emerald-700 cursor-pointer"
                  >
                    View in Host Lobby ({joinedReceivers.length} Online)
                  </button>
                </div>
              )}
            </section>

            {/* Live Lobby Queue Preview so Receiver can also see the active Lobby list */}
            {joinedReceivers.length > 0 && (
              <section
                aria-label="Live Lobby Queue Preview"
                className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Live Host Lobby List ({joinedReceivers.length} Receiver{joinedReceivers.length === 1 ? '' : 's'} Visible)
                    </h3>
                  </div>
                </div>
                {renderJoinedReceiversGrid()}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
