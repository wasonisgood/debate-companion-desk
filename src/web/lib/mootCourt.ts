/**
 * Moot Court engine shared by the oral coach, single-question bench and the
 * 40-minute hearing simulation.
 *
 *  - Seats & time budget (20′ first counsel incl. preliminary issues, 17′ second counsel, 3′ rebuttal)
 *  - Script tokenising, cue-word extraction and a live ScriptTracker that follows the
 *    speaker's voice through the script (used to know "where counsel is")
 *  - LiveMic: mic level + silence + continuous English recognition with auto restart
 *  - Judge bench (3 judges by default) markup, states and per-judge voices
 *  - Persistent mastery (per oral unit) and hearing reports
 */

import { esc } from './dom';
import { hasCapture, pickEngine, transcribe, downsample, loadLocal, rememberNativeBroken, type SttEngine } from './stt';
import type { BenchQuestion, OralUnit } from './debateData';
import type { DebateData } from './debateStorage';

export type Side = 'prosecution' | 'defense';
export type Seat = 1 | 2;

/* ------------------------------------------------------------------ seats */

export const SEAT_INFO: Record<Seat, { zh: string; en: string; minutes: number; scope: string }> = {
  1: {
    zh: '第一辯士',
    en: 'First Counsel',
    minutes: 20,
    scope: '開場與路線圖 · 前提問題（IAC／Nexus／Gravity）· Count 1 Jaku 注射',
  },
  2: {
    zh: '第二辯士',
    en: 'Second Counsel',
    minutes: 17,
    scope: 'Count 2 · 7/22 學校空襲 · 結論與請求',
  },
};
export const REBUTTAL_MIN = 3;
export const TARGET_WPM = 125; // measured courtroom pace for non-native counsel

/** The two advocates. Both sides use the same team: Yang opens, Chen follows. */
export const SPEAKERS: Record<Seat, { id: 'yang' | 'chen'; zh: string; label: string }> = {
  1: { id: 'yang', zh: '楊昭容', label: 'Speaker 1 (Yang Jau-Rung 楊昭容)' },
  2: { id: 'chen', zh: '陳姵彤', label: 'Speaker 2 (Chen Pei-Tung 陳姵彤)' },
};

/** Section-based default: Count 2 and the prayer belong to the second counsel. */
export function defaultSeat(section: string): Seat {
  return /^(Count 2|Prayer)/i.test(section.trim()) ? 2 : 1;
}

/** Explicit seat set in the editor wins; otherwise derived from the section. */
export function seatOf(u: OralUnit): Seat {
  return u.seat ?? defaultSeat(u.section);
}

export function sideLabel(side: Side): string {
  return side === 'prosecution' ? '控方 Prosecution' : '辯方 Defense';
}

export function oralOf(data: DebateData, side: Side): OralUnit[] {
  return side === 'prosecution' ? data.prosecutionOral : data.defenseOral;
}
export function questionsOf(data: DebateData, side: Side): BenchQuestion[] {
  return side === 'prosecution' ? data.prosecutionQuestions : data.defenseQuestions;
}
export function unitsFor(data: DebateData, side: Side, seat?: Seat): OralUnit[] {
  const list = oralOf(data, side);
  return seat ? list.filter((u) => seatOf(u) === seat) : list;
}

/** "Preliminary Issues: IAC 國際武裝衝突存在" -> "IAC 國際武裝衝突存在" */
export function shortSection(sec: string): string {
  const i = sec.indexOf(':');
  return (i >= 0 ? sec.slice(i + 1) : sec).trim();
}

/* ------------------------------------------------------------------ script text */

/** Script marker such as "[→法官題 P-01]" or "[→老師題 TP-12]"; ids are letters-dash-alphanumerics. */
const REF_RE = /\[→[^\]\s]*\s*([A-Za-z]+-[A-Za-z0-9_-]+)\s*\]/g;
export const QID_RE = /^[A-Za-z]+-[A-Za-z0-9_-]+$/;

export function refsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(REF_RE)) out.push(m[1]);
  return out;
}

