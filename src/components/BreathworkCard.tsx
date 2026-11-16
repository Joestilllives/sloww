import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, ChevronDown, ChevronUp, Info, Pause, Play, RotateCcw, Wind } from 'lucide-react';
import { soundscapeEngine } from '../lib/soundscape';

type CadenceId = 'vagal' | 'box' | 'sigh' | 'humming';

interface BreathPhase {
  label: 'Inhale' | 'Top-up' | 'Hold' | 'Exhale' | 'Hum Out' | 'Rest';
  seconds: number;
  tone: 'sage' | 'amber' | 'terracotta';
}

interface CadenceSpec {
  short: string;
  name: string;
  rhythm: string;
  bestFor: string;
  benefit: string;
  phases: BreathPhase[];
}

const CADENCES: Record<CadenceId, CadenceSpec> = {
  vagal: {
    short: '4–6',
    name: '4–6 Vagal Calm',
    rhythm: '4s inhale · 6s exhale',
    bestFor: 'Slowing a racing mind & softening anxiety',
    benefit:
      'Extending your exhale longer than your inhale stimulates the vagus nerve, gently lowering heart rate and signaling your nervous system that it is safe to settle.',
    phases: [
      { label: 'Inhale', seconds: 4, tone: 'sage' },
      { label: 'Exhale', seconds: 6, tone: 'terracotta' },
    ],
  },
  box: {
    short: 'Box',
    name: '4–4–4–4 Box Breathing',
    rhythm: '4s in · 4s hold · 4s out · 4s rest',
    bestFor: 'Steadying focus & grounding before action',
    benefit:
      'Equal-length phases balance oxygen and carbon dioxide levels, quieting scattered adrenaline and creating calm, alert steadiness under pressure.',
    phases: [
      { label: 'Inhale', seconds: 4, tone: 'sage' },
      { label: 'Hold', seconds: 4, tone: 'amber' },
      { label: 'Exhale', seconds: 4, tone: 'terracotta' },
      { label: 'Rest', seconds: 4, tone: 'amber' },
    ],
  },
  sigh: {
    short: 'Sigh',
    name: 'Psychological Sigh',
    rhythm: '2s inhale · 1s top-up · 6s sigh out',
    bestFor: 'Fast relief from acute overwhelm',
    benefit:
      'Two nasal inhales followed by a long exhale re-inflate tiny lung air sacs (alveoli) and offload CO₂ rapidly—research shows it reduces stress arousal in just a few cycles.',
    phases: [
      { label: 'Inhale', seconds: 2, tone: 'sage' },
      { label: 'Top-up', seconds: 1, tone: 'sage' },
      { label: 'Exhale', seconds: 6, tone: 'terracotta' },
    ],
  },
  humming: {
    short: 'Humming',
    name: 'Humming Breath',
    rhythm: '4s inhale · 6s soft hum out',
    bestFor: 'Releasing chest tension & mental noise',
    benefit:
      'A gentle closed-lip hum vibrates the throat and sinuses, stimulating vagal tone and boosting nasal nitric oxide while giving busy thoughts a soothing physical anchor.',
    phases: [
      { label: 'Inhale', seconds: 4, tone: 'sage' },
      { label: 'Hum Out', seconds: 6, tone: 'terracotta' },
    ],
  },
};

interface BreathworkCardProps {
  totalBreaths: number;
  onBreathComplete?: () => void;
}

