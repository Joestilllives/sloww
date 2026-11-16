import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite';

let cachedGeminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedGeminiClient) return cachedGeminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  cachedGeminiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedGeminiClient;
}

function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const record = error as { status?: unknown; code?: unknown };
    if (typeof record.status === 'number') return record.status;
    if (typeof record.code === 'number') return record.code;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function isQuotaExhaustedError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const msg = getErrorMessage(error);
  return status === 429 || msg.includes('RESOURCE_EXHAUSTED');
}

function isDailyQuotaError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return (
    msg.includes('GenerateRequestsPerDay') ||
    msg.includes('requests per day') ||
    msg.includes('PerDay')
  );
}

async function withGeminiRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      // Do not waste retry attempts when a daily quota ceiling has already been reached
      if (isDailyQuotaError(error)) {
        throw error;
      }
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 180);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function generateContentWithModelFallback(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction: string;
    thinkingLevel: ThinkingLevel;
    responseSchema: Record<string, unknown>;
  }
) {
  const callModel = (model: string, includeThinking: boolean) =>
    withGeminiRetry(() =>
      ai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          ...(includeThinking ? { thinkingConfig: { thinkingLevel: params.thinkingLevel } } : {}),
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      })
    );

  try {
    return await callModel(MODEL_NAME, true);
  } catch (primaryError) {
    const status = getErrorStatus(primaryError);
    if (isQuotaExhaustedError(primaryError) || status === 404 || getErrorMessage(primaryError).includes('NOT_FOUND')) {
      return await callModel(FALLBACK_MODEL_NAME, false);
    }
    throw primaryError;
  }
}

function parseGeminiJson<T>(rawText: string | undefined, fallbackMessage: string): T {
  const cleaned = (rawText ?? '').trim();
  if (!cleaned) {
    throw new Error(fallbackMessage);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

function buildQuotaFallbackCompanionNote(
  trigger: 'ground' | 'completed' | 'self-care' | 'letting-go',
  focusNodeText: string,
  nowCount: number
): { title: string; message: string; tinyStep: string } {
  const focusSuffix = focusNodeText ? ` around "${focusNodeText.slice(0, 60)}"` : '';
  const pools: Record<
    'ground' | 'completed' | 'self-care' | 'letting-go',
    Array<{ title: string; message: string; tinyStep: string }>
  > = {
    ground: [
      {
        title: 'Right here in this room',
        message: `You do not need to solve the whole week in this breath. Feel your feet on the floor and let only what is directly in front of you${focusSuffix} have your quiet attention.`,
        tinyStep: 'Unclench your jaw and exhale for six slow counts.',
      },
      {
        title: 'One steady thread',
        message: `When thoughts scatter, returning to one small physical anchor steadies everything else. ${nowCount > 0 ? `Only ${nowCount === 1 ? 'one focus card' : `${nowCount} focus threads`} wait on your desk right now.` : 'Nothing on this desk asks you to hurry.'}`,
        tinyStep: 'Rest both hands flat on the desk for ten seconds.',
      },
    ],
    'self-care': [
      {
        title: 'Kindness before output',
        message: `Your worth does not rise and fall with how many cards are checked off today. Tend to the quiet body carrying all of these plans${focusSuffix}.`,
        tinyStep: 'Drink a glass of water and stretch your shoulders back.',
      },
      {
        title: 'A warm pause counts',
        message: 'Tired minds turn gentle work into steep hills. Offering yourself five minutes of genuine rest is part of doing the work well, not an interruption.',
        tinyStep: 'Step away from the screen for two slow minutes.',
      },
    ],
    'letting-go': [
      {
        title: 'Lay down the extra weight',
        message: `Not every open loop belongs in today's hands${focusSuffix}. You are allowed to let imperfect timing, other people's urgency, and unfinished edges sit quietly outside this hour.`,
        tinyStep: 'Move one non-urgent worry from Today into Later.',
      },
      {
        title: 'Open hands, lighter mind',
        message: 'Trying to hold everything at once only tires your grip. Set down whatever cannot be settled right now and trust that tomorrow still has room.',
        tinyStep: 'Take one slow exhale and soften your grip on perfection.',
      },
    ],
    completed: [
      {
        title: 'Quiet progress noticed',
        message: `A real thread has been tended${focusSuffix}. Let that completion register softly without immediately rushing to load the next stone.`,
        tinyStep: 'Pause for one quiet breath before choosing what is next.',
      },
    ],
  };

  const options = pools[trigger] || pools.ground;
  const pick = options[Math.floor(Math.random() * options.length)];
  return pick;
}

function sendGeminiError(res: express.Response, routeLabel: string, error: unknown, defaultMsg: string): void {
  const status = getErrorStatus(error);
  const rawMessage = getErrorMessage(error) || defaultMsg;

  if (isQuotaExhaustedError(error)) {
    console.warn(`Quota/rate limit reached in ${routeLabel} (${status ?? 429}).`);
    res.status(429).json({
      error: isDailyQuotaError(error)
        ? 'Daily free-tier AI quota has been reached for now. Add a billing-enabled Gemini API key in Settings > Secrets for higher limits, or try again later.'
        : 'The companion is receiving too many requests right now. Please pause a moment and try again.',
    });
    return;
  }

  console.error(`Error in ${routeLabel}:`, error);
  if (status === 403 || rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('API_KEY_INVALID')) {
    res.status(status === 403 ? 403 : 400).json({
      error: 'Please verify your Gemini API key in Settings > Secrets.',
    });
    return;
  }
  if (status === 404 || rawMessage.includes('NOT_FOUND')) {
    res.status(502).json({
      error: 'The configured AI model is currently unavailable. Please try again shortly.',
    });
    return;
  }

  res.status(500).json({ error: rawMessage || defaultMsg });
}

const COMPANION_SYSTEM_INSTRUCTION = `You are Sloww's wise, grounding, soothing, and encouraging thinking companion.
Your voice is calm, literary, observant, and warm—like a thoughtful mentor beside a quiet wooden desk.
Rules for your tone:
- Grounding and soothing: slow down urgency, name what is real with tenderness, never lecture.
- Wise and perceptive: notice subtle tensions, unspoken priorities, and where perfectionism or fatigue hides.
- Encouraging without hype: avoid exclamation marks, toxic positivity, hustle slogans, or generic "You've got this!" phrases.
- Keep language clear, human, concise, and deeply reassuring.`;

interface ExistingNodeInput {
  id: string;
  text: string;
  kind: string;
  priorityTier: string;
  completed: boolean;
  theme?: string;
}

interface DumpInput {
  rawText: string;
  moodWord?: string;
}

const VALID_ENCOURAGE_TRIGGERS = new Set(['ground', 'completed', 'self-care', 'letting-go']);

const MAX_AUDIO_BYTES = 4.5 * 1024 * 1024; // ~4.5 MB covers up to 3:00 of mobile Opus/AAC speech
const MIN_AUDIO_BYTES = 400;
const MAX_RECORDING_SECONDS = 185; // 3:00 limit + small clock tolerance

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
]);