/** Spoken text only: insertion-point markers are stage directions, never script words. */
export function cleanScript(text: string): string {
  return text.replace(/\[→[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * An insertion point: `[→法官題 P-03]` placed after word `at - 1` of the clean
 * script means "a judge may cut in here with P-03". Markers are positional
 * tags for the bench, not part of what the advocate says.
 */
export interface Anchor {
  at: number; // clean-token index the judge cuts in before (0..len)
  qid: string;
  teacher: boolean;
}

export function anchorsOf(text: string, offset = 0): Anchor[] {
  const out: Anchor[] = [];
  let words = 0;
  let last = 0;
  for (const m of text.matchAll(REF_RE)) {
    const idx = m.index ?? 0;
    words += cleanScript(text.slice(last, idx)).split(/\s+/).filter(Boolean).length;
    last = idx + m[0].length;
    out.push({ at: offset + words, qid: m[1], teacher: /^T/i.test(m[1]) });
  }
  return out;
}

export interface Tok {
  raw: string;
  norm: string;
  key: boolean; // cue word (authority, number, name, sentence head)
  sentHead: boolean;
}

const AUTH_RE =
  /^(art|article|articles|tadi[cć]|rome|statute|icrc|geneva|commentary|protocol|bemba|lubanga|katanga|delali[cć]|kunarac|ntaganda|ongwen|al-?hassan|abu|elements|facts?|para|paragraph|ihl|iac|niac|icc|icty|nexus|gravity|jaku|thorn|veyar|titans?|damaroi|pallavon|santo|targa|mens|rea|actus)$/i;

export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function tokenize(text: string): Tok[] {
  const words = cleanScript(text).split(/\s+/).filter(Boolean);
  const out: Tok[] = [];
  let sentStart = true;
  let sentPos = 0;
  for (const raw of words) {
    const norm = normWord(raw);
    const core = raw.replace(/^[“"‘'(\[]+|[”"’'),.;:?!\]]+$/g, '');
    const isNum = /\d/.test(raw);
    const isCap = /^[A-Z]/.test(core) && !sentStart && core.length > 1;
    const head = sentStart || sentPos < 2;
    out.push({ raw, norm, key: head || isNum || AUTH_RE.test(norm) || isCap, sentHead: sentStart });
    sentPos = sentStart ? 1 : sentPos + 1;
    sentStart = /[.?!:]["”’)]*$/.test(raw);
    if (sentStart) sentPos = 0;
  }
  return out;
}

export function wordsCount(text: string): number {
  return cleanScript(text).split(/\s+/).filter(Boolean).length;
}

export function estimateSec(words: number, wpm = TARGET_WPM): number {
  return Math.round((words / wpm) * 60);
}

/* ------------------------------------------------------------------ tracker */

/**
 * Follows a speaker through a tokenised script. Feed recognised words; the
 * tracker advances `pos` on local matches and re-synchronises on longer jumps,
 * so skipped passages stay uncovered (used for coverage and "where am I").
 */
export class ScriptTracker {
  pos = 0;
  maxPos = 0;
  covered: Uint8Array;
  private miss = 0;
  private prev = '';

  constructor(public toks: Tok[]) {
    this.covered = new Uint8Array(toks.length);
  }

  reset(pos = 0) {
    this.pos = pos;
    this.miss = 0;
    this.prev = '';
  }

  feedText(text: string) {
    for (const w of text.split(/\s+/)) {
      const n = normWord(w);
      if (n) this.feed(n);
    }
  }

  /** Position the tracker would have after `text`, without committing. */
  peek(text: string): number {
    const saved = { pos: this.pos, miss: this.miss, prev: this.prev, max: this.maxPos };
    const cov = this.covered.slice();
    this.feedText(text);
    const p = this.pos;
    this.pos = saved.pos;
    this.miss = saved.miss;
    this.prev = saved.prev;
    this.maxPos = saved.max;
    this.covered = cov;
    return p;
  }

  private feed(n: string) {
    const t = this.toks;
    if (!t.length) return;
    const near = Math.min(t.length, this.pos + 6);
    for (let k = this.pos; k < near; k++) {
      if (t[k].norm === n) return this.hit(k, n);
    }
    // wider window needs bigram support or a distinctive word
    const far = Math.min(t.length, this.pos + (this.miss > 8 ? 220 : 40));
    for (let k = near; k < far; k++) {
      if (t[k].norm !== n) continue;
      const bigram = k > 0 && t[k - 1].norm === this.prev;
      if (bigram || (n.length >= 7 && this.miss > 2)) return this.hit(k, n);
    }
    // allow small backward correction (counsel repeats a phrase)
    for (let k = Math.max(0, this.pos - 8); k < this.pos; k++) {
      if (t[k].norm === n && k > 0 && t[k - 1].norm === this.prev) {
        this.pos = k + 1;
        this.prev = n;
        return;
      }
    }
    this.miss++;
    this.prev = n;
  }

  private hit(k: number, n: string) {
    this.covered[k] = 1;
    this.pos = k + 1;
    if (this.pos > this.maxPos) this.maxPos = this.pos;
    this.miss = 0;
    this.prev = n;
  }

  coverage(from = 0, to = this.toks.length): number {
    if (to <= from) return 1;
    let c = 0;
    for (let i = from; i < to; i++) c += this.covered[i];
    return c / (to - from);
  }
}

/* ------------------------------------------------------------------ live mic */

export interface LiveMic {
  stop(): void;
  /** ms since the last detected voice activity (0 while speaking) */
  silenceMs(): number;
  speaking(): boolean;
  level(): number;
  /** total voiced time in seconds */
  voicedSec(): number;
  /** ignore input (judge TTS playing) */
  setMuted(m: boolean): void;
  hasRecognition: boolean;
  /** Which recogniser is listening; changes if native recognition fails mid-session. */
  engine(): SttEngine;
  /** Start (or restart) recording the mic to a compressed audio blob. */
  startRecording(): boolean;
  /** Stop recording and hand back what was captured (null when nothing / unsupported). */
  stopRecording(): Promise<Blob | null>;
  recordingSec(): number;
}

/** Speech-grade Opus: ~3 MB for 20 minutes. */
const REC_BPS = 20000;
function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

/**
 * Can this browser turn speech into text at all? True on every browser with a
 * microphone: Chrome / Edge / Safari use the Web Speech API, the rest (Firefox,
 * in-app browsers, Safari when Apple's service is off) run Whisper on the
 * device. See src/lib/stt.ts.
 */
export function hasSpeechRecognition(): boolean {
  return pickEngine() !== 'none';
}

export async function startLiveMic(opts: {
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  lang?: string;
}): Promise<LiveMic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  // iOS Safari creates audio contexts suspended; without this the level meter
  // and the Whisper path hear nothing.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);

  let active = true;
  let muted = false;
  let lvl = 0;
  let noise = 0.01;
  let lastVoice = performance.now();
  let voiced = 0;
  let lastFrame = performance.now();

  const tick = () => {
    if (!active) return;
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    if (rms < noise * 1.6) noise = noise * 0.97 + rms * 0.03;
    const thr = Math.max(0.012, noise * 2.8);
    lvl = Math.min(1, rms * 6);
    if (!muted && rms > thr) {
      lastVoice = now;
      voiced += dt / 1000;
    }
    raf = requestAnimationFrame(tick);
  };
  let raf = requestAnimationFrame(tick);

  // Speech recognition with automatic restart (Chrome ends sessions periodically).
  // Where the Web Speech API is missing or refuses to run (Firefox; Safari with
  // Siri / dictation off), phrases are cut at pauses and sent to Whisper.
  let engine: SttEngine = pickEngine();
  let rec: any = null;
  let gotResult = false;
  let nativeErrors = 0;
  const started = performance.now();
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const startNative = () => {
    rec = new SR();
    rec.lang = opts.lang ?? 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      if (muted) return;
      gotResult = true;
      nativeErrors = 0;
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) opts.onFinal?.(t.trim());
        else interim += t;
      }
      lastVoice = performance.now();
      opts.onInterim?.(interim.trim());
    };
    rec.onerror = (e: any) => {
      const fatal = ['service-not-allowed', 'language-not-supported', 'audio-capture'].includes(e?.error);
      if (e?.error === 'network' || e?.error === 'not-allowed') nativeErrors++;
      if ((fatal || nativeErrors >= 2) && hasCapture()) {
        rememberNativeBroken();
        useWhisper();
      }
    };
    rec.onend = () => {
      if (active && engine === 'native') setTimeout(() => active && engine === 'native' && safeStart(), 120);
    };
    const safeStart = () => {
      try {
        rec.start();
      } catch {}
    };
    safeStart();
  };

  // ---- Whisper path: raw PCM, voice-activity phrases, transcribed in order
  let proc: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  function useWhisper() {
    if (proc) return;
    if (rec) {
      try { rec.onend = null; rec.abort(); } catch {}
      rec = null;
    }
    engine = pickEngine(true);
    if (engine !== 'local') return;
    loadLocal().catch(() => {});
    const rate = ctx.sampleRate;
    const block = 4096;
    proc = ctx.createScriptProcessor(block, 1, 1);
    sink = ctx.createGain();
    sink.gain.value = 0; // Safari only runs processors that reach the destination
    src.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
    const preroll: Float32Array[] = [];
    let phrase: Float32Array[] | null = null;
    let phraseLen = 0;
    let quietFor = 0;
    const blockSec = block / rate;
    const flush = () => {
      if (!phrase) return;
      const all = new Float32Array(phraseLen);
      let o = 0;
      for (const b of phrase) { all.set(b, o); o += b.length; }
      phrase = null;
      phraseLen = 0;
      if (all.length / rate < 0.45) return;
      const pcm = downsample(all, rate);
      pending++;
      opts.onInterim?.('…');
      queue = queue.then(async () => {
        try {
          const text = await transcribe(pcm);
          if (active && text) opts.onFinal?.(text);
        } catch (err) {
          console.warn('speech-to-text failed', err);
        } finally {
          pending--;
          if (active) opts.onInterim?.(pending ? '…' : '');
        }
      });
    };
    proc.onaudioprocess = (ev) => {
      if (!active) return;
      const data = new Float32Array(ev.inputBuffer.getChannelData(0));
      if (muted) { phrase = null; phraseLen = 0; preroll.length = 0; return; }
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      const rms = Math.sqrt(s / data.length);
      const loud = rms > Math.max(0.012, noise * 2.8);
      if (!phrase) {
        preroll.push(data);
        if (preroll.length > 3) preroll.shift();
        if (loud) { phrase = [...preroll]; phraseLen = preroll.reduce((a, b) => a + b.length, 0); preroll.length = 0; quietFor = 0; }
        return;
      }
      phrase.push(data);
      phraseLen += data.length;
      quietFor = loud ? 0 : quietFor + blockSec;
      const len = phraseLen / rate;
      // end of phrase: a breath (≥ 0.7 s) — or a hard cap so long runs still stream
      if (quietFor >= 0.6 || (len > 9 && quietFor >= 0.2) || len > 14) flush();
    };
  }

  if (engine === 'native' && SR) startNative();
  else if (engine === 'local') useWhisper();
  // native that never produces anything (Safari with dictation off can fail silently)
  const watchdog = setInterval(() => {
    if (!active) return clearInterval(watchdog);
    if (engine === 'native' && !gotResult && voiced > 4 && performance.now() - started > 6000 && hasCapture()) {
      clearInterval(watchdog);
      rememberNativeBroken();
      useWhisper();
    }
    if (engine !== 'native') clearInterval(watchdog);
  }, 1500);

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recStart = 0;
  const finishRec = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const r = recorder;
      recorder = null;
      if (!r || r.state === 'inactive') return resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null);
      const type = r.mimeType || 'audio/webm';
      r.onstop = () => resolve(chunks.length ? new Blob(chunks, { type }) : null);
      try {
        r.stop();
      } catch {
        resolve(null);
      }
    });

  return {
    hasRecognition: engine !== 'none',
    engine: () => engine,
    startRecording() {
      const mime = recorderMime();
      if (!mime) return false;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        chunks = [];
        recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: REC_BPS });
        recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
        recorder.start(5000);
        recStart = performance.now();
        return true;
      } catch {
        recorder = null;
        return false;
      }
    },
    stopRecording: finishRec,
    recordingSec: () => (recorder ? (performance.now() - recStart) / 1000 : 0),
    stop() {
      active = false;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
      cancelAnimationFrame(raf);
      try {
        rec && (rec.onend = null, rec.abort());
      } catch {}
      clearInterval(watchdog);
      if (proc) {
        proc.onaudioprocess = null;
        try { src.disconnect(proc); proc.disconnect(); sink?.disconnect(); } catch {}
      }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
    // While a Whisper phrase is still being transcribed the answer is not over:
    // report no silence until its text has arrived.
    silenceMs: () => (muted || pending ? 0 : Math.max(0, performance.now() - lastVoice)),
    speaking: () => !muted && performance.now() - lastVoice < 350,
    level: () => (muted ? 0 : lvl),
    voicedSec: () => voiced,
    setMuted(m: boolean) {
      muted = m;
      if (!m) lastVoice = performance.now();
    },
  };
}

