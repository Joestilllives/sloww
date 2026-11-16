import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Ear, Eye, Hand, RotateCcw, Sparkles, Wind } from 'lucide-react';

interface GroundingStep {
  count: number;
  sense: string;
  prompt: string;
  examples: string;
  Icon: React.FC<{ className?: string }>;
  accentClass: string;
  activeDotClass: string;
}

const GROUNDING_STEPS: GroundingStep[] = [
  {
    count: 5,
    sense: 'Things you can see',
    prompt: 'Let your eyes rest gently on five ordinary details.',
    examples: 'A shadow on the wall, wood grain, a cup, a leaf, a corner of light',
    Icon: Eye,
    accentClass: 'text-[#5F735D]',
    activeDotClass: 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]',
  },
  {
    count: 4,
    sense: 'Things you can feel',
    prompt: 'Notice four real points of physical contact.',
    examples: 'Feet on the floor, your chair behind you, cool air, your sleeve',
    Icon: Hand,
    accentClass: 'text-[#C48A47]',
    activeDotClass: 'bg-[#C48A47] border-[#C48A47] text-[#FBF6EC]',
  },
  {
    count: 3,
    sense: 'Things you can hear',
    prompt: 'Listen without judging for three soft sounds.',
    examples: 'The hum of the room, distant traffic, the rhythm of your breath',
    Icon: Ear,
    accentClass: 'text-[#635345]',
    activeDotClass: 'bg-[#635345] border-[#635345] text-[#FBF6EC]',
  },
  {
    count: 2,
    sense: 'Things you can smell',
    prompt: 'Notice two subtle scents—or recall two comforting ones.',
    examples: 'Fresh air, warm tea, soap, rain, paper',
    Icon: Wind,
    accentClass: 'text-[#5F735D]',
    activeDotClass: 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]',
  },
  {
    count: 1,
    sense: 'Thing you can taste',
    prompt: 'Notice one taste in your mouth—or name one steady truth right now.',
    examples: 'Mint, water, coffee, or simply "I am safe in this seat right now"',
    Icon: Sparkles,
    accentClass: 'text-[#B86B4B]',
    activeDotClass: 'bg-[#B86B4B] border-[#B86B4B] text-[#FBF6EC]',
  },
];

const TOTAL_TAPS = GROUNDING_STEPS.reduce((sum, step) => sum + step.count, 0);

export const Grounding54321Bar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [checkedCounts, setCheckedCounts] = useState<Record<number, number>>({
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
  });

  const totalChecked = Object.values(checkedCounts).reduce((sum, val) => sum + val, 0);
  const allGrounded = totalChecked >= TOTAL_TAPS;

  const handleTapStepDot = (stepCount: number, index: number) => {
    setCheckedCounts((prev) => {
      const current = prev[stepCount] || 0;
      const target = index + 1;
      // Clicking the last active circle toggles it back one step; otherwise fills up to clicked circle
      const next = current === target ? target - 1 : target;
      return { ...prev, [stepCount]: next };
    });
  };

  const handleReset = () => {
    setCheckedCounts({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
  };

  return (
    <div className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="w-full px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-[#F4ECE0]/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-7 h-7 rounded-md bg-[#EFE8DA] border border-[#DDD1BD] flex items-center justify-center font-mono-tabular text-xs font-semibold text-[#5F735D] shrink-0">
            5–1
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-medium text-[#2B2118] leading-snug">
              5–4–3–2–1 Sensory Grounding
            </h2>
            <p className="text-[11px] text-[#8C7A68] leading-snug">
              For moments of anxiety — gently return to your five senses, one tap at a time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {totalChecked > 0 && (
            <span className="font-mono-tabular text-[11px] text-[#5F735D] font-medium">
              {allGrounded ? 'Grounded' : `${totalChecked}/${TOTAL_TAPS}`}
            </span>
          )}
          <span className="text-[11px] text-[#635345] font-medium hidden sm:inline">
            {isOpen ? 'Hide' : 'Open'}
          </span>
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-[#8C7A68]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#8C7A68]" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-2 border-t border-[#EFE8DA] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#635345]">
            <p className="leading-relaxed">
              Slow down and look around the room. Tap each circle as you notice something real—no need to rush or write anything down.
            </p>
            {totalChecked > 0 && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#635345] hover:text-[#2B2118] bg-[#F4ECE0] border border-[#DDD1BD] rounded transition-colors shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Start fresh</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {GROUNDING_STEPS.map((step) => {
              const Icon = step.Icon;
              const filled = checkedCounts[step.count] || 0;
              const stepDone = filled >= step.count;

              return (
                <div
                  key={step.count}
                  className={`rounded-md border p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                    stepDone
                      ? 'bg-[#E5EBE3]/45 border-[#5F735D]/50'
                      : 'bg-[#F4ECE0]/55 border-[#DDD1BD]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${step.accentClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                        <span className="font-mono-tabular">{step.count}</span>
                      </span>
                      <span className="font-mono-tabular text-[10px] text-[#8C7A68]">
                        {filled}/{step.count}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-[#2B2118] leading-snug">
                      {step.sense}
                    </p>
                    <p className="text-[11px] text-[#635345] leading-relaxed">
                      {step.prompt}
                    </p>
                    <p className="text-[10px] text-[#8C7A68] leading-snug italic">
                      e.g. {step.examples}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 pt-1" role="group" aria-label={`${step.count} ${step.sense}`}>
                    {Array.from({ length: step.count }).map((_, idx) => {
                      const active = idx < filled;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleTapStepDot(step.count, idx)}
                          aria-pressed={active}
                          aria-label={`${step.sense} ${idx + 1} of ${step.count}`}
                          className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-mono-tabular transition-colors ${
                            active
                              ? step.activeDotClass
                              : 'bg-[#FBF6EC] border-[#CFC0A8] text-[#8C7A68] hover:border-[#5F735D]'
                          }`}
                        >
                          {active ? <Check className="w-3 h-3" /> : idx + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {allGrounded && (
            <div className="rounded-md bg-[#E5EBE3]/65 border border-[#5F735D]/40 px-4 py-3 text-xs text-[#2B2118] flex flex-wrap items-center justify-between gap-2">
              <p className="leading-relaxed">
                You are right here in this room, in this moment. Let your shoulders drop—nothing urgent is asked of you right this second.
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="text-[11px] font-medium text-[#5F735D] hover:underline shrink-0"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
