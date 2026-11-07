import React from 'react';
import { UploadCloud, Users } from 'lucide-react';

export type ActiveSection = 'workspace' | 'queue' | 'directories' | 'logs';

interface TopBarProps {
  activeSection: ActiveSection;
  activeTransfersCount: number;
  joinedLobbyCount?: number;
  onSelectSection: (section: ActiveSection) => void;
  onTriggerUploadModal: () => void;
  onReturnToLobby: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  activeTransfersCount,
  joinedLobbyCount = 0,
  onSelectSection,
  onTriggerUploadModal,
  onReturnToLobby,
}) => {
  const navItems: Array<{ id: ActiveSection; label: string }> = [
    { id: 'workspace', label: 'Home' },
    {
      id: 'queue',
      label: activeTransfersCount > 0 ? `Transfers (${activeTransfersCount})` : 'Transfers',
    },
    { id: 'directories', label: 'Folders & Files' },
    { id: 'logs', label: 'History' },
  ];

  return (
    <header className="sticky top-0 z-30 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-4 gap-y-2.5 px-4 sm:px-6 py-3 sm:py-4 bg-white border-b border-slate-200/80">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#workspace"
        onClick={(e) => {
          e.preventDefault();
          onSelectSection('workspace');
        }}
        className="order-1 text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        PacketBridge
      </a>

      {/* Zone 3 on Mobile (Top-Right), Zone 3 on Desktop (Far-Right): Lobby + Primary Action */}
      <div className="order-2 md:order-3 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReturnToLobby}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <span>Lobby{joinedLobbyCount > 0 ? ` (${joinedLobbyCount})` : ''}</span>
        </button>

        <button
          type="button"
          onClick={onTriggerUploadModal}
          className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <UploadCloud className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Upload Files</span>
        </button>
      </div>

      {/* Zone 2: 4 concise single-line text navigation links (full-width second row on mobile, centered on desktop) */}
      <nav
        aria-label="Primary Workspace Navigation"
        className="order-3 md:order-2 w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 flex items-center justify-between sm:justify-center gap-2 sm:gap-7 text-xs sm:text-sm font-medium text-slate-600"
      >
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                onSelectSection(item.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`py-1 px-1 text-center transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                isActive
                  ? 'border-blue-600 text-blue-600 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
};

