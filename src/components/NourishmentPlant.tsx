import React, { useEffect, useRef, useState } from 'react';
import { Droplets, RotateCcw, Sprout } from 'lucide-react';

interface NourishmentPlantProps {
  mapId: string;
  completedCount: number;
  dumpCount: number;
  patternCount: number;
  breathCount: number;
  waterDrops: number;
  nourishmentOffset?: number;
  onWater: () => Promise<void> | void;
  onReset: (currentActivityPoints: number) => Promise<void> | void;
}

interface StageInfo {
  stage: number;
  title: string;
  caption: string;
  minPoints: number;
  nextPoints: number | null;
}

const STAGES: StageInfo[] = [
  {
    stage: 1,
    title: 'Resting Seed',
    caption: 'Quietly gathering warmth beneath the soil.',
    minPoints: 0,
    nextPoints: 4,
  },
  {
    stage: 2,
    title: 'First Leaves',
    caption: 'Two tender sage leaves opening to the light.',
    minPoints: 4,
    nextPoints: 10,
  },
  {
    stage: 3,
    title: 'Steadily Rooting',
    caption: 'A young stem finding calm balance.',
    minPoints: 10,
    nextPoints: 18,
  },
  {
    stage: 4,
    title: 'Quiet Foliage',
    caption: 'Unhurried growth nourished by small honest steps.',
    minPoints: 18,
    nextPoints: 28,
  },
  {
    stage: 5,
    title: 'Branching Canopy',
    caption: 'Side shoots unfurling into deeper, steadier green.',
    minPoints: 28,
    nextPoints: 41,
  },
  {
    stage: 6,
    title: 'Gathering Warmth',
    caption: 'Amber buds forming among steady sage leaves.',
    minPoints: 41,
    nextPoints: 56,
  },
  {
    stage: 7,
    title: 'Opening Blossom',
    caption: 'A first warm bloom opening without any hurry.',
    minPoints: 56,
    nextPoints: 75,
  },
  {
    stage: 8,
    title: 'Full Sanctuary Bloom',
    caption: 'Rooted and flourishing. Keep tending or replant a fresh seed anytime.',
    minPoints: 75,
    nextPoints: null,
  },
];

function getStage(points: number): StageInfo {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (points >= STAGES[i].minPoints) return STAGES[i];
  }
  return STAGES[0];
}