function normalizeAudioMimeType(rawMime?: string): string | null {
  if (!rawMime || typeof rawMime !== 'string') return 'audio/webm';
  const base = rawMime.split(';')[0].trim().toLowerCase();
  // Mobile browsers (especially iOS Safari) occasionally label audio-only MediaRecorder blobs video/mp4 or video/webm
  if (base === 'video/mp4') return 'audio/mp4';
  if (base === 'video/webm') return 'audio/webm';
  if (ALLOWED_AUDIO_MIME_TYPES.has(base)) return base;
  return null;
}

function estimateWavDurationSeconds(buffer: Buffer): number | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  const byteRate = buffer.readUInt32LE(28);
  if (!Number.isFinite(byteRate) || byteRate <= 0) return null;
  return (buffer.length - 44) / byteRate;
}

function getClientIp(req: express.Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:/, '');
}

interface RateBucket {
  timestamps: number[];
  bytesInWindow: number;
  bytesResetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

// Periodically prune expired entries to keep memory bounded
setInterval(() => {
  const now = Date.now();
  const maxKeepMs = 60 * 60 * 1000;
  for (const [key, bucket] of rateBuckets.entries()) {
    const hasRecent = bucket.timestamps.some((ts) => now - ts < maxKeepMs);
    if (!hasRecent && now >= bucket.bytesResetAt) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function createIpRateLimiter(options: {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
  message: string;
}): express.RequestHandler {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();

    if (rateBuckets.size > 10000) {
      rateBuckets.clear();
    }

    let bucket = rateBuckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], bytesInWindow: 0, bytesResetAt: now + 60 * 60 * 1000 };
      rateBuckets.set(key, bucket);
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < options.windowMs);

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: options.message,
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    bucket.timestamps.push(now);
    next();
  };
}