/* ------------------------------------------------------------------ voices */

let voiceCache: SpeechSynthesisVoice[] = [];
function enVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  if (!voiceCache.length) {
    voiceCache = speechSynthesis.getVoices().filter((v) => /^en(-|_)/i.test(v.lang));
    // Prefer GB / US natural voices first
    voiceCache.sort((a, b) => score(b) - score(a));
  }
  return voiceCache;
  function score(v: SpeechSynthesisVoice) {
    return (/natural|neural|google|online/i.test(v.name) ? 2 : 0) + (/en-GB/i.test(v.lang) ? 1 : 0);
  }
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => (voiceCache = []));
}

/** Speak as judge `idx` (distinct voice / pitch). Returns a cancel function. */
export function speakAs(text: string, idx: number, onEnd?: () => void, rate = 0.98): () => void {
  if (!('speechSynthesis' in window)) {
    setTimeout(() => onEnd?.(), 50);
    return () => {};
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  const vs = enVoices();
  if (vs.length) u.voice = vs[idx % vs.length];
  u.pitch = [0.9, 1.05, 0.8, 1.1][idx % 4];
  u.rate = rate;
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  u.onend = fin;
  u.onerror = fin;
  speechSynthesis.speak(u);
  // safety: some engines never fire onend
  const guard = setTimeout(fin, 1500 + text.split(/\s+/).length * 600);
  return () => {
    clearTimeout(guard);
    done = true;
    speechSynthesis.cancel();
  };
}

/* ------------------------------------------------------------------ judges */

export interface Judge {
  key: string;
  zh: string;
  en: string;
  address: string;
}

export const JUDGES: Judge[] = [
  { key: 'president', zh: '審判長', en: 'Presiding Judge', address: 'Mr. President' },
  { key: 'right', zh: '陪席法官', en: 'Judge (Right)', address: 'Your Excellency' },
  { key: 'left', zh: '陪席法官', en: 'Judge (Left)', address: 'Your Excellency' },
];

export type JudgeState = 'idle' | 'listening' | 'lean' | 'speaking' | 'writing';

/** Seating order on screen: left, president (centre), right. */
export function benchOrder(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [0, 1];
  return [2, 0, 1];
}

export function benchHtml(count: number): string {
  return `<div class="moot-bench" data-count="${count}">${benchOrder(count)
    .map(
      (i) => `
      <figure class="moot-judge ${i === 0 ? 'presiding' : ''}" data-judge="${i}" data-state="idle">
        <svg viewBox="0 0 120 120" aria-hidden="true" class="moot-judge-fig">
          <circle cx="60" cy="40" r="20" class="head"/>
          <path d="M18 118 C20 78 38 66 60 66 C82 66 100 78 102 118 Z" class="robe"/>
          <path d="M52 66 L60 92 L68 66 Z" class="collar"/>
          <rect x="6" y="100" width="108" height="20" rx="1" class="desk"/>
          <g class="pen"><path d="M84 96 L98 82" stroke-width="3"/></g>
        </svg>
        <div class="moot-voice"><i></i><i></i><i></i><i></i><i></i></div>
        <figcaption>
          <b>${esc(JUDGES[i].zh)}</b>
          <span>${esc(JUDGES[i].en)}</span>
        </figcaption>
      </figure>`,
    )
    .join('')}</div>`;
}

export function setJudgeState(root: ParentNode, idx: number, state: JudgeState) {
  const el = root.querySelector<HTMLElement>(`.moot-judge[data-judge="${idx}"]`);
  if (el) el.dataset.state = state;
}
export function setAllJudges(root: ParentNode, state: JudgeState) {
  root.querySelectorAll<HTMLElement>('.moot-judge').forEach((el) => (el.dataset.state = state));
}

/* ------------------------------------------------------------------ question routing */

/** Map question id -> units that reference it in the script. */
export function refIndex(units: OralUnit[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  units.forEach((u, i) => {
    for (const id of refsOf(u.textEn)) {
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(i);
    }
  });
  return m;
}

export function questionSeat(q: BenchQuestion, allUnits: OralUnit[]): Seat | 0 {
  if (q.seat) return q.seat;
  return derivedQuestionSeat(q, allUnits);
}

/** Seat implied by where the script links the question, else by its subject matter. */
export function derivedQuestionSeat(q: BenchQuestion, allUnits: OralUnit[]): Seat | 0 {
  for (const u of allUnits) if (refsOf(u.textEn).includes(q.id)) return seatOf(u);
  const t = `${q.title} ${q.issue} ${q.category} ${q.questionEn}`.toLowerCase();
  if (/count 2|airstrike|school|proportional|precaution|7\/22|22 july/.test(t)) return 2;
  if (/count 1|jaku|inject|medical|experiment|iac|tadi|nexus|gravity|armed conflict/.test(t)) return 1;
  return 0;
}

/* ------------------------------------------------------------------ persistence */

export interface Mastery {
  level: number; // 0 new · 1 read · 2 cue · 3 blind · 4 holds under interruption
  best: number;
  attempts: number;
  last: number;
}

const MASTERY_KEY = 'debate_mastery_v1';
const PREF_KEY = 'debate_prefs_v1';
const HEARINGS_KEY = 'debate_hearings_v1';

export function loadMastery(): Record<string, Mastery> {
  try {
    return JSON.parse(localStorage.getItem(MASTERY_KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveMastery(m: Record<string, Mastery>) {
  try {
    localStorage.setItem(MASTERY_KEY, JSON.stringify(m));
  } catch {}
}

export interface Prefs {
  side: Side;
  seat: Seat;
  judges: number;
  intensity: 'light' | 'standard' | 'hot';
}
export function loadPrefs(): Prefs {
  const d: Prefs = { side: 'prosecution', seat: 1, judges: 3, intensity: 'standard' };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return d;
  }
}
export function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {}
}

/* hearing reports ---------------------------------------------------- */

export interface HintLog {
  at: number; // sec from hearing start
  dur: number; // sec visible
  phase: number;
  kind: 'script' | 'answer';
  ref: string; // unit id / question id
  label: string; // section or question title
  shown: string; // excerpt of what was displayed
}

export interface QaLog {
  at: number;
  phase: number;
  judge: number;
  qid: string;
  question: string;
  followUp: boolean;
  answer: string;
  answerSec: number;
  askSec: number; // judge speaking time
  unitId: string;
  resumed: 'ok' | 'skipped' | 'repeated' | 'n/a';
  anchored?: boolean; // asked at a ⚖ insertion point in the script
  score?: number;
  feedback?: string;
}

export interface PhaseLog {
  kind: 'seat1' | 'seat2' | 'rebuttal';
  label: string;
  allotted: number;
  used: number;
  words: number;
  voicedSec: number;
  qaSec: number;
  coverage: number;
  finished: boolean;
  overtime: number;
  skipped: string[]; // section labels with low coverage before reach point
  notReached: string[];
  transcript: string;
}

export interface HearingReport {
  id: string;
  ts: number;
  side: Side;
  mode: 'seat1' | 'seat2' | 'relay';
  judges: number;
  intensity: Prefs['intensity'];
  total: number;
  elapsed: number;
  phases: PhaseLog[];
  qa: QaLog[];
  hints: HintLog[];
  timeline: { at: number; dur: number; type: 'speech' | 'qa' | 'hint' | 'silence'; phase: number }[];
  advice: string[];
  engine: string;
}

export function loadHearings(): HearingReport[] {
  try {
    return JSON.parse(localStorage.getItem(HEARINGS_KEY) || '[]');
  } catch {
    return [];
  }
}
export function saveHearing(r: HearingReport) {
  try {
    const list = loadHearings().filter((x) => x.id !== r.id);
    list.unshift(r);
    localStorage.setItem(HEARINGS_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}

/* ------------------------------------------------------------------ misc */

export function fmtClock(sec: number): string {
  const neg = sec < 0;
  const s = Math.abs(Math.round(sec));
  return `${neg ? '+' : ''}${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export function fmtMin(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} 秒`;
  if (s >= 3600) return `${Math.floor(s / 3600)} 小時 ${Math.round((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function pick<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Judge interruption openers — real benches rarely wait for a polite pause. */
export const OPENERS = [
  'Counsel, if I may interrupt you there.',
  'Counsel, before you move on —',
  'Sorry to stop you, counsel.',
  'Counsel, let me press you on that point.',
  'A question from the bench, counsel.',
];

export const RESUME_LINES = ['Thank you. Please continue.', 'Very well. You may proceed.', 'Thank you, counsel.', 'Please go on.'];