export const NourishmentPlant: React.FC<NourishmentPlantProps> = ({
  mapId,
  completedCount,
  dumpCount,
  patternCount,
  breathCount,
  waterDrops,
  nourishmentOffset = 0,
  onWater,
  onReset,
}) => {
  const [isWatering, setIsWatering] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [justNourished, setJustNourished] = useState(false);

  const activityPoints = completedCount * 2 + dumpCount + patternCount;
  const totalPoints = Math.max(0, activityPoints - nourishmentOffset) + breathCount + waterDrops;
  const prevPointsRef = useRef(totalPoints);
  const prevMapIdRef = useRef(mapId);

  useEffect(() => {
    if (prevMapIdRef.current !== mapId) {
      prevMapIdRef.current = mapId;
      prevPointsRef.current = totalPoints;
      setJustNourished(false);
      setConfirmingReset(false);
      return;
    }

    if (totalPoints > prevPointsRef.current) {
      setJustNourished(true);
      const t = window.setTimeout(() => setJustNourished(false), 1400);
      prevPointsRef.current = totalPoints;
      return () => window.clearTimeout(t);
    }
    prevPointsRef.current = totalPoints;
  }, [mapId, totalPoints]);

  const handleWaterClick = async () => {
    if (isWatering || isResetting) return;
    setIsWatering(true);
    try {
      await onWater();
    } finally {
      setIsWatering(false);
    }
  };

  const handleResetConfirm = async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      await onReset(activityPoints);
      setConfirmingReset(false);
    } finally {
      setIsResetting(false);
    }
  };

  const stageInfo = getStage(totalPoints);
  const stage = stageInfo.stage;

  const progressPct = stageInfo.nextPoints
    ? Math.min(
        100,
        Math.round(
          ((totalPoints - stageInfo.minPoints) /
            (stageInfo.nextPoints - stageInfo.minPoints)) *
            100
        )
      )
    : 100;

  const canReset = totalPoints > 0 || breathCount > 0 || waterDrops > 0;

  return (
    <div className="p-5 border-b border-[#DDD1BD] space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sprout className="w-4 h-4 text-[#5F735D]" />
          <h2 className="font-display text-base font-medium text-[#2B2118]">
            Quiet Garden
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {canReset && !confirmingReset && (
            <button
              type="button"
              disabled={isWatering || isResetting}
              onClick={() => setConfirmingReset(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#8C7A68] border border-[#DDD1BD] bg-[#FBF6EC] rounded-md hover:bg-[#EFE8DA] hover:text-[#2B2118] disabled:opacity-60 transition-colors whitespace-nowrap"
              title="Replant a fresh seed from Stage 1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Replant</span>
            </button>
          )}

          <button
            type="button"
            disabled={isWatering || isResetting}
            onClick={() => void handleWaterClick()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#5F735D] border border-[#DDD1BD] bg-[#F4ECE0] rounded-md hover:bg-[#E5EBE3] disabled:opacity-60 transition-colors whitespace-nowrap"
            title="Pause for a quiet drop of water"
          >
            <Droplets className="w-3 h-3" />
            <span>{isWatering ? 'Watering...' : 'Water'}</span>
          </button>
        </div>
      </div>

      {confirmingReset && (
        <div className="rounded-md bg-[#F4ECE0] border border-[#DDD1BD] px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="text-[#635345]">Replant a fresh seed? Your map stays safe.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isResetting}
              onClick={() => setConfirmingReset(false)}
              className="px-2 py-0.5 text-[#635345] hover:text-[#2B2118]"
            >
              Keep
            </button>
            <button
              type="button"
              disabled={isResetting}
              onClick={() => void handleResetConfirm()}
              className="px-2.5 py-0.5 font-medium text-[#FBF6EC] bg-[#B86B4B] rounded hover:bg-[#9E593D] disabled:opacity-60"
            >
              {isResetting ? 'Replanting...' : 'Replant'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        {/* Artisanal Slow-Growing Botanical SVG (8 Stages) */}
        <div className="w-24 h-28 shrink-0 rounded-md bg-[#F4ECE0] border border-[#DDD1BD] flex items-center justify-center relative overflow-hidden">
          <svg
            viewBox="0 0 110 128"
            className="w-22 h-26 overflow-visible"
            role="img"
            aria-label={`Plant at stage ${stage}: ${stageInfo.title}`}
          >
            {/* Subtle warm sun halo behind plant */}
            <circle
              cx="55"
              cy="46"
              r={stage >= 7 ? 38 : stage >= 5 ? 32 : 25}
              fill="#C48A47"
              opacity={justNourished ? 0.18 : stage >= 8 ? 0.12 : 0.08}
              style={{ transition: 'all 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />

            {/* Falling water droplet shimmer when nourished */}
            {justNourished && (
              <path
                d="M55 12 C58 17 59 20 55 22 C51 20 52 17 55 12 Z"
                fill="#5F735D"
                opacity="0.75"
              >
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0 -4"
                  to="0 62"
                  dur="1.1s"
                  fill="freeze"
                />
                <animate attributeName="opacity" from="0.85" to="0" dur="1.1s" fill="freeze" />
              </path>
            )}

            {/* Plant Stem & Leaves */}
            <g
              style={{
                transformOrigin: '55px 88px',
                transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Stage 1: Tiny shoot */}
              <path
                d="M55 88 Q55 81 57 77"
                fill="none"
                stroke="#5F735D"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              {stage === 1 && (
                <ellipse cx="58" cy="76" rx="3.5" ry="2.2" transform="rotate(-20 58 76)" fill="#748A71" />
              )}

              {/* Stage 2+: Main stem + first cotyledons */}
              {stage >= 2 && (
                <>
                  <path
                    d="M55 88 Q54 74 55 62"
                    fill="none"
                    stroke="#5F735D"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M54 78 C46 76 41 70 43 66 C47 65 52 71 54 77 Z"
                    fill="#748A71"
                  />
                  <path
                    d="M55 76 C63 74 68 68 66 64 C62 63 57 69 55 75 Z"
                    fill="#5F735D"
                  />
                </>
              )}

              {/* Stage 3+: Taller arching stem + secondary leaves */}
              {stage >= 3 && (
                <>
                  <path
                    d="M55 64 Q56 51 54 42"
                    fill="none"
                    stroke="#5F735D"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M55 60 C44 58 36 50 39 45 C44 43 51 51 55 59 Z"
                    fill="#5F735D"
                  />
                  <path
                    d="M55 56 C66 53 73 45 70 40 C65 39 58 47 55 55 Z"
                    fill="#748A71"
                  />
                </>
              )}

              {/* Stage 4+: Upper stem + foliage */}
              {stage >= 4 && (
                <>
                  <path
                    d="M54 44 Q52 34 55 26"
                    fill="none"
                    stroke="#5F735D"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M54 44 C45 40 39 32 42 28 C46 27 52 35 54 43 Z"
                    fill="#748A71"
                  />
                  <path
                    d="M55 38 C64 35 70 28 67 24 C63 23 57 30 55 37 Z"
                    fill="#4B5D49"
                  />
                  <path
                    d="M55 27 C52 21 53 16 56 15 C59 17 58 22 55 27 Z"
                    fill="#748A71"
                  />
                </>
              )}

              {/* Stage 5+: Branching canopy & side fronds */}
              {stage >= 5 && (
                <>
                  <path
                    d="M54 54 Q43 44 35 37"
                    fill="none"
                    stroke="#5F735D"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M35 37 C28 36 24 31 27 28 C31 28 34 32 35 37 Z"
                    fill="#4B5D49"
                  />
                  <path
                    d="M55 48 Q66 39 74 32"
                    fill="none"
                    stroke="#5F735D"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M74 32 C81 31 85 26 82 23 C78 23 75 27 74 32 Z"
                    fill="#5F735D"
                  />
                </>
              )}

              {/* Stage 6: Warm Amber Buds */}
              {stage === 6 && (
                <>
                  <circle cx="41" cy="28" r="3.2" fill="#C48A47" />
                  <circle cx="68" cy="24" r="3.2" fill="#C48A47" />
                  <circle cx="56" cy="15" r="3.8" fill="#D59B56" />
                </>
              )}

              {/* Stage 7: First Crown Blossom Opening + Side Buds */}
              {stage === 7 && (
                <>
                  <circle cx="39" cy="28" r="3.2" fill="#C48A47" />
                  <circle cx="70" cy="24" r="3.2" fill="#C48A47" />
                  <g transform="translate(56, 15)">
                    <circle cx="0" cy="-4" r="3.5" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="3.8" cy="-1.2" r="3.5" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="2.4" cy="3.2" r="3.5" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="-2.4" cy="3.2" r="3.5" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="-3.8" cy="-1.2" r="3.5" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="0" cy="0" r="2.6" fill="#C48A47" />
                  </g>
                </>
              )}

              {/* Stage 8: Full Sanctuary Bloom */}
              {stage >= 8 && (
                <>
                  {/* Top blossom */}
                  <g transform="translate(56, 15)">
                    <circle cx="0" cy="-4.2" r="3.6" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="4" cy="-1.3" r="3.6" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="2.5" cy="3.4" r="3.6" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="-2.5" cy="3.4" r="3.6" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="-4" cy="-1.3" r="3.6" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.8" />
                    <circle cx="0" cy="0" r="2.7" fill="#C48A47" />
                  </g>
                  {/* Left & right blossoms */}
                  <g transform="translate(39, 28) scale(0.78)">
                    <circle cx="0" cy="-4" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="3.8" cy="0" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="0" cy="4" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="-3.8" cy="0" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="0" cy="0" r="2.4" fill="#B86B4B" />
                  </g>
                  <g transform="translate(70, 24) scale(0.78)">
                    <circle cx="0" cy="-4" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="3.8" cy="0" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="0" cy="4" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="-3.8" cy="0" r="3.4" fill="#FBF6EC" stroke="#C48A47" strokeWidth="0.9" />
                    <circle cx="0" cy="0" r="2.4" fill="#B86B4B" />
                  </g>
                  {/* Subtle terracotta accents on side fronds */}
                  <circle cx="27" cy="28" r="2.2" fill="#B86B4B" opacity="0.85" />
                  <circle cx="82" cy="23" r="2.2" fill="#B86B4B" opacity="0.85" />
                </>
              )}
            </g>

            {/* Espresso Soil */}
            <ellipse cx="55" cy="89" rx="22" ry="4.5" fill="#4E3D2E" />

            {/* Soft Terracotta Pot */}
            <path d="M34 90 L76 90 L70 118 Q55 121 40 118 Z" fill="#B86B4B" />
            <rect x="30" y="85" width="50" height="7" rx="2.5" fill="#C67B5B" />
            <path d="M35 92 L75 92" stroke="#9B563A" strokeWidth="1.5" opacity="0.6" />
          </svg>
        </div>

        {/* Nourishment Details */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-mono-tabular text-[11px] text-[#8C7A68]">
              Stage {stage} of {STAGES.length}
              {stageInfo.nextPoints !== null && (
                <span> · {totalPoints}/{stageInfo.nextPoints}</span>
              )}
            </p>
            <h3 className="font-display text-base font-medium text-[#2B2118] leading-snug">
              {stageInfo.title}
            </h3>
            <p className="text-xs text-[#635345] leading-relaxed mt-0.5">
              {stageInfo.caption}
            </p>
          </div>

          {/* Calm progress bar to next leaf */}
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-[#E4DAC7] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#5F735D] transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="font-mono-tabular text-[10px] text-[#8C7A68] leading-relaxed">
              {completedCount} done · {dumpCount} journal · {breathCount} breaths · {waterDrops} drops
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
