import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { soundscapeEngine, type SoundscapeMode } from '../lib/soundscape';

const SOUNDSCAPES: Array<{ id: SoundscapeMode; label: string }> = [
  { id: 'silence', label: 'Silence' },
  { id: 'rain', label: 'Faint Rain' },
  { id: 'brown', label: 'Brown Noise' },
  { id: 'birds', label: 'Morning Birds' },
];

const RAIN_DROPS = [
  { left: 'left-[2%]', delay: '[animation-delay:-0.17s]', duration: '[animation-duration:1.31s]', size: 'w-px h-2.5 opacity-70' },
  { left: 'left-[6%]', delay: '[animation-delay:-1.43s]', duration: '[animation-duration:1.89s]', size: 'w-[1.5px] h-3.5 opacity-95' },
  { left: 'left-[10%]', delay: '[animation-delay:-0.78s]', duration: '[animation-duration:1.54s]', size: 'w-px h-2 opacity-65' },
  { left: 'left-[13%]', delay: '[animation-delay:-2.11s]', duration: '[animation-duration:2.17s]', size: 'w-[1.5px] h-3.5 opacity-85' },
  { left: 'left-[17%]', delay: '[animation-delay:-0.49s]', duration: '[animation-duration:1.42s]', size: 'w-px h-3 opacity-75' },
  { left: 'left-[22%]', delay: '[animation-delay:-1.72s]', duration: '[animation-duration:1.96s]', size: 'w-[1.5px] h-4 opacity-90' },
  { left: 'left-[26%]', delay: '[animation-delay:-0.95s]', duration: '[animation-duration:1.27s]', size: 'w-px h-2.5 opacity-60' },
  { left: 'left-[31%]', delay: '[animation-delay:-1.88s]', duration: '[animation-duration:2.08s]', size: 'w-[1.5px] h-3.5 opacity-95' },
  { left: 'left-[36%]', delay: '[animation-delay:-0.34s]', duration: '[animation-duration:1.61s]', size: 'w-px h-3 opacity-75' },
  { left: 'left-[39%]', delay: '[animation-delay:-1.29s]', duration: '[animation-duration:1.48s]', size: 'w-px h-2.5 opacity-65' },
  { left: 'left-[44%]', delay: '[animation-delay:-2.24s]', duration: '[animation-duration:2.29s]', size: 'w-[1.5px] h-3.5 opacity-90' },
  { left: 'left-[49%]', delay: '[animation-delay:-0.62s]', duration: '[animation-duration:1.37s]', size: 'w-px h-3 opacity-80' },
  { left: 'left-[53%]', delay: '[animation-delay:-1.57s]', duration: '[animation-duration:1.83s]', size: 'w-[1.5px] h-4 opacity-95' },
  { left: 'left-[58%]', delay: '[animation-delay:-0.11s]', duration: '[animation-duration:1.69s]', size: 'w-px h-2.5 opacity-65' },
  { left: 'left-[63%]', delay: '[animation-delay:-1.94s]', duration: '[animation-duration:2.12s]', size: 'w-[1.5px] h-3.5 opacity-85' },
  { left: 'left-[67%]', delay: '[animation-delay:-0.86s]', duration: '[animation-duration:1.44s]', size: 'w-px h-3 opacity-75' },
  { left: 'left-[72%]', delay: '[animation-delay:-1.38s]', duration: '[animation-duration:1.92s]', size: 'w-[1.5px] h-3.5 opacity-90' },
  { left: 'left-[76%]', delay: '[animation-delay:-0.41s]', duration: '[animation-duration:1.23s]', size: 'w-px h-2 opacity-60' },
  { left: 'left-[81%]', delay: '[animation-delay:-1.65s]', duration: '[animation-duration:2.03s]', size: 'w-[1.5px] h-4 opacity-95' },
  { left: 'left-[85%]', delay: '[animation-delay:-0.73s]', duration: '[animation-duration:1.58s]', size: 'w-px h-3 opacity-70' },
  { left: 'left-[89%]', delay: '[animation-delay:-2.05s]', duration: '[animation-duration:1.79s]', size: 'w-[1.5px] h-3.5 opacity-85' },
  { left: 'left-[93%]', delay: '[animation-delay:-0.26s]', duration: '[animation-duration:1.39s]', size: 'w-px h-2.5 opacity-65' },
  { left: 'left-[97%]', delay: '[animation-delay:-1.14s]', duration: '[animation-duration:1.97s]', size: 'w-[1.5px] h-3.5 opacity-90' },
];

