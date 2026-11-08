/**
 * Speech-to-text for every browser, with no second AI vendor.
 *
 *   native  Web Speech API (Chrome, Edge, Samsung Internet, Chrome on Android;
 *           Safari 14.1+ / iOS 14.5+ as webkitSpeechRecognition, partial)
 *   local   Whisper running in the page (transformers.js; WebGPU when the
 *           browser has it, otherwise WebAssembly). Free, no key, works
 *           offline after the first download, works with a practice code.
 *
 * Firefox has no Web Speech recognition at all, and Safari's stops working
 * when Siri / dictation is off or the network to Apple is slow. So:
 *   - 'auto' uses native where it exists, and switches to Whisper the moment
 *     native reports an error or stays silent while the person is speaking;
 *   - that failure is remembered on the device for a week, so the next
 *     session starts on Whisper directly;
 *   - the Whisper model is fetched in the background as soon as the debate
 *     module opens on a browser that will need it, so the first answer does
 *     not wait for a 40–80 MB download;
 *   - the phrases are cut at natural pauses from raw PCM (no MediaRecorder
 *     container issues on Safari / Firefox).
 */

export type SttPref = 'auto' | 'native' | 'local';
export type SttEngine = 'native' | 'local' | 'none';

const KEY = 'debate_stt_v1';
const BROKEN_KEY = 'debate_stt_native_broken_v1';
const WEEK = 7 * 86_400_000;

export const STT_LABEL: Record<SttPref, string> = {
  auto: '自動',
  native: '瀏覽器內建',
  local: '本機 Whisper（離線）',
};

export function sttPref(): SttPref {
  try {
    const v = localStorage.getItem(KEY) as SttPref | null;
    return v && v in STT_LABEL ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setSttPref(p: SttPref) {
  try { localStorage.setItem(KEY, p); } catch {}
  if (p === 'native') forgetNativeBroken();
}

export const hasNative = () =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
/** Raw-audio capture for the Whisper path. */
export const hasCapture = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || (window as any).webkitAudioContext);

/** Native recognition failed on this device recently: start on Whisper next time. */
export function nativeBroken(): boolean {
  try {
    const t = Number(localStorage.getItem(BROKEN_KEY) || 0);
    return t > 0 && Date.now() - t < WEEK;
  } catch {
    return false;
  }
}
export function rememberNativeBroken() {
  try { localStorage.setItem(BROKEN_KEY, String(Date.now())); } catch {}
}
export function forgetNativeBroken() {
  try { localStorage.removeItem(BROKEN_KEY); } catch {}
}

/** Engine for a new microphone session. `failedNow` = native just said it cannot run. */
export function pickEngine(failedNow = false): SttEngine {
  const p = sttPref();
  const nativeOk = hasNative() && !failedNow && (p === 'native' || !nativeBroken());
  if (p === 'local') return hasCapture() ? 'local' : nativeOk ? 'native' : 'none';
  if (nativeOk) return 'native';
  return hasCapture() ? 'local' : 'none';
}

export function engineLabel(e: SttEngine = pickEngine()): string {
  return { native: '瀏覽器內建語音辨識', local: '本機 Whisper', none: '無法使用麥克風' }[e];
}

/* ------------------------------------------------------------------ local Whisper */

let worker: Worker | null = null;
let ready: Promise<{ device: string; model: string }> | null = null;
let seq = 0;
const waiting = new Map<number, [(t: string) => void, (e: Error) => void]>();
const loadListeners = new Set<(p: number, file: string) => void>();
let localInfo = '';
let localError = '';

export function onLocalProgress(fn: (p: number, file: string) => void) {
  loadListeners.add(fn);
  return () => { loadListeners.delete(fn); };
}
export const localModelInfo = () => localInfo;
export const localModelError = () => localError;
export const localLoading = () => !!ready && !localInfo && !localError;

/** Start (or reuse) the on-device model. First use downloads ~40–80 MB, cached afterwards. */
export function loadLocal(): Promise<{ device: string; model: string }> {
  if (ready) return ready;
  localError = '';
  ready = new Promise((resolve, reject) => {
    worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') loadListeners.forEach((f) => f(m.p, m.file));
      else if (m.type === 'ready') {
        localInfo = `${m.model.split('/').pop()} · ${m.device === 'webgpu' ? 'WebGPU' : 'WebAssembly'}`;
        loadListeners.forEach((f) => f(100, ''));
        resolve(m);
      } else if (m.type === 'text') { waiting.get(m.id)?.[0](m.text); waiting.delete(m.id); }
      else if (m.type === 'error') {
        if (m.id === -1) { ready = null; localError = m.message; reject(new Error(m.message)); }
        else { waiting.get(m.id)?.[1](new Error(m.message)); waiting.delete(m.id); }
      }
    };
    worker.onerror = (e) => { ready = null; localError = e.message || '本機語音模型載入失敗'; reject(new Error(localError)); };
    worker.postMessage({ type: 'load' });
  });
  return ready;
}

/**
 * Fetch the model ahead of time when this browser will (or may) need it:
 * no native recognition, native failed here before, Whisper chosen, or
 * Safari (whose recognition often stops working mid-session).
 */
export function preloadIfNeeded() {
  if (!hasCapture() || ready) return;
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
  if (pickEngine() === 'local' || safari) loadLocal().catch(() => {});
}

async function transcribeLocal(pcm16k: Float32Array): Promise<string> {
  await loadLocal();
  const id = ++seq;
  return new Promise((res, rej) => {
    waiting.set(id, [res, rej]);
    worker!.postMessage({ type: 'run', id, audio: pcm16k }, [pcm16k.buffer]);
  });
}

/* ------------------------------------------------------------------ shared */

/** Whisper fills silence with stock phrases; drop them and bracketed noise tags. */
export function cleanTranscript(t: string): string {
  const s = t.replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(thank you\.?|thanks for watching\.?|you|bye\.?|\.+)$/i.test(s)) return '';
  return s;
}

export function downsample(input: Float32Array, rate: number, target = 16000): Float32Array {
  if (rate === target) return input;
  const ratio = rate / target;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** Transcribe one phrase (16 kHz mono) on the device. */
export async function transcribe(pcm16k: Float32Array): Promise<string> {
  return cleanTranscript(await transcribeLocal(pcm16k));
}

/** One line for the practice screens when Whisper listens ('' with native recognition). */
export function sttNote(): string {
  const e = pickEngine();
  if (e === 'none') return '此瀏覽器無法使用麥克風（需要 HTTPS 與麥克風權限）。';
  if (e === 'native') return '';
  const why = !hasNative()
    ? '此瀏覽器沒有內建語音辨識（Firefox、部分手機瀏覽器），改用'
    : nativeBroken() && sttPref() !== 'local' ? '這台裝置的內建語音辨識之前失效過，改用' : '使用';
  const dl = localModelInfo() ? '' : localLoading() ? '模型下載中，' : '第一次使用會下載約 40–80 MB 模型，';
  return `${why}本機 Whisper：${dl}講完一句、稍微停頓後文字才會出現。`;
}