function checkAudioByteQuota(ip: string, byteLength: number): number | null {
  const key = `audio-quota:${ip}`;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const maxBytesPerHour = 20 * 1024 * 1024; // 20 MB decoded audio per IP per hour

  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.bytesResetAt) {
    bucket = { timestamps: [], bytesInWindow: 0, bytesResetAt: now + hourMs };
    rateBuckets.set(key, bucket);
  }

  if (bucket.bytesInWindow + byteLength > maxBytesPerHour) {
    return Math.max(1, Math.ceil((bucket.bytesResetAt - now) / 1000));
  }

  bucket.bytesInWindow += byteLength;
  return null;
}

const app = express();
app.set('trust proxy', 1);

const globalAiLimiter = createIpRateLimiter({
  keyPrefix: 'ai-global',
  windowMs: 10 * 60 * 1000,
  maxRequests: 35,
  message: 'Too many AI requests from this connection right now. Please pause for a few minutes and try again.',
});

const transcribeLimiter = createIpRateLimiter({
  keyPrefix: 'ai-transcribe',
  windowMs: 10 * 60 * 1000,
  maxRequests: 10,
  message: 'Voice transcription is briefly throttled to keep the quiet room responsive. Please wait a moment or type below.',
});

const unpackLimiter = createIpRateLimiter({
  keyPrefix: 'ai-unpack',
  windowMs: 10 * 60 * 1000,
  maxRequests: 12,
  message: 'Journal organizing is briefly throttled. Please pause a moment before unpacking another entry.',
});

const patternsLimiter = createIpRateLimiter({
  keyPrefix: 'ai-patterns',
  windowMs: 10 * 60 * 1000,
  maxRequests: 10,
  message: 'Pattern Finder is briefly throttled. Please pause a moment before refreshing patterns.',
});

const encourageLimiter = createIpRateLimiter({
  keyPrefix: 'ai-encourage',
  windowMs: 10 * 60 * 1000,
  maxRequests: 20,
  message: 'The companion is taking a brief pause. Please try again in a moment.',
});

app.use('/api/ai', globalAiLimiter);

app.post('/api/ai/transcribe', transcribeLimiter, express.json({ limit: '6mb' }), async (req, res) => {
  try {
    const { audioBase64, mimeType, durationSeconds } = (req.body ?? {}) as {
      audioBase64?: string;
      mimeType?: string;
      durationSeconds?: number;
    };

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: 'Please record some audio first.' });
      return;
    }

    if (
      typeof durationSeconds === 'number' &&
      (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > MAX_RECORDING_SECONDS)
    ) {
      res.status(400).json({ error: 'Voice recordings are limited to 3 minutes per note.' });
      return;
    }

    const safeMimeType = normalizeAudioMimeType(mimeType);
    if (!safeMimeType) {
      res.status(415).json({ error: 'Unsupported audio format. Please try recording again or typing your note.' });
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!cleanBase64 || !/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
      res.status(400).json({ error: 'Recorded audio payload was unreadable.' });
      return;
    }

    if (cleanBase64.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 16) {
      res.status(413).json({ error: 'Recording exceeds the 3-minute / 4.5 MB limit. Try splitting longer thoughts into two notes.' });
      return;
    }

    const decodedBuffer = Buffer.from(cleanBase64, 'base64');
    if (decodedBuffer.length < MIN_AUDIO_BYTES) {
      res.status(400).json({ error: 'Recording was too short to capture speech.' });
      return;
    }
    if (decodedBuffer.length > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: 'Recording exceeds the 3-minute / 4.5 MB limit. Try splitting longer thoughts into two notes.' });
      return;
    }

    if (safeMimeType === 'audio/wav' || safeMimeType === 'audio/x-wav') {
      const wavDuration = estimateWavDurationSeconds(decodedBuffer);
      if (wavDuration !== null && wavDuration > MAX_RECORDING_SECONDS) {
        res.status(400).json({ error: 'Voice recordings are limited to 3 minutes per note.' });
        return;
      }
    }

    const quotaRetrySec = checkAudioByteQuota(getClientIp(req), decodedBuffer.length);
    if (quotaRetrySec !== null) {
      res.setHeader('Retry-After', String(quotaRetrySec));
      res.status(429).json({
        error: 'Hourly voice transcription limit reached for this connection. You can keep typing freely in your Journal.',
        retryAfterSeconds: quotaRetrySec,
      });
      return;
    }

    const ai = getGeminiClient();
    const audioPart = {
      inlineData: {
        mimeType: safeMimeType,
        data: cleanBase64,
      },
    };
    const parts = [
      audioPart,
      {
        text: 'Transcribe this voice journal note accurately into clean, natural plain text with punctuation. Return only the spoken words without commentary. If there is only silence or no speech, return an empty string.',
      },
    ];

    const callTranscribeModel = (model: string) =>
      withGeminiRetry(() =>
        ai.models.generateContent({
          model,
          contents: { parts },
        })
      );

    let response;
    try {
      response = await callTranscribeModel('gemini-3.5-transcribe');
    } catch (primaryError) {
      const status = getErrorStatus(primaryError);
      const msg = getErrorMessage(primaryError);
      if (status === 404 || msg.includes('NOT_FOUND') || isQuotaExhaustedError(primaryError)) {
        try {
          response = await callTranscribeModel(MODEL_NAME);
        } catch (secondaryError) {
          if (isQuotaExhaustedError(secondaryError)) {
            response = await callTranscribeModel(FALLBACK_MODEL_NAME);
          } else {
            throw secondaryError;
          }
        }
      } else {
        throw primaryError;
      }
    }

    const transcript = (response.text ?? '').trim();
    res.json({ transcript });
  } catch (error) {
    sendGeminiError(res, '/api/ai/transcribe', error, 'Unable to transcribe voice recording right now.');
  }
});

