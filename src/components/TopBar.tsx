import React from 'react';
import { LogOut } from 'lucide-react';

export type MobileSection = 'map' | 'dump' | 'patterns';

interface TopBarProps {
  userName?: string | null;
  activeSection: MobileSection;
  onSelectSection: (section: MobileSection) => void;
  onOpenSanctuaries: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
  isSignedIn: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  userName,
  activeSection,
  onSelectSection,
  onOpenSanctuaries,
  onSignOut,
  onSignIn,
  isSignedIn,
}) => {
  const firstName = userName ? userName.split(' ')[0] : 'Account';

  return (
    <header className="h-12 shrink-0 border-b border-[#DDD1BD] bg-[#FBF6EC] px-5 flex items-center justify-between gap-6">
      {/* Zone 1: Single-element brand wordmark */}
      <a
        href="#workspace"
        onClick={(e) => {
          e.preventDefault();
          onSelectSection('patterns');
        }}
        className="font-display text-xl font-medium tracking-tight text-[#2B2118] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F735D]"
      >
        Sloww
      </a>

      {/* Zone 2: Clean single-line workspace tabs (available immediately in sandbox and when signed in) */}
      <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#635345]">
        <button
          type="button"
          onClick={() => onSelectSection('patterns')}
          className={`py-1 whitespace-nowrap shrink-0 transition-colors hover:text-[#2B2118] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F735D] ${
            activeSection === 'patterns'
              ? 'text-[#2B2118] underline underline-offset-8 decoration-[#5F735D] decoration-2'
              : ''
          }`}
        >
          Nourishment
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('dump')}
          className={`py-1 whitespace-nowrap shrink-0 transition-colors hover:text-[#2B2118] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F735D] ${
            activeSection === 'dump'
              ? 'text-[#2B2118] underline underline-offset-8 decoration-[#5F735D] decoration-2'
              : ''
          }`}
        >
          Journal
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('map')}
          className={`py-1 whitespace-nowrap shrink-0 transition-colors hover:text-[#2B2118] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F735D] ${
            activeSection === 'map'
              ? 'text-[#2B2118] underline underline-offset-8 decoration-[#5F735D] decoration-2'
              : ''
          }`}
        >
          Mind Map
        </button>
        <button
          type="button"
          onClick={onOpenSanctuaries}
          className="py-1 whitespace-nowrap shrink-0 transition-colors hover:text-[#2B2118] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F735D]"
        >
          Sanctuaries
        </button>
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        {isSignedIn ? (
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#2B2118] border border-[#DDD1BD] bg-[#FBF6EC] rounded-md hover:bg-[#EFE8DA] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F735D]"
            title={`Signed in as ${userName || 'User'}`}
          >
            <span>Sign out</span>
            <span className="text-[#8C7A68]" aria-hidden="true">·</span>
            <span className="max-w-[96px] truncate text-[#635345]">{firstName}</span>
            <LogOut className="w-3.5 h-3.5 text-[#635345]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="px-4 py-2 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F735D]"
          >
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
};