export const BreathworkCard: React.FC<BreathworkCardProps> = ({
  totalBreaths,
  onBreathComplete,
}) => {
  const [cadenceId, setCadenceId] = useState<CadenceId>('vagal');
  const [isBreathing, setIsBreathing] = useState(false);
  const [chimeEnabled, setChimeEnabled] = useState(false);
  const [benefitsOpen, setBenefitsOpen] = useState(false);
  const [breathState, setBreathState] = useState({
    phaseIdx: 0,
    secondsLeft: CADENCES.vagal.phases[0].seconds,
    sessionBreaths: 0,
  });

  const cadence = CADENCES[cadenceId];
  const currentPhase = cadence.phases[breathState.phaseIdx] || cadence.phases[0];
  const hasTopUpNext = cadence.phases[breathState.phaseIdx + 1]?.label === 'Top-up';

  const handleSelectCadence = (id: CadenceId) => {
    setCadenceId(id);
    setBreathState((prev) => ({
      ...prev,
      phaseIdx: 0,
      secondsLeft: CADENCES[id].phases[0].seconds,
    }));
  };

  useEffect(() => {
    if (!isBreathing) return;

    const timer = window.setInterval(() => {
      setBreathState((prev) => {
        if (prev.secondsLeft > 1) {
          return { ...prev, secondsLeft: prev.secondsLeft - 1 };
        }
        const nextIdx = (prev.phaseIdx + 1) % cadence.phases.length;
        const completedCycle = nextIdx === 0 ? 1 : 0;
        return {
          phaseIdx: nextIdx,
          secondsLeft: cadence.phases[nextIdx].seconds,
          sessionBreaths: prev.sessionBreaths + completedCycle,
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isBreathing, cadence]);

  const prevSessionRef = useRef(0);
  const onCompleteRef = useRef(onBreathComplete);
  onCompleteRef.current = onBreathComplete;

  useEffect(() => {
    if (breathState.sessionBreaths > prevSessionRef.current) {
      onCompleteRef.current?.();
    }
    prevSessionRef.current = breathState.sessionBreaths;
  }, [breathState.sessionBreaths]);

  useEffect(() => {
    if (!isBreathing || !chimeEnabled) return;
    const tone: 'inhale' | 'hold' | 'exhale' =
      currentPhase.label === 'Hold' || currentPhase.label === 'Rest'
        ? 'hold'
        : currentPhase.label === 'Exhale' || currentPhase.label === 'Hum Out'
          ? 'exhale'
          : 'inhale';
    soundscapeEngine.playBreathChime(tone);
  }, [isBreathing, chimeEnabled, breathState.phaseIdx, cadenceId, currentPhase.label]);

  const circleScale = useMemo(() => {
    if (!isBreathing) return 0.78;
    const total = currentPhase.seconds;
    const elapsed = total - breathState.secondsLeft + 1;
    const progress = Math.min(1, Math.max(0, elapsed / total));

    if (currentPhase.label === 'Inhale') {
      return hasTopUpNext ? 0.72 + progress * 0.32 : 0.72 + progress * 0.44;
    }
    if (currentPhase.label === 'Top-up') {
      return 1.04 + progress * 0.16;
    }
    if (currentPhase.label === 'Hold') return 1.16;
    if (currentPhase.label === 'Exhale' || currentPhase.label === 'Hum Out') {
      return 1.16 - progress * 0.44;
    }
    return 0.72;
  }, [isBreathing, currentPhase, breathState.secondsLeft, hasTopUpNext]);

  const circleColorClass =
    currentPhase.tone === 'terracotta'
      ? 'bg-[#B86B4B]/25 border-[#B86B4B]'
      : currentPhase.tone === 'amber'
        ? 'bg-[#C48A47]/25 border-[#C48A47]'
        : 'bg-[#5F735D]/25 border-[#5F735D]';

  const coreDotClass =
    currentPhase.tone === 'terracotta'
      ? 'bg-[#B86B4B]'
      : currentPhase.tone === 'amber'
        ? 'bg-[#C48A47]'
        : 'bg-[#5F735D]';

  return (
    <div className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg px-4 py-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wind className="w-4 h-4 text-[#5F735D]" />
          <h2 className="font-display text-sm font-medium text-[#2B2118]">
            Breathwork
          </h2>
          <span className="font-mono-tabular text-[11px] text-[#8C7A68]">
            · {totalBreaths} {totalBreaths === 1 ? 'breath' : 'breaths'}
          </span>
        </div>

        <div className="flex items-center p-0.5 bg-[#E4DAC7] rounded border border-[#D4C6B0] flex-wrap">
          {(Object.keys(CADENCES) as CadenceId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectCadence(id)}
              title={CADENCES[id].name}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                cadenceId === id
                  ? 'bg-[#FBF6EC] text-[#2B2118] shadow-2xs'
                  : 'text-[#635345] hover:text-[#2B2118]'
              }`}
            >
              {CADENCES[id].short}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center shrink-0" aria-hidden="true">
            <div
              style={{
                transform: `scale(${circleScale})`,
                transition: 'transform 950ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors duration-700 ${circleColorClass}`}
            >
              <div className={`w-2 h-2 rounded-full transition-colors duration-700 ${coreDotClass}`} />
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-xs font-medium text-[#2B2118] leading-tight">
              {isBreathing ? currentPhase.label : 'Ready'}
              <span className="text-[#8C7A68] mx-1" aria-hidden="true">·</span>
              <span className="font-mono-tabular text-[#635345]">
                {breathState.secondsLeft}s
              </span>
            </p>
            <p className="text-[11px] text-[#8C7A68] truncate">{cadence.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setChimeEnabled((v) => !v)}
            aria-pressed={chimeEnabled}
            aria-label={chimeEnabled ? 'Disable gentle phase chime' : 'Enable gentle phase chime'}
            title={chimeEnabled ? 'Soft chime on phase transitions: On' : 'Soft chime on phase transitions: Off'}
            className={`p-1.5 rounded border transition-colors ${
              chimeEnabled
                ? 'bg-[#EFE8DA] border-[#5F735D]/60 text-[#5F735D]'
                : 'bg-transparent border-transparent text-[#8C7A68] hover:text-[#2B2118] hover:bg-[#EFE8DA]'
            }`}
          >
            {chimeEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          </button>

          {(isBreathing || breathState.phaseIdx > 0) && (
            <button
              type="button"
              onClick={() => {
                setIsBreathing(false);
                setBreathState((prev) => ({
                  ...prev,
                  phaseIdx: 0,
                  secondsLeft: cadence.phases[0].seconds,
                }));
              }}
              aria-label="Reset breathing cycle"
              title="Reset current breath"
              className="p-1.5 text-[#8C7A68] hover:text-[#2B2118] rounded hover:bg-[#EFE8DA] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsBreathing((v) => !v)}
            aria-label={isBreathing ? 'Pause breathing guide' : 'Start breathing guide'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
              isBreathing
                ? 'bg-[#B86B4B] text-[#FBF6EC] border-[#B86B4B]'
                : 'bg-[#5F735D] text-[#FBF6EC] border-[#5F735D] hover:bg-[#4E604C]'
            }`}
          >
            {isBreathing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isBreathing ? 'Pause' : 'Breathe'}</span>
          </button>
        </div>
      </div>

      {/* Expandable Breathwork Benefits Guide */}
      <div className="pt-1 border-t border-[#EFE8DA]">
        <button
          type="button"
          onClick={() => setBenefitsOpen((v) => !v)}
          aria-expanded={benefitsOpen}
          className="w-full flex items-center justify-between gap-2 py-1 text-[11px] font-medium text-[#635345] hover:text-[#2B2118] transition-colors"
        >
          <span className="inline-flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#5F735D]" />
            <span>Why each breathwork style helps</span>
          </span>
          {benefitsOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#8C7A68]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#8C7A68]" />
          )}
        </button>

        {benefitsOpen && (
          <div className="mt-2 space-y-2">
            {(Object.keys(CADENCES) as CadenceId[]).map((id) => {
              const item = CADENCES[id];
              const isSelected = id === cadenceId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectCadence(id)}
                  className={`w-full text-left rounded-md border px-3 py-2 space-y-1 transition-colors ${
                    isSelected
                      ? 'bg-[#F4ECE0] border-[#5F735D]'
                      : 'bg-[#FBF6EC] border-[#E4DAC7] hover:bg-[#F4ECE0]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#2B2118]">
                      {item.name}
                    </span>
                    <span className="font-mono-tabular text-[10px] text-[#8C7A68] shrink-0">
                      {item.rhythm}
                    </span>
                  </div>
                  <p className="text-[11px] font-medium text-[#5F735D]">
                    Best for: {item.bestFor}
                  </p>
                  <p className="text-[11px] leading-relaxed text-[#635345]">
                    {item.benefit}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