app.use(express.json({ limit: '512kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/ai/unpack-dump', unpackLimiter, async (req, res) => {
  try {
    const {
      rawText,
      existingNodes = [],
      mapTitle = 'Thinking Sanctuary',
      intention = '',
    } = (req.body ?? {}) as {
      rawText?: string;
      existingNodes?: ExistingNodeInput[];
      mapTitle?: string;
      intention?: string;
    };

    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      res.status(400).json({ error: 'Please share a thought or brain dump to unpack.' });
      return;
    }

    const ai = getGeminiClient();
    const safeTitle = typeof mapTitle === 'string' && mapTitle.trim() ? mapTitle.trim().slice(0, 120) : 'Thinking Sanctuary';
    const safeIntention = typeof intention === 'string' ? intention.trim().slice(0, 400) : '';
    const existingContext = (Array.isArray(existingNodes) ? existingNodes : []).slice(0, 35).map((n) => ({
      id: String(n.id || '').slice(0, 128),
      text: String(n.text || '').slice(0, 300),
      priorityTier: String(n.priorityTier || 'none'),
      theme: typeof n.theme === 'string' ? n.theme.slice(0, 80) : '',
    }));

    const prompt = `Map title: "${safeTitle}"
Current intention: "${safeIntention || 'Clarity and calm momentum'}"
Existing mind map nodes (for potential links): ${JSON.stringify(existingContext)}

User's raw brain dump:
"""
${rawText.trim().slice(0, 3800)}
"""

Task:
1. Gently distill this brain dump into 2 to 5 clear, distinct mind map nodes.
   - "kind" must be one of: "thought" (idea/task), "anchor" (core commitment or grounding priority), "feeling" (emotional state or body check-in), "question" (open inquiry).
   - "suggestedPriority" must be one of: "now" (only 0-1 truly vital immediate step if clearly urgent/anchoring), "next" (near-term), "later" (resting for later), or "none" (pure context/feeling).
   - "theme" should be a short 1-3 word cluster name (e.g. "Creative Focus", "Rest & Pacing", "Work Logistics").
2. Suggest 1 to 4 gentle connections (links) either between the newly extracted nodes (using fromIndex and toIndex as 0-based indices into extractedNodes) or linking an extracted node (fromIndex) to an existing node (toExistingNodeId).
3. Provide 1 soothing moodWord (1-2 words, e.g., "tenderly stretched", "quietly hopeful").
4. Write a short, grounding, wise, and encouraging companionNote (title <= 8 words, message 2-3 calm sentences, tinyStep 1 concrete 5-10 minute gentle action).`;

    const response = await generateContentWithModelFallback(ai, {
      contents: prompt,
      systemInstruction: COMPANION_SYSTEM_INSTRUCTION,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          moodWord: { type: Type.STRING },
          extractedNodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                note: { type: Type.STRING },
                kind: {
                  type: Type.STRING,
                  enum: ['thought', 'anchor', 'feeling', 'question'],
                },
                suggestedPriority: {
                  type: Type.STRING,
                  enum: ['now', 'next', 'later', 'none'],
                },
                theme: { type: Type.STRING },
              },
              required: ['text', 'note', 'kind', 'suggestedPriority', 'theme'],
            },
          },
          suggestedLinks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fromIndex: { type: Type.INTEGER },
                toIndex: { type: Type.INTEGER },
                toExistingNodeId: { type: Type.STRING },
                label: { type: Type.STRING },
              },
              required: ['fromIndex', 'label'],
            },
          },
          companionNote: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              message: { type: Type.STRING },
              tinyStep: { type: Type.STRING },
            },
            required: ['title', 'message', 'tinyStep'],
          },
        },
        required: ['moodWord', 'extractedNodes', 'suggestedLinks', 'companionNote'],
      },
    });

    const parsed = parseGeminiJson(response.text, 'Received an unreadable reflection while unpacking.');
    res.json(parsed);
  } catch (error) {
    sendGeminiError(res, '/api/ai/unpack-dump', error, 'Unable to unpack brain dump right now.');
  }
});

