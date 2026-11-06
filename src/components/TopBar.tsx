import React from 'react';
import { UploadCloud } from 'lucide-react';

export type ActiveSection = 'workspace' | 'queue' | 'directories' | 'logs';

interface TopBarProps {
  activeSection: ActiveSection;
  activeTransfersCount: number;
  onSelectSection: (section: ActiveSection) => void;
  onTriggerUploadModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  activeTransfersCount,
  onSelectSection,
  onTriggerUploadModal,
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
    <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200/80">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#workspace"
        onClick={(e) => {
          e.preventDefault();
          onSelectSection('workspace');
        }}
        className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        PacketBridge
      </a>

      {/* Zone 2: 4 concise single-line text navigation links */}
      <nav
        aria-label="Primary Workspace Navigation"
        className="flex items-center gap-7 text-sm font-medium text-slate-600 overflow-x-auto"
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
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
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

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onTriggerUploadModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <UploadCloud className="w-4 h-4" aria-hidden="true" />
          <span>Upload Files</span>
        </button>
      </div>
    </header>
  );
};
