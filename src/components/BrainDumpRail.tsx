import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Feather, Loader2, Mic, Square, Trash2, X } from 'lucide-react';
import type { BrainDump } from '../types';

interface BrainDumpRailProps {
  dumps: BrainDump[];
  isOnline?: boolean;
  isUnpacking: boolean;
  unpackingDumpId: string | null;
  onUnpackNewDump: (rawText: string, moodWord?: string) => Promise<boolean>;
  onUnpackExistingDump: (dump: BrainDump) => Promise<void>;
  onDeleteDump: (dumpId: string) => Promise<void>;
  errorMessage: string | null;
}

const MOOD_SUGGESTIONS = ['scattered', 'hopeful', 'quietly tired', 'curious', 'heavy'];
const MAX_RECORDING_SECONDS = 180;
const MAX_AUDIO_BYTES = 4.5 * 1024 * 1024;

function pickSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

function normalizeRecordedMimeType(rawMime?: string, fallbackMime?: string): string {
  const candidate = (rawMime || fallbackMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (candidate === 'video/mp4') return 'audio/mp4';
  if (candidate === 'video/webm') return 'audio/webm';
  if (candidate.startsWith('audio/')) return candidate;
  return 'audio/mp4';
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

export const BrainDumpRail: React.FC<BrainDumpRailProps> = ({
  dumps,
  isOnline = true,
  isUnpacking,
  unpackingDumpId,
  onUnpackNewDump,
  onUnpackExistingDump,
  onDeleteDump,
  errorMessage,
}) => {
  const [rawText, setRawText] = useState('');
  const [moodWord, setMoodWord] = useState('');
  const [deletingDumpId, setDeletingDumpId] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordNotice, setRecordNotice] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const discardOnStopRef = useRef(false);
  const recordingSecondsRef = useRef(0);

  const stopRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopMediaStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      discardOnStopRef.current = true;
      stopRecordingTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore unmount stop errors
        }
      }
      stopMediaStream();
    };
  }, []);

  const transcribeRecordedBlob = async (blob: Blob, mimeType: string, durationSeconds: number) => {
    if (blob.size < 400) {
      setRecordNotice('Recording was too short to capture speech.');
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      setRecordNotice('Recording exceeds the 3-minute / 4.5 MB size limit. Try splitting longer thoughts into two notes.');
      return;
    }

    setIsTranscribing(true);
    setRecordNotice(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const response = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType, durationSeconds }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        transcript?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to transcribe recording right now.');
      }

      const transcript = (payload.transcript || '').trim();
      if (!transcript) {
        setRecordNotice('No clear speech detected — try again a little closer to your microphone.');
        return;
      }

      setRawText((prev) => {
        const trimmed = prev.trimEnd();
        if (!trimmed) return transcript;
        const separator = /[.!?…]$/.test(trimmed) ? '\n\n' : ' ';
        return `${trimmed}${separator}${transcript}`;
      });
    } catch (error) {
      setRecordNotice(
        error instanceof Error ? error.message : 'Unable to transcribe voice recording right now.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const cancelRecording = () => {
    discardOnStopRef.current = true;
    stopRecordingTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopMediaStream();
      setIsRecording(false);
    }
    setRecordingSeconds(0);
    setRecordNotice(null);
  };

  const stopRecording = () => {
    stopRecordingTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopMediaStream();
      setIsRecording(false);
    }
  };

  const startRecording = async () => {
    if (isRecording || isTranscribing || isUnpacking) return;
    setRecordNotice(null);

    if (!isOnline) {
      setRecordNotice('You are offline right now — keep typing freely. Voice transcription will return when connected.');
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setRecordNotice('Voice recording is not supported in this browser. You can still type freely below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      discardOnStopRef.current = false;

      const chosenMimeType = pickSupportedAudioMimeType();
      const recorder = chosenMimeType
        ? new MediaRecorder(stream, { mimeType: chosenMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stopRecordingTimer();
        setIsRecording(false);
        const recordedChunks = chunksRef.current;
        chunksRef.current = [];
        stopMediaStream();

        if (discardOnStopRef.current) return;
        const chunkMime = recordedChunks.find((chunk) => Boolean(chunk.type))?.type;
        const safeMime = normalizeRecordedMimeType(recorder.mimeType || chunkMime, chosenMimeType);
        const audioBlob = new Blob(recordedChunks, { type: safeMime });
        void transcribeRecordedBlob(audioBlob, safeMime, recordingSecondsRef.current);
      };

      recorder.onerror = () => {
        stopRecordingTimer();
        setIsRecording(false);
        stopMediaStream();
        setRecordNotice('Microphone recording stopped unexpectedly. Please try again.');
      };

      // iOS Safari MP4 MediaRecorder emits cleaner headers when started without a timeslice
      const useTimeslice = Boolean(chosenMimeType && !chosenMimeType.includes('mp4') && !chosenMimeType.includes('aac'));
      if (useTimeslice) {
        recorder.start(500);
      } else {
        recorder.start();
      }
      setIsRecording(true);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          recordingSecondsRef.current = next;
          if (next >= MAX_RECORDING_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      stopMediaStream();
      setIsRecording(false);
      if (
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
      ) {
        setRecordNotice(
          'Microphone permission was declined. Allow microphone access in your browser to record voice notes.'
        );
      } else if (error instanceof DOMException && error.name === 'NotFoundError') {
        setRecordNotice('No microphone was found on this device.');
      } else if (
        error instanceof DOMException &&
        (error.name === 'NotReadableError' || error.name === 'AbortError')
      ) {
        setRecordNotice(
          'Your microphone is temporarily busy in another app or tab. Close it and try again.'
        );
      } else {
        setRecordNotice(
          'Could not start microphone recording. Check browser permissions over HTTPS and try again.'
        );
      }
    }
  };

  const submitDump = async () => {
    if (!rawText.trim() || isUnpacking || isRecording || isTranscribing) return;
    const ok = await onUnpackNewDump(rawText.trim(), moodWord.trim() || undefined);
    if (ok) {
      setRawText('');
      setMoodWord('');
      setRecordNotice(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitDump();
  };

  const handleDelete = async (dumpId: string) => {
    if (deletingDumpId) return;
    setDeletingDumpId(dumpId);
    try {
      await onDeleteDump(dumpId);
    } finally {
      setDeletingDumpId(null);
    }
  };

  return (
    <section
      aria-label="Journal"
      className="flex-1 h-full overflow-y-auto calm-scroll bg-[#F4ECE0]"
    >
      <div className="max-w-5xl mx-auto px-5 py-6 md:px-8 md:py-8 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Feather className="w-4 h-4 text-[#5F735D]" />
            <h1 className="font-display text-2xl font-medium text-[#2B2118]">
              Journal
            </h1>
          </div>
          <p className="text-xs text-[#635345] mt-1">
            Write or speak freely without sorting first. Your journal entries are automatically turned into organized cards on your Mind Map—and removing an entry cleans up its cards too.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Composer Card */}
          <div className="lg:col-span-5 bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-medium text-[#2B2118]">
                  Write or speak freely
                </h2>
                <span className="text-[11px] text-[#8C7A68]">Auto-sorted onto your map</span>
              </div>

              {isRecording ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={cancelRecording}
                    aria-label="Cancel recording"
                    title="Discard this recording without transcribing"
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-[#DDD1BD] bg-[#FBF6EC] text-[#635345] hover:text-[#2B2118] hover:bg-[#EFE8DA] transition-colors whitespace-nowrap"
                  >
                    <X className="w-3 h-3" />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#DFB6A5] bg-[#F7E9E2] text-[#8F472B] hover:bg-[#F1DDD3] transition-colors whitespace-nowrap"
                    aria-label="Stop recording"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#B86B4B] animate-pulse" aria-hidden="true" />
                    <Square className="w-3 h-3 fill-current" />
                    <span className="font-mono-tabular">Stop · {formatDuration(recordingSeconds)}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={isTranscribing || isUnpacking}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#DDD1BD] bg-[#F4ECE0] text-[#4E3F31] hover:border-[#B86B4B]/60 hover:text-[#2B2118] hover:bg-[#EFE8DA] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  title="Record a voice note and transcribe it into your journal"
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 text-[#5F735D] animate-spin" />
                      <span>Transcribing...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-[#B86B4B]" />
                      <span>Record</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {isRecording && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-[#DFB6A5] bg-[#F7E9E2]/70 text-xs text-[#8F472B]">
                <span>Listening gently... speak at your own pace.</span>
                <span className="font-mono-tabular text-[11px]">
                  {formatDuration(MAX_RECORDING_SECONDS - recordingSeconds)} left
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void submitDump();
                  }
                }}
                rows={7}
                maxLength={3800}
                placeholder="Empty your head here without editing—type or tap Record to speak tasks, worries, ideas, or feelings..."
                className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/70 px-3.5 py-2.5 text-sm leading-relaxed text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none resize-y transition-colors"
              />

              <div className="space-y-1.5">
                <input
                  type="text"
                  value={moodWord}
                  onChange={(e) => setMoodWord(e.target.value)}
                  maxLength={50}
                  placeholder="Optional tone (e.g., quietly stretched)"
                  className="w-full rounded-md border border-[#DDD1BD] bg-[#FBF6EC] px-3 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:outline-none"
                />
                <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-[#8C7A68]">
                  {MOOD_SUGGESTIONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMoodWord(m)}
                      className="hover:text-[#5F735D] underline-offset-2 hover:underline transition-colors whitespace-nowrap"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {(recordNotice || errorMessage) && (
                <p className="text-xs text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded-md px-3 py-2">
                  {recordNotice || errorMessage}
                </p>
              )}

              <div className="pt-1 space-y-1.5">
                <button
                  type="submit"
                  disabled={!rawText.trim() || isUnpacking || isRecording || isTranscribing}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] disabled:opacity-50 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F735D]"
                >
                  <Feather className="w-3.5 h-3.5" />
                  <span>{isUnpacking && !unpackingDumpId ? 'Organizing onto map...' : 'Capture & Organize'}</span>
                </button>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#8C7A68] px-0.5">
                  <span className="hidden sm:inline">⌘ / Ctrl + Enter to organize</span>
                  {rawText.length >= 2800 && (
                    <span className="font-mono-tabular ml-auto">
                      {rawText.length.toLocaleString()} / 3,800
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>

          {/* Saved Stream Card */}
          <div className="lg:col-span-7 bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDD1BD]">
              <h2 className="font-display text-base font-medium text-[#2B2118]">
                Journal Entries
              </h2>
              <span className="font-mono-tabular text-xs text-[#8C7A68]">
                {dumps.length} {dumps.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {dumps.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <p className="text-sm text-[#635345]">No journal entries yet.</p>
                <p className="text-xs text-[#8C7A68] leading-relaxed max-w-sm mx-auto">
                  Write or record whatever is sitting on your chest and let it settle out of your head.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#DDD1BD]">
                {dumps.map((dump) => {
                  const isBusy = unpackingDumpId === dump.id;
                  const isDeleting = deletingDumpId === dump.id;
                  return (
                    <div key={dump.id} className="py-4 space-y-2 group">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#8C7A68]">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className={dump.mapped ? 'text-[#5F735D] font-medium' : 'text-[#C48A47] font-medium'}>
                            {dump.mapped ? 'Organized' : 'Awaiting retry'}
                          </span>
                          {dump.moodWord && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{dump.moodWord}</span>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={isDeleting || isBusy}
                          onClick={() => void handleDelete(dump.id)}
                          aria-label="Remove journal entry"
                          title="Remove entry and its organized cards"
                          className="inline-flex items-center gap-1 opacity-70 hover:opacity-100 focus:opacity-100 px-1.5 py-0.5 text-[#8C7A68] hover:text-[#B86B4B] disabled:opacity-40 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="text-[11px]">{isDeleting ? 'Removing...' : 'Remove'}</span>
                        </button>
                      </div>

                      <p className="text-sm leading-relaxed text-[#2B2118] whitespace-pre-wrap break-words">
                        {dump.rawText}
                      </p>

                      {!dump.mapped && (
                        <button
                          type="button"
                          onClick={() => void onUnpackExistingDump(dump)}
                          disabled={isUnpacking}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#5F735D] hover:underline disabled:opacity-50"
                        >
                          <span>{isBusy ? 'Organizing...' : 'Retry organize'}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