app.post('/api/ai/find-patterns', patternsLimiter, async (req, res) => {
  try {
    const {
      nodes = [],
      dumps = [],
      mapTitle = 'Thinking Sanctuary',
      intention = '',
      excludeTitles = [],
    } = (req.body ?? {}) as {
      nodes?: ExistingNodeInput[];
      dumps?: DumpInput[];
      mapTitle?: string;
      intention?: string;
      excludeTitles?: string[];
    };

    const safeNodes = Array.isArray(nodes) ? nodes.slice(0, 50) : [];
    const safeDumps = Array.isArray(dumps) ? dumps.slice(0, 15) : [];
    const safeExcludeTitles = Array.isArray(excludeTitles)
      ? excludeTitles.slice(0, 12).map((t) => String(t).trim().slice(0, 120)).filter(Boolean)
      : [];

    if (safeNodes.length === 0 && safeDumps.length === 0) {
      res.status(400).json({ error: 'Add a few thoughts or brain dumps first so patterns can emerge.' });
      return;
    }

    const ai = getGeminiClient();
    const safeTitle = typeof mapTitle === 'string' && mapTitle.trim() ? mapTitle.trim().slice(0, 120) : 'Thinking Sanctuary';
    const safeIntention = typeof intention === 'string' ? intention.trim().slice(0, 400) : '';

    const shiftNote =
      safeExcludeTitles.length > 0
        ? `\nPreviously shown pattern titles to avoid repeating (surface fresh angles and different connections instead): ${JSON.stringify(safeExcludeTitles)}`
        : '';

    const prompt = `Map title: "${safeTitle}"
Intention: "${safeIntention || 'Clarity and steadiness'}"
Nodes on the mind map:
${JSON.stringify(safeNodes)}

Recent brain dumps:
${JSON.stringify(safeDumps)}${shiftNote}

Task:
Look tenderly and perceptively across all these nodes and brain dumps to uncover 2 to 4 meaningful patterns.
For each pattern:
- "title": A clear, evocative 3-6 word pattern title.
- "insight": A wise, grounding 1-2 sentence observation connecting the dots (what keeps recurring, where energy is leaking, what quietly matters most).
- "tone": One of "anchor" (core grounding strength), "tension" (competing pulls or gentle friction), "momentum" (ready energy / completed wins), or "rest" (need for breathing room).
- "relatedNodeIds": Array of exact node IDs from the provided Nodes list that belong to this pattern.

Also write a fresh "companionNote" (title, message, tinyStep) speaking to the whole picture with warmth and steadiness.`;

    const response = await generateContentWithModelFallback(ai, {
      contents: prompt,
      systemInstruction: COMPANION_SYSTEM_INSTRUCTION,
      thinkingLevel: ThinkingLevel.MEDIUM,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          patterns: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                insight: { type: Type.STRING },
                tone: {
                  type: Type.STRING,
                  enum: ['anchor', 'tension', 'momentum', 'rest'],
                },
                relatedNodeIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['title', 'insight', 'tone', 'relatedNodeIds'],
            },
          },
          companionNote: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              message: { type: Type.STRING },
              tinyStep: { type: Type.STRING },
            },
            required: ['title', 'message', 'tinyStep'],
          },
        },
        required: ['patterns', 'companionNote'],
      },
    });

    const parsed = parseGeminiJson(response.text, 'Unable to parse patterns from reflection.');
    res.json(parsed);
  } catch (error) {
    sendGeminiError(res, '/api/ai/find-patterns', error, 'Unable to discover patterns right now.');
  }
});

