import React from 'react';
import { Anchor, Compass, Feather, HeartHandshake, Layers } from 'lucide-react';

interface WelcomeScreenProps {
  onSignIn: () => void;
  isLoading: boolean;
  authError: string | null;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onSignIn,
  isLoading,
  authError,
}) => {
  return (
    <main className="flex-1 bg-[#F4ECE0] px-6 py-12 md:py-16 flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
        {/* Left column: Grounding editorial welcome */}
        <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
          <p className="text-xs font-medium tracking-wide text-[#635345]">
            Thinking Sanctuary · Mind Map &amp; Priority Studio
          </p>

          <h1 className="font-display text-4xl md:text-5xl font-medium tracking-tight text-[#2B2118] leading-[1.12] [text-wrap:balance]">
            Turn scattered thoughts into calm, clear ground.
          </h1>

          <p className="text-base leading-relaxed text-[#635345] max-w-xl">
            Sloww weaves your unfiltered brain dumps, visual mind map, integrated priorities,
            hidden patterns, and a wise companion into one quiet workspace that saves everywhere you go.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
            <button
              type="button"
              onClick={onSignIn}
              disabled={isLoading}
              className="px-6 py-3 text-sm font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F735D]"
            >
              {isLoading ? 'Opening your sanctuary...' : 'Sign in with Google'}
            </button>
            <span className="text-xs text-[#8C7A68]">
              Private to your account · Auto-saved across sessions
            </span>
          </div>

          {authError && (
            <p className="text-sm text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded-md px-4 py-3">
              {authError}
            </p>
          )}
        </div>

        {/* Right column: Calm architectural overview of the five pillars */}
        <div className="lg:col-span-6 bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-medium text-[#2B2118]">
              Five gentle movements in one place
            </h2>
            <p className="text-sm text-[#635345]">
              Designed to slow down overwhelm rather than speed it up.
            </p>
          </div>

          <div className="divide-y divide-[#DDD1BD]">
            <div className="py-3.5 flex items-start gap-3.5">
              <Feather className="w-4 h-4 text-[#5F735D] mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#2B2118]">Brain Dump Stream</p>
                <p className="text-xs text-[#635345] leading-relaxed">
                  Empty your head without formatting, then let smart intelligence gently untangle it onto your canvas.
                </p>
              </div>
            </div>

            <div className="py-3.5 flex items-start gap-3.5">
              <Layers className="w-4 h-4 text-[#5F735D] mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#2B2118]">Mind Map with Integrated Priority Hearth</p>
                <p className="text-xs text-[#635345] leading-relaxed">
                  Your Today, Up Next, and Later priorities live right inside the mind map, linked to the cards that feed them.
                </p>
              </div>
            </div>

            <div className="py-3.5 flex items-start gap-3.5">
              <Anchor className="w-4 h-4 text-[#C48A47] mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#2B2118]">Priority Threads</p>
                <p className="text-xs text-[#635345] leading-relaxed">
                  Pin any map card to Today or drag it straight into the Hearth without losing its context.
                </p>
              </div>
            </div>

            <div className="py-3.5 flex items-start gap-3.5">
              <Compass className="w-4 h-4 text-[#5F735D] mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#2B2118]">Pattern Finder</p>
                <p className="text-xs text-[#635345] leading-relaxed">
                  Surfaces recurring themes, subtle tensions, and where your energy wants to rest—then spotlights those exact nodes.
                </p>
              </div>
            </div>

            <div className="pt-3.5 flex items-start gap-3.5">
              <HeartHandshake className="w-4 h-4 text-[#B86B4B] mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#2B2118]">Wise, Grounding Companion</p>
                <p className="text-xs text-[#635345] leading-relaxed">
                  Calm, non-cheesy reflections and tiny compassionate steps whenever you finish something or feel scattered.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
