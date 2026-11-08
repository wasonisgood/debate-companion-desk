import { SITE_ORIGIN } from '../config';
/**
 * Multi-tier "先備位" (Primary -> Fallback Cascade) Chinese TTS Engine
 *
 * Cascade order:
 *   1A. 先位 A — Pre-generated Book Page Neural Audio (`audioUrl` if bundled with the book/page)
 *   1B. 先位 B — Real-time Edge Neural TTS Stream (`/api/tts` -> `zh-TW-HsiaoChenNeural` / `zh-TW-YunJheNeural`)
 *                with automatic sentence chunking (first sentence plays in <400ms) + next-page prefetch cache.
 *   2A. 第一備位 — Local In-Browser WebGPU/WASM Neural TTS (`kokoro-js` ONNX `Kokoro-82M-v1.0-ONNX` `zf_xiaoxiao`)
 *                when `/api/tts` is unreachable (offline) or when user explicitly enables Local WASM/WebGPU Neural TTS.
 *   2B. 第二備位 — Smart Browser `speechSynthesis` Natural Voice Selector + Prosody Sentence Grouping
 *                (prioritizing `Microsoft HsiaoChen Online (Natural)`, `YunJhe`, `HsiaoYu`, `Meijia`, `Google 國語（臺灣）`,
 *                penalizing flat legacy `Hanhan Desktop`, and adding natural inter-clause pauses).
 */

export type TtsTierId =
  | 'prebundled-neural'
  | 'edge-neural-stream'
  | 'local-wasm-kokoro'
  | 'browser-smart-speech';

export interface TtsSpeakOptions {
  /** Optional pre-bundled audio URL on the page/book (Tier 1A) */
  audioUrl?: string;
  /** Preferred Edge Neural voice (default: zh-TW-HsiaoChenNeural) */
  voice?: 'zh-TW-HsiaoChenNeural' | 'zh-TW-YunJheNeural' | 'zh-TW-HsiaoYuNeural';
  /** Language tag (default: zh-TW) */
  lang?: string;
  /** Prefer local WebGPU/WASM Kokoro model before network stream if enabled */
  preferLocalWasm?: boolean;
  /** Called as soon as the active tier is selected and playback begins */
  onTierActive?: (tier: TtsTierId, label: string) => void;
  /** Called when playback finishes or is cancelled */
  onEnd?: () => void;
}

const TIER_LABELS: Record<TtsTierId, string> = {
  'prebundled-neural': '先位A · 預錄神經語音',
  'edge-neural-stream': '先位B · 台灣曉臻神經語音',
  'local-wasm-kokoro': '備位1 · 本地WASM神經語音',
  'browser-smart-speech': '備位2 · 系統自然語音',
};

export function getTtsTierLabel(tier: TtsTierId): string {
  return TIER_LABELS[tier];
}

// ---------- speaking rate ----------
// The rate is part of synthesis, not a playback trick: Edge neural speech is
// regenerated with SSML prosody, Kokoro with its own `speed`, the system voice
// with `utterance.rate`. Only pre-recorded audio is time-stretched (pitch kept).
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 2;
const RATE_KEY = 'shelf-tts-rate';
const quantizeRate = (r: number) => Math.round(Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, r)) * 20) / 20;
let ttsRate = (() => {
  try { const v = Number(localStorage.getItem(RATE_KEY)); return v ? quantizeRate(v) : 1; } catch { return 1; }
})();
type RateListener = (rate: number, commit: boolean) => void;
const rateListeners = new Set<RateListener>();