app.post('/api/ai/encourage', encourageLimiter, async (req, res) => {
  try {
    const {
      trigger = 'ground',
      focusNodeText = '',
      completedCount = 0,
      nowCount = 0,
      nodesSummary = [],
      mapTitle = 'Thinking Sanctuary',
    } = (req.body ?? {}) as {
      trigger?: 'ground' | 'completed' | 'self-care' | 'letting-go';
      focusNodeText?: string;
      completedCount?: number;
      nowCount?: number;
      nodesSummary?: string[];
      mapTitle?: string;
    };

    const safeTrigger = VALID_ENCOURAGE_TRIGGERS.has(trigger) ? trigger : 'ground';
    const safeTitle = typeof mapTitle === 'string' && mapTitle.trim() ? mapTitle.trim().slice(0, 120) : 'Thinking Sanctuary';
    const safeFocus = typeof focusNodeText === 'string' ? focusNodeText.slice(0, 300) : '';
    const safeSummary = Array.isArray(nodesSummary)
      ? nodesSummary.slice(0, 20).map((s) => String(s).slice(0, 200))
      : [];

    const ai = getGeminiClient();
    const prompt = `Map title: "${safeTitle}"
Moment: "${safeTrigger}"
Focus item (if any): "${safeFocus}"
Completed items so far: ${Number.isFinite(completedCount) ? completedCount : 0}
Current Focus Today priorities: ${Number.isFinite(nowCount) ? nowCount : 0}
Active thoughts: ${JSON.stringify(safeSummary)}

Write a wise, grounding, soothing, and encouraging reflection tailored to this exact moment:
- If trigger is "completed": honor the quiet progress without loud cheerleading.
- If trigger is "self-care": speak with deep warmth about tending to their body, heart, and energy—remind them they deserve kindness and rest regardless of what remains undone, and suggest a soothing act of self-care.
- If trigger is "letting-go": help them gently release what is outside their control, soften perfectionism or lingering heaviness, and lay down whatever does not need to be carried today.
- If trigger is "ground": offer a calm anchoring reflection for where their mind is right now, bringing them back to steady presence in this quiet moment.
Return title (short, calming), message (2-3 sentences), and tinyStep (1 gentle, concrete next move under 15 words).`;

    try {
      const response = await generateContentWithModelFallback(ai, {
        contents: prompt,
        systemInstruction: COMPANION_SYSTEM_INSTRUCTION,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            message: { type: Type.STRING },
            tinyStep: { type: Type.STRING },
          },
          required: ['title', 'message', 'tinyStep'],
        },
      });

      const parsed = parseGeminiJson(response.text, 'Unable to read companion reflection.');
      res.json(parsed);
    } catch (aiError) {
      if (isQuotaExhaustedError(aiError)) {
        console.warn('Free-tier quota reached in /api/ai/encourage; serving calm fallback reflection.');
        res.json(
          buildQuotaFallbackCompanionNote(
            safeTrigger as 'ground' | 'completed' | 'self-care' | 'letting-go',
            safeFocus,
            Number.isFinite(nowCount) ? nowCount : 0
          )
        );
        return;
      }
      throw aiError;
    }
  } catch (error) {
    sendGeminiError(res, '/api/ai/encourage', error, 'Unable to reach companion right now.');
  }
});

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith('/api/')) {
    next(err);
    return;
  }
  const errObj = err as { type?: string; status?: number; statusCode?: number } | null;
  if (errObj?.type === 'entity.too.large' || errObj?.status === 413 || errObj?.statusCode === 413) {
    res.status(413).json({
      error: 'Request payload is too large. Please shorten your note or split recordings under 3 minutes.',
    });
    return;
  }
  if (err instanceof SyntaxError || errObj?.type === 'entity.parse.failed' || errObj?.status === 400) {
    res.status(400).json({ error: 'Received malformed JSON request.' });
    return;
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sloww server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