const VOLUME_STORAGE_KEY = 'sloww_sound_volume_v1';

function readStoredVolume(): number {
  if (typeof window === 'undefined') return 12;
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return 12;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 12;
    return Math.max(0, Math.min(40, parsed));
  } catch {
    return 12;
  }
}

export const SensoryBar: React.FC = () => {
  const [soundMode, setSoundMode] = useState<SoundscapeMode>('silence');
  const [volumePct, setVolumePct] = useState<number>(() => readStoredVolume());

  useEffect(() => {
    soundscapeEngine.setVolume(volumePct / 100);
  }, [volumePct]);

  useEffect(() => {
    return () => {
      soundscapeEngine.stop();
    };
  }, []);

  const handleSelectSound = (mode: SoundscapeMode) => {
    setSoundMode(mode);
    soundscapeEngine.setVolume(volumePct / 100);
    soundscapeEngine.setMode(mode);
  };

  const handleVolumeChange = (nextPct: number) => {
    const clamped = Math.max(0, Math.min(40, nextPct));
    setVolumePct(clamped);
    soundscapeEngine.setVolume(clamped / 100);
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage quota errors
    }
  };

  const skyWashClass =
    soundMode === 'rain'
      ? 'from-[#E2E6DE]/80 via-[#EAE4D7]/55 to-[#DCE1D9]/80'
      : soundMode === 'birds'
        ? 'from-[#FAF3E4]/85 via-[#F4EAD5]/50 to-[#F7ECDA]/80'
        : soundMode === 'brown'
          ? 'from-[#E9DFCD]/85 via-[#EFE8DA]/50 to-[#E4D7C1]/85'
          : 'from-[#F6EFE2]/65 via-[#EFE8DA]/35 to-[#EAE1D0]/65';

  const rainLayerOpacity = soundMode === 'rain' ? 'opacity-95' : 'opacity-45';
  const cloudLayerOpacity = soundMode === 'birds' ? 'opacity-75' : 'opacity-90';
  const birdLayerOpacity = soundMode === 'birds' ? 'opacity-90' : 'opacity-50';

  return (
    <section
      aria-label="Ambient Sound Bar"
      className="relative overflow-hidden shrink-0 bg-[#EFE8DA] border-b border-[#DDD1BD] px-4 md:px-5 py-2"
    >
      {/* Atmospheric sky background: clouds, gentle rain, and gliding birds */}
      <div
        aria-hidden="true"
        data-testid="sensory-atmosphere"
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        {/* Subtle tone shift by selected soundscape */}
        <div className={`absolute inset-0 bg-gradient-to-r transition-colors duration-700 ${skyWashClass}`} />

        {/* Soft drifting parchment & sage clouds */}
        <div className={`absolute inset-0 transition-opacity duration-700 ${cloudLayerOpacity}`}>
          <div className="sensory-cloud-slow absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 140 44"
              className="w-32 h-10 -mt-1 text-[#FBF6EC]/85 drop-shadow-[0_1px_1px_rgba(140,122,104,0.12)]"
              fill="currentColor"
            >
              <path d="M22 36h92a14 14 0 0 0 2-27.8A18 18 0 0 0 82 6a20 20 0 0 0-37 6.5A13 13 0 0 0 22 36Z" />
            </svg>
          </div>
          <div className="sensory-cloud-medium absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 120 40"
              className="w-28 h-9 mt-1 text-[#DFD2BC]/75"
              fill="currentColor"
            >
              <path d="M18 34h80a12 12 0 0 0 1-23.9A15 15 0 0 0 70 8a17 17 0 0 0-32 5.5A11 11 0 0 0 18 34Z" />
            </svg>
          </div>
          <div className="sensory-cloud-soft absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 160 44"
              className="w-36 h-10 mt-0.5 text-[#FBF6EC]/70"
              fill="currentColor"
            >
              <path d="M26 38h104a13 13 0 0 0 2-25.8A19 19 0 0 0 94 7a21 21 0 0 0-40 6A14 14 0 0 0 26 38Z" />
            </svg>
          </div>
        </div>

        {/* Gentle scattered falling rain streaks */}
        <div className={`absolute inset-0 transition-opacity duration-700 ${rainLayerOpacity}`}>
          {RAIN_DROPS.map((drop, idx) => (
            <span
              key={idx}
              className={`sensory-rain-drop absolute top-0 rounded-full bg-gradient-to-b from-transparent via-[#5F735D]/55 to-[#5F735D]/80 ${drop.left} ${drop.delay} ${drop.duration} ${drop.size}`}
            />
          ))}
        </div>

        {/* Calm silhouettes of gliding birds */}
        <div className={`absolute inset-0 transition-opacity duration-700 ${birdLayerOpacity}`}>
          <div className="sensory-bird-flight-1 absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 26 12"
              className="w-5 h-2.5 mt-1.5 text-[#635345]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <path className="sensory-bird-wings" d="M2 8 Q7.5 2 13 7 Q18.5 2 24 8" />
            </svg>
          </div>
          <div className="sensory-bird-flight-2 absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 26 12"
              className="w-4 h-2 mt-3 text-[#5F735D]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path
                className="sensory-bird-wings [animation-delay:-0.7s]"
                d="M2 8 Q7.5 2 13 7 Q18.5 2 24 8"
              />
            </svg>
          </div>
          <div className="sensory-bird-flight-3 absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 26 12"
              className="w-3.5 h-2 mt-1 text-[#8C7A68]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <path
                className="sensory-bird-wings [animation-duration:1.45s] [animation-delay:-0.3s]"
                d="M2 8 Q7.5 2 13 7 Q18.5 2 24 8"
              />
            </svg>
          </div>
          <div className="sensory-bird-flight-4 absolute inset-y-0 left-0 w-full">
            <svg
              viewBox="0 0 26 12"
              className="w-4.5 h-2.5 mt-2.5 text-[#635345]/85"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            >
              <path
                className="sensory-bird-wings [animation-duration:2.1s] [animation-delay:-1.1s]"
                d="M2 8 Q7.5 2 13 7 Q18.5 2 24 8"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Foreground interactive Sound controls */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#4E3F31] bg-[#EFE8DA]/75 px-1.5 py-0.5 rounded">
            {soundMode === 'silence' ? (
              <VolumeX className="w-3.5 h-3.5 text-[#635345]" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-[#5F735D]" />
            )}
            <span className="whitespace-nowrap">Sound</span>
          </div>

          <div className="flex flex-wrap items-center p-0.5 bg-[#E4DAC7]/90 rounded-md border border-[#D4C6B0] backdrop-blur-[1px]">
            {SOUNDSCAPES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectSound(item.id)}
                className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#5F735D] ${
                  soundMode === item.id
                    ? 'bg-[#5F735D] text-[#FBF6EC]'
                    : 'text-[#635345] hover:text-[#2B2118]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-[#4E3F31] bg-[#EFE8DA]/75 px-2 py-0.5 rounded">
          <span className="sr-only">Soundscape volume</span>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={volumePct}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-20 sm:w-24 h-1.5 rounded-lg cursor-pointer accent-[#5F735D]"
            title="Whisper-quiet soundscape level"
          />
          <span className="font-mono-tabular w-7 text-right text-[#4E3F31]">
            {volumePct}%
          </span>
        </label>
      </div>
    </section>
  );
};