export function getTtsRate(): number { return ttsRate; }
/** `commit` = the reader let go of the control: regenerate speech at the new rate. */
export function setTtsRate(r: number, commit = true): number {
  const q = quantizeRate(r);
  const changed = q !== ttsRate;
  ttsRate = q;
  if (commit) { try { localStorage.setItem(RATE_KEY, String(q)); } catch { /* ignore */ } }
  if (changed || commit) rateListeners.forEach((fn) => fn(q, commit));
  return q;
}
export function onTtsRateChange(fn: RateListener): () => void {
  rateListeners.add(fn);
  return () => rateListeners.delete(fn);
}
export function formatTtsRate(r = ttsRate): string {
  return `${r.toFixed(r * 10 % 1 ? 2 : 1)}×`;
}
/** Edge prosody keeps the slight +4% lift the narration was tuned with at 1×. */
const edgeRateParam = (r: number) => {
  const pct = Math.round((r * 1.04 - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
};

/** In-memory Blob URL cache for synthesized chunks (`voice|rate|text` -> blobUrl) */
const audioBlobCache = new Map<string, string>();
/** In-flight fetch promises so prefetch and playback share requests */
const inflightFetches = new Map<string, Promise<string | null>>();

/** Track whether `/api/tts` is reachable in this session (re-tested after 60s on failure) */
let edgeApiHealthyUntil = 0;
let edgeApiFailedAt = 0;

/** Lazy-loaded Kokoro local neural TTS instance */
interface KokoroInstance {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<{ toBlob: () => Blob }>;
}
let kokoroPromise: Promise<KokoroInstance | null> | null = null;

/** Currently active stop callback so only one narration plays at a time */
let activeStopFn: (() => void) | null = null;

export function stopActiveTts(): void {
  if (activeStopFn) {
    const fn = activeStopFn;
    activeStopFn = null;
    fn();
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Clean markdown formatting and normalize punctuation for natural prosody.
 */
export function cleanTextForTts(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a long paragraph into natural speaking segments (~90–160 chars)
 * so the first segment plays with near-zero latency while subsequent segments prefetch.
 */
export function splitIntoSpeechChunks(text: string, maxChars = 140): string[] {
  const cleaned = cleanTextForTts(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const rawSentences = cleaned
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  // Keep the very first chunk shorter (~75 chars) for ultra-fast time-to-first-audio
  const firstLimit = Math.min(80, maxChars);

  for (const s of rawSentences) {
    const limit = chunks.length === 0 ? firstLimit : maxChars;
    if (!current) {
      current = s;
    } else if (current.length + s.length <= limit) {
      current += s;
    } else {
      chunks.push(current);
      current = s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function fetchEdgeChunkBlobUrl(
  chunk: string,
  voice: string,
  rate = ttsRate,
): Promise<string | null> {
  const key = `${voice}|${rate}|${chunk}`;
  const cached = audioBlobCache.get(key);
  if (cached) return cached;

  const existing = inflightFetches.get(key);
  if (existing) return existing;

  const now = Date.now();
  if (edgeApiFailedAt > 0 && now - edgeApiFailedAt < 45_000 && now > edgeApiHealthyUntil) {
    return null;
  }

  const promise = (async (): Promise<string | null> => {
    try {
      const params = new URLSearchParams({
        text: chunk,
        voice,
        rate: edgeRateParam(rate),
      });
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${SITE_ORIGIN}/api/tts?${params.toString()}`, {
        signal: ctrl.signal,
      });
      window.clearTimeout(timer);

      if (!res.ok) {
        edgeApiFailedAt = Date.now();
        return null;
      }
      const contentType = res.headers.get('Content-Type') || '';
      if (!contentType.includes('audio')) {
        edgeApiFailedAt = Date.now();
        return null;
      }
      const blob = await res.blob();
      if (blob.size < 128) {
        edgeApiFailedAt = Date.now();
        return null;
      }
      edgeApiHealthyUntil = Date.now() + 300_000;
      edgeApiFailedAt = 0;

      const blobUrl = URL.createObjectURL(blob);
      audioBlobCache.set(key, blobUrl);
      return blobUrl;
    } catch {
      edgeApiFailedAt = Date.now();
      return null;
    } finally {
      inflightFetches.delete(key);
    }
  })();

  inflightFetches.set(key, promise);
  return promise;
}

/**
 * Prefetch the first chunk(s) of an upcoming page in the background
 * so turning to the next page in 導讀模式 plays instantaneously (0 ms wait).
 */
export function prefetchTts(
  text: string,
  voice: 'zh-TW-HsiaoChenNeural' | 'zh-TW-YunJheNeural' | 'zh-TW-HsiaoYuNeural' = 'zh-TW-HsiaoChenNeural',
): void {
  const chunks = splitIntoSpeechChunks(text);
  if (!chunks.length) return;
  // Prefetch the first 2 chunks of the next page
  for (const chunk of chunks.slice(0, 2)) {
    void fetchEdgeChunkBlobUrl(chunk, voice);
  }
}

/**
 * Tier 2A (第一備位): Local In-Browser WebGPU/WASM Neural TTS via `kokoro-js` (`Kokoro-82M-v1.0-ONNX`).
 * Loaded on demand from CDN so zero bytes are added to the initial bundle unless needed.
 */
async function loadLocalKokoro(): Promise<KokoroInstance | null> {
  if (kokoroPromise) return kokoroPromise;
  kokoroPromise = (async () => {
    try {
      const cdnUrl = 'https://esm.sh/kokoro-js@1.2.1';
      const mod = (await import(/* @vite-ignore */ cdnUrl)) as {
        KokoroTTS: {
          from_pretrained: (
            modelId: string,
            opts: { dtype: string; device: string },
          ) => Promise<KokoroInstance>;
        };
      };
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const tts = await mod.KokoroTTS.from_pretrained(
        'onnx-community/Kokoro-82M-v1.0-ONNX',
        {
          dtype: hasWebGpu ? 'fp32' : 'q8',
          device: hasWebGpu ? 'webgpu' : 'wasm',
        },
      );
      return tts;
    } catch {
      kokoroPromise = null;
      return null;
    }
  })();
  return kokoroPromise;
}

async function synthesizeLocalKokoroBlobUrl(chunk: string, rate = ttsRate): Promise<string | null> {
  const key = `kokoro|${rate}|${chunk}`;
  const cached = audioBlobCache.get(key);
  if (cached) return cached;

  const kokoro = await loadLocalKokoro();
  if (!kokoro) return null;

  try {
    const audio = await kokoro.generate(chunk, { voice: 'zf_xiaoxiao', speed: rate });
    const blob = audio.toBlob();
    const url = URL.createObjectURL(blob);
    audioBlobCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Tier 2B (第二備位): Smart Browser `speechSynthesis` Natural Voice Selection + Prosody Tuning.
 * Scores all available system voices to prioritize Microsoft Edge Natural Online voices
 * (`HsiaoChen`, `YunJhe`, `HsiaoYu`), Apple `Meijia` Premium, or `Google 國語（臺灣）`,
 * and penalizes the robotic `Microsoft Hanhan Desktop` voice.
 */
export function pickBestChineseVoice(lang = 'zh-TW'): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const zhVoices = voices.filter((v) =>
    /^(zh|cmn)/i.test(v.lang.replace('_', '-')),
  );
  if (!zhVoices.length) return null;

  const scoreVoice = (v: SpeechSynthesisVoice): number => {
    let s = 0;
    const name = v.name;
    const vLang = v.lang.replace('_', '-');

    // Language affinity
    if (/^zh-TW/i.test(vLang)) s += 40;
    else if (/^zh-HK/i.test(vLang)) s += 15;
    else if (/^zh/i.test(vLang)) s += 25;

    // Neural / Natural online voices in Edge & Windows 11
    if (/HsiaoChen/i.test(name)) s += 120;
    if (/YunJhe/i.test(name)) s += 115;
    if (/HsiaoYu/i.test(name)) s += 110;
    if (/Xiaoxiao|Yunxi/i.test(name)) s += 95;
    if (/Natural|Neural/i.test(name)) s += 80;
    if (/Online/i.test(name)) s += 45;

    // Apple macOS/iOS enhanced voices & Chrome Google voices
    if (/Premium|Enhanced/i.test(name)) s += 70;
    if (/Meijia|Sin-ji|Ting-Ting/i.test(name)) s += 60;
    if (/Google\s*國語|Google.*臺灣|Google.*Taiwan/i.test(name)) s += 55;

    // Penalize legacy flat desktop SAPI5 voices ("每個音都一樣大")
    if (/Hanhan|Tracy|Kangkang|Huihui|Yaoyao/i.test(name)) s -= 60;
    if (/Desktop/i.test(name)) s -= 30;

    return s;
  };

  const sorted = [...zhVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return sorted[0] ?? null;
}

// ---------- one shared audio element ----------
// Phones (iOS Safari above all) only let an <audio> start from a tap. A new
// Audio() per page therefore plays on the first page and is refused after the
// guide turns the page by itself. One element, unlocked once inside the tap
// that starts the guide, keeps the permission for every later page.
let sharedAudio: HTMLAudioElement | null = null;
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
function audioEl(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    sharedAudio.setAttribute('playsinline', '');
    (sharedAudio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  }
  return sharedAudio;
}
const detach = (a: HTMLAudioElement) => { a.onended = null; a.onerror = null; };

/**
 * Call synchronously inside a user gesture (the 導讀 / 朗讀 tap). Unlocks the
 * shared audio element and the system speech engine for the rest of the visit.
 */
export function unlockTtsAudio(): void {
  if (typeof window === 'undefined') return;
  const a = audioEl();
  if (a.paused) {
    detach(a);
    a.src = SILENT_WAV;
    a.play().catch(() => { /* a later src change is still allowed on most phones */ });
  }
  if ('speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}

/** Rate listener of the narration that is playing now (only one reacts). */
let activeRateHandler: RateListener | null = null;
onTtsRateChange((r, commit) => activeRateHandler?.(r, commit));

function playSmartBrowserSpeech(
  text: string,
  lang: string,
  onTierActive?: (tier: TtsTierId, label: string) => void,
  onEnd?: () => void,
): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return () => {};
  }

  window.speechSynthesis.cancel();
  const clauses = cleanTextForTts(text)
    .split(/(?<=[。！？；，、!?;,\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!clauses.length) {
    onEnd?.();
    return () => {};
  }

  // Group very short clauses together so speech doesn't chop unnaturally,
  // while keeping sentence boundaries distinct for natural breathing pauses.
  const segments: string[] = [];
  let buf = '';
  for (const c of clauses) {
    if (!buf) buf = c;
    else if (buf.length + c.length <= 42 && !/[。！？!?]$/.test(buf)) buf += c;
    else { segments.push(buf); buf = c; }
  }
  if (buf) segments.push(buf);

  let cancelled = false;
  let timerId: number | null = null;
  let idx = 0;
  let utterToken = 0;
  let curSeg = '';
  let curFrom = 0;      // where in curSeg the current utterance began
  let lastBoundary = 0; // char index reached inside the current utterance

  const voice = pickBestChineseVoice(lang);
  const voiceTag = voice
    ? /Natural|Neural|HsiaoChen|YunJhe/i.test(voice.name)
      ? '備位2 · 瀏覽器Natural語音'
      : '備位2 · 系統韻律調校語音'
    : TIER_LABELS['browser-smart-speech'];
  onTierActive?.('browser-smart-speech', voiceTag);

  const speak = (seg: string, from: number) => {
    const my = ++utterToken;
    const u = new SpeechSynthesisUtterance(seg.slice(from));
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    const isQuestion = /[？?]$/.test(seg);
    u.rate = Math.min(3, 1.03 * ttsRate);
    u.pitch = isQuestion ? 1.05 : 1.0;
    curSeg = seg; curFrom = from; lastBoundary = 0;
    u.onboundary = (e) => { if (my === utterToken) lastBoundary = e.charIndex; };
    u.onend = () => {
      if (cancelled || my !== utterToken) return;
      const isMajorBreak = /[。！？；!?;]$/.test(seg);
      const pauseMs = (isMajorBreak ? 160 : 65) / ttsRate;
      timerId = window.setTimeout(speakNext, pauseMs);
    };
    u.onerror = () => {
      if (cancelled || my !== utterToken) return;
      onEnd?.();
    };
    window.speechSynthesis.speak(u);
  };

  const speakNext = () => {
    if (cancelled || idx >= segments.length) {
      if (!cancelled) onEnd?.();
      return;
    }
    speak(segments[idx++], 0);
  };

  // A committed rate change re-speaks the rest of the current clause at the new rate.
  const handler: RateListener = (_r, commit) => {
    if (!commit || cancelled || !curSeg) return;
    const at = curFrom + lastBoundary;
    if (curSeg.length - at < 4) return; // nearly done: the next clause picks the rate up
    utterToken++;
    window.speechSynthesis.cancel();
    speak(curSeg, at);
  };
  activeRateHandler = handler;

  speakNext();

  return () => {
    cancelled = true;
    utterToken++;
    if (activeRateHandler === handler) activeRateHandler = null;
    if (timerId !== null) window.clearTimeout(timerId);
    window.speechSynthesis.cancel();
  };
}

type Synth = (text: string, rate: number) => Promise<string | null>;

/** Next clause/sentence break at or after `from` (index just past the mark). */
function breakAfter(text: string, from: number): number {
  for (let i = Math.max(0, from); i < text.length; i++) {
    if (/[。！？；，、!?;,]/.test(text[i])) return i + 1;
  }
  return -1;
}

/**
 * Plays synthesized chunks one after another on the shared audio element,
 * synthesizing chunk i+1 while chunk i plays.
 *
 * Rate changes: while the control moves, the playing clip is time-stretched
 * so the reader hears the change at once (pitch preserved). When the control
 * is released, the next chunks are synthesized natively at the new rate and
 * the rest of the current chunk is regenerated and swapped in at the next
 * clause break, so the voice settles back into real neural prosody.
 */
function playSynthQueue(
  chunks: string[],
  synth: Synth,
  tier: TtsTierId,
  onTierActive?: (tier: TtsTierId, label: string) => void,
  onEnd?: () => void,
  fallbackFn?: () => () => void,
): () => void {
  let cancelled = false;
  let fallbackCancel: (() => void) | null = null;
  let idx = -1;
  let clipText = '';   // text of the clip currently loaded
  let clipRate = 1;    // rate the clip was synthesized at
  let swapToken = 0;
  let swapPoll = 0;
  const a = audioEl();

  const fail = (first: boolean) => {
    if (cancelled) return;
    detach(a);
    if (first && fallbackFn) fallbackCancel = fallbackFn();
    else onEnd?.();
  };

  const load = (url: string, rate: number, text: string, onDone: () => void, first: boolean) => {
    detach(a);
    clipText = text;
    clipRate = rate;
    a.src = url;
    a.playbackRate = ttsRate / rate;
    a.onended = () => { if (!cancelled) onDone(); };
    a.onerror = () => fail(first);
    a.play().catch(() => fail(first));
  };

  const step = async (i: number) => {
    if (cancelled) return;
    idx = i;
    if (i >= chunks.length) { onEnd?.(); return; }
    const rate = ttsRate;
    const url = await synth(chunks[i], rate);
    if (cancelled) return;
    if (!url) { fail(i === 0); return; }
    if (i === 0) onTierActive?.(tier, TIER_LABELS[tier]);
    if (i + 1 < chunks.length) void synth(chunks[i + 1], rate);
    load(url, rate, chunks[i], () => void step(i + 1), i === 0);
  };

  const trySwap = async (rate: number) => {
    const my = ++swapToken;
    window.clearInterval(swapPoll);
    const dur = a.duration;
    if (!clipText || !isFinite(dur) || dur <= 0 || a.paused) return;
    const leftSec = (dur - a.currentTime) / Math.max(0.1, a.playbackRate);
    if (leftSec < 2.5) return; // the next chunk is already native-rate
    // Leave ~1.2 s of listening time for the regeneration to arrive.
    const aheadSec = a.currentTime + 1.2 * a.playbackRate;
    const cut = breakAfter(clipText, Math.ceil((aheadSec / dur) * clipText.length));
    if (cut < 0 || clipText.length - cut < 6) return;
    const rest = clipText.slice(cut);
    const swapAt = (cut / clipText.length) * dur;
    const text = clipText;
    const url = await synth(rest, rate);
    if (cancelled || my !== swapToken || !url || clipText !== text) return;
    if (a.currentTime > swapAt + 0.35) return; // missed the break: keep the stretched clip
    const at = idx;
    swapPoll = window.setInterval(() => {
      if (cancelled || my !== swapToken || clipText !== text) { window.clearInterval(swapPoll); return; }
      if (a.currentTime >= swapAt - 0.04 || a.ended) {
        window.clearInterval(swapPoll);
        load(url, rate, rest, () => void step(at + 1), false);
      }
    }, 30);
  };

  const handler: RateListener = (r, commit) => {
    if (cancelled) return;
    if (clipText) a.playbackRate = Math.min(4, Math.max(0.25, r / clipRate));
    if (!commit) return;
    if (idx + 1 < chunks.length) void synth(chunks[idx + 1], r);
    void trySwap(r);
  };
  activeRateHandler = handler;

  void step(0);

  return () => {
    cancelled = true;
    swapToken++;
    window.clearInterval(swapPoll);
    if (activeRateHandler === handler) activeRateHandler = null;
    detach(a);
    a.pause();
    clipText = '';
    if (fallbackCancel) { fallbackCancel(); fallbackCancel = null; }
  };
}

/** Pre-recorded page audio: the one tier that can only be time-stretched. */
function playRecorded(
  url: string,
  onTierActive?: (tier: TtsTierId, label: string) => void,
  onEnd?: () => void,
  fallbackFn?: () => () => void,
): () => void {
  let cancelled = false;
  let started = false;
  let fallbackCancel: (() => void) | null = null;
  const a = audioEl();
  const fail = () => {
    if (cancelled) return;
    detach(a);
    if (!started && fallbackFn) fallbackCancel = fallbackFn();
    else onEnd?.();
  };
  detach(a);
  a.src = url;
  a.playbackRate = ttsRate;
  a.onended = () => { if (!cancelled) onEnd?.(); };
  a.onerror = fail;
  a.play()
    .then(() => { started = true; if (!cancelled) onTierActive?.('prebundled-neural', TIER_LABELS['prebundled-neural']); })
    .catch(fail);
  const handler: RateListener = (r) => { if (!cancelled) a.playbackRate = r; };
  activeRateHandler = handler;
  return () => {
    cancelled = true;
    if (activeRateHandler === handler) activeRateHandler = null;
    detach(a);
    a.pause();
    if (fallbackCancel) { fallbackCancel(); fallbackCancel = null; }
  };
}

/**
 * Primary Entry Point: Speak text using the 4-tier 「先備位」 (Primary -> Fallback) Cascade.
 * Returns a cancel function.
 */
export function speakWithCascade(
  text: string,
  opts: TtsSpeakOptions = {},
): () => void {
  stopActiveTts();

  const voice = opts.voice || 'zh-TW-HsiaoChenNeural';
  const lang = opts.lang || 'zh-TW';
  const chunks = splitIntoSpeechChunks(text);

  if (!chunks.length && !opts.audioUrl) {
    opts.onEnd?.();
    return () => {};
  }

  // Tier 2B (第二備位): Smart Browser Natural Voice + Prosody
  const startTier2B = () =>
    playSmartBrowserSpeech(text, lang, opts.onTierActive, opts.onEnd);

  // Tier 2A (第一備位): Local In-Browser WebGPU/WASM Kokoro-82M Neural TTS -> falls back to Tier 2B
  const startTier2A = () => {
    const disabledByUser =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('tts_disable_local_wasm') === '1';
    if (disabledByUser) return startTier2B();
    return playSynthQueue(
      chunks,
      (t, r) => synthesizeLocalKokoroBlobUrl(t, r),
      'local-wasm-kokoro',
      opts.onTierActive,
      opts.onEnd,
      startTier2B,
    );
  };

  // Tier 1B (先位 B): Real-time Edge Neural TTS (`/api/tts`) -> Tier 2A -> Tier 2B
  const startTier1B = () => {
    if (opts.preferLocalWasm) return startTier2A();
    return playSynthQueue(
      chunks,
      (t, r) => fetchEdgeChunkBlobUrl(t, voice, r),
      'edge-neural-stream',
      opts.onTierActive,
      opts.onEnd,
      startTier2A,
    );
  };

  // Tier 1A (先位 A): Pre-bundled page neural audio -> Tier 1B -> Tier 2A -> Tier 2B
  const cancelFn = opts.audioUrl
    ? playRecorded(opts.audioUrl, opts.onTierActive, opts.onEnd, startTier1B)
    : startTier1B();

  activeStopFn = cancelFn;
  return () => {
    if (activeStopFn === cancelFn) activeStopFn = null;
    cancelFn();
  };
}
