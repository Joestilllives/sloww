import React, { useState } from 'react';
import {
  Anchor,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Compass,
  Feather,
  Heart,
  HeartHandshake,
  Moon,
  RefreshCw,
  Scale,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { MapNode, MindMap, PatternInsight, PatternTone } from '../types';
import { NourishmentPlant } from './NourishmentPlant';
import { BreathworkCard } from './BreathworkCard';
import { Grounding54321Bar } from './Grounding54321Bar';
import { DailyStoicismCard } from './DailyStoicismCard';

type CompanionTrigger = 'ground' | 'self-care' | 'letting-go';

interface CompanionAndPatternsRailProps {
  activeMap: MindMap;
  nodes: MapNode[];
  patterns: PatternInsight[];
  activePatternId: string | null;
  completedCount: number;
  dumpCount: number;
  onBreathComplete: () => void;
  onWaterPlant: () => Promise<void>;
  onResetPlant: (activityPoints: number) => Promise<void>;
  onSelectPattern: (pattern: PatternInsight) => void;
  onSpotlightOnMap: (pattern: PatternInsight) => void;
  onFindPatterns: () => Promise<void>;
  onAskCompanion: (trigger: CompanionTrigger) => Promise<void>;
  isFindingPatterns: boolean;
  isAskingCompanion: boolean;
  aiError: string | null;
}

const TONE_META: Record<
  PatternTone,
  { label: string; colorClass: string; Icon: React.FC<{ className?: string }> }
> = {
  anchor: { label: 'Grounding Anchor', colorClass: 'text-[#5F735D]', Icon: Anchor },
  tension: { label: 'Gentle Tension', colorClass: 'text-[#B86B4B]', Icon: Scale },
  momentum: { label: 'Quiet Momentum', colorClass: 'text-[#94622A]', Icon: Sun },
  rest: { label: 'Need for Rest', colorClass: 'text-[#635345]', Icon: Moon },
};

export const CompanionAndPatternsRail: React.FC<CompanionAndPatternsRailProps> = ({
  activeMap,
  nodes,
  patterns,
  activePatternId,
  completedCount,
  dumpCount,
  onBreathComplete,
  onWaterPlant,
  onResetPlant,
  onSelectPattern,
  onSpotlightOnMap,
  onFindPatterns,
  onAskCompanion,
  isFindingPatterns,
  isAskingCompanion,
  aiError,
}) => {
  const [activeTrigger, setActiveTrigger] = useState<CompanionTrigger | null>(null);
  const [companionOpen, setCompanionOpen] = useState(true);
  const title = activeMap.encouragementTitle || 'A quiet place to land';
  const note =
    activeMap.encouragementNote ||
    'Nothing here asks you to rush. Let your thoughts sit on the paper until their shape becomes clear, then choose just one thread to hold.';
  const step =
    activeMap.encouragementStep ||
    'Take one slow breath, then check what feels lightest to begin.';

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const handleCompanionPrompt = async (trigger: CompanionTrigger) => {
    if (isAskingCompanion) return;
    setActiveTrigger(trigger);
    try {
      await onAskCompanion(trigger);
    } finally {
      setActiveTrigger(null);
    }
  };

  return (
    <section
      aria-label="Nourishment: Quiet Garden, Breathwork, Wise Companion, Pattern Finder, and Daily Stoicism"
      className="flex-1 h-full overflow-y-auto calm-scroll bg-[#F4ECE0]"
    >
      <div className="max-w-5xl mx-auto px-5 py-6 md:px-8 md:py-8 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <HeartHandshake className="w-4 h-4 text-[#B86B4B]" />
            <h1 className="font-display text-2xl font-medium text-[#2B2118]">
              Nourishment
            </h1>
          </div>
          <p className="text-xs text-[#635345] mt-1">
            Tend your garden and breath, pause with the Wise Companion, uncover patterns, reflect on today’s Stoic tenet, and practice sensory grounding.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Nourishment Plant + Wise Companion */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg overflow-hidden">
              <NourishmentPlant
                mapId={activeMap.id}
                completedCount={completedCount}
                dumpCount={dumpCount}
                patternCount={patterns.length}
                breathCount={activeMap.breathCount ?? 0}
                waterDrops={activeMap.waterDrops ?? 0}
                nourishmentOffset={activeMap.nourishmentOffset ?? 0}
                onWater={onWaterPlant}
                onReset={onResetPlant}
              />
            </div>

            <BreathworkCard
              totalBreaths={activeMap.breathCount ?? 0}
              onBreathComplete={onBreathComplete}
            />

            <section
              aria-label="Wise Companion"
              className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setCompanionOpen((v) => !v)}
                aria-expanded={companionOpen}
                className="w-full px-5 py-4 flex items-center justify-between gap-2 text-left hover:bg-[#F4ECE0]/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <HeartHandshake className="w-4 h-4 text-[#B86B4B]" />
                  <h2 className="font-display text-base font-medium text-[#2B2118]">
                    Wise Companion
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#635345] shrink-0">
                  <span>{companionOpen ? 'Hide' : 'Open'}</span>
                  {companionOpen ? (
                    <ChevronUp className="w-4 h-4 text-[#8C7A68]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8C7A68]" />
                  )}
                </span>
              </button>

              {companionOpen && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t border-[#EFE8DA]">
                  <div className="rounded-md bg-[#F4ECE0] border border-[#DDD1BD] p-4 space-y-3 mt-3">
                    <h3 className="font-display text-base font-medium text-[#2B2118] leading-snug">
                      {title}
                    </h3>
                    <p className="text-xs leading-relaxed text-[#635345]">
                      {note}
                    </p>
                    <div className="pt-2.5 border-t border-[#DDD1BD]">
                      <p className="text-[11px] font-medium text-[#5F735D]">One tiny step</p>
                      <p className="text-xs text-[#2B2118] mt-0.5 leading-relaxed">{step}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={isAskingCompanion}
                      onClick={() => void handleCompanionPrompt('ground')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#5F735D] bg-[#EFE8DA] border border-[#DDD1BD] rounded-md hover:bg-[#E4DAC7] hover:text-[#2B2118] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {isAskingCompanion && activeTrigger === 'ground' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Anchor className="w-3 h-3" />
                      )}
                      <span>
                        {isAskingCompanion && activeTrigger === 'ground' ? 'Grounding...' : 'Ground Me'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isAskingCompanion}
                      onClick={() => void handleCompanionPrompt('self-care')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#5F735D] bg-[#EFE8DA] border border-[#DDD1BD] rounded-md hover:bg-[#E4DAC7] hover:text-[#2B2118] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {isAskingCompanion && activeTrigger === 'self-care' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Heart className="w-3 h-3" />
                      )}
                      <span>
                        {isAskingCompanion && activeTrigger === 'self-care'
                          ? 'Tending...'
                          : 'Self-Care'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isAskingCompanion}
                      onClick={() => void handleCompanionPrompt('letting-go')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#5F735D] bg-[#EFE8DA] border border-[#DDD1BD] rounded-md hover:bg-[#E4DAC7] hover:text-[#2B2118] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {isAskingCompanion && activeTrigger === 'letting-go' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Feather className="w-3 h-3" />
                      )}
                      <span>
                        {isAskingCompanion && activeTrigger === 'letting-go'
                          ? 'Releasing...'
                          : 'Letting Go'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Compressed Pattern Finder + Daily Stoicism */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDD1BD]">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[#5F735D]" />
                  <h2 className="font-display text-base font-medium text-[#2B2118]">
                    Pattern Finder
                  </h2>
                </div>

                <button
                  type="button"
                  disabled={isFindingPatterns}
                  onClick={() => void onFindPatterns()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {isFindingPatterns ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  <span>{isFindingPatterns ? 'Reading...' : 'Find Pattern'}</span>
                </button>
              </div>

              {aiError && (
                <p className="text-xs text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded-md px-3 py-2">
                  {aiError}
                </p>
              )}

              {(() => {
                const activeIdx = activePatternId
                  ? patterns.findIndex((p) => p.id === activePatternId)
                  : -1;
                const currentPattern = activeIdx >= 0 ? patterns[activeIdx] : null;

                if (patterns.length === 0) {
                  return (
                    <p className="text-xs text-[#8C7A68] py-3 px-3 rounded-md border border-dashed border-[#DDD1BD] leading-relaxed">
                      Add a few cards or journal entries, then press <strong className="font-medium text-[#635345]">Find Pattern</strong> to uncover one recurring thread.
                    </p>
                  );
                }

                if (!currentPattern) {
                  return (
                    <p className="text-xs text-[#635345] py-3 px-3.5 rounded-md bg-[#F4ECE0]/60 border border-[#DDD1BD] leading-relaxed">
                      Press <strong className="font-medium text-[#2B2118]">Find Pattern</strong> to surface one quiet thread across your map. Press it again anytime to shift to another angle.
                    </p>
                  );
                }

                const toneInfo = TONE_META[currentPattern.tone] || TONE_META.anchor;
                const ToneIcon = toneInfo.Icon;
                const linkedNodes = currentPattern.relatedNodeIds
                  .map((id) => nodeMap.get(id))
                  .filter((n): n is MapNode => Boolean(n));

                return (
                  <div className="space-y-2.5">
                    <div className="rounded-md border border-[#5F735D] bg-[#E5EBE3]/65 p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#635345]">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${toneInfo.colorClass}`}>
                          <ToneIcon className="w-3.5 h-3.5" />
                          {toneInfo.label}
                        </span>
                        <span className="font-mono-tabular text-[#8C7A68]">
                          {activeIdx + 1} of {patterns.length} · {linkedNodes.length}{' '}
                          {linkedNodes.length === 1 ? 'thread' : 'threads'}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-[#2B2118] leading-snug">
                        {currentPattern.title}
                      </p>
                      <p className="text-xs leading-relaxed text-[#635345]">
                        {currentPattern.insight}
                      </p>

                      {linkedNodes.length > 0 && (
                        <div className="pt-2 border-t border-[#DDD1BD]/80 space-y-2">
                          <div className="space-y-1">
                            {linkedNodes.map((n) => (
                              <p
                                key={n.id}
                                className="text-[11px] text-[#2B2118] flex items-baseline gap-1.5"
                              >
                                <span className="text-[#5F735D]" aria-hidden="true">·</span>
                                <span className={n.completed ? 'line-through text-[#8C7A68]' : ''}>
                                  {n.text}
                                </span>
                              </p>
                            ))}
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => onSpotlightOnMap(currentPattern)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#5F735D] bg-[#FBF6EC] border border-[#5F735D]/50 rounded-md hover:bg-[#5F735D] hover:text-[#FBF6EC] transition-colors whitespace-nowrap"
                            >
                              <span>Spotlight on Map</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#8C7A68]">
                      <span>Press Find Pattern again to shift to another thread.</span>
                      <button
                        type="button"
                        onClick={() => onSelectPattern(currentPattern)}
                        className="hover:text-[#2B2118] underline underline-offset-2 shrink-0"
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <DailyStoicismCard />
          </div>
        </div>

        <Grounding54321Bar />
      </div>
    </section>
  );
};
