/**
 * Audio monitoring, silence interval detection, Web Speech Recognition & Synthesis,
 * and recitation diff utilities for the Moot Court Debate practice module.
 */

export interface AudioDetectorOptions {
  silenceThresholdMs: number; // e.g. 1000ms
  volumeFloor: number; // 0.0 to 1.0 (threshold below which audio is considered silence)
  onVolume: (vol: number) => void; // 0.0 - 1.0 for visualizer
  onSilenceThreshold: (silenceMs: number, spokenSec: number) => void;
  onSpeechStart?: () => void;
  onSpeechResume?: () => void;
}

export interface AudioDetectorHandle {
  stop: () => void;
  getStats: () => { totalSpeechSec: number; pausesCount: number; currentSilenceMs: number };
  getAudioBlob: () => Promise<Blob | null>;
}

/** Play a court gavel strike sound using Web Audio oscillator */
export function playGavelSound(): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    // Wood strike fundamental
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Second strike echo (double tap)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(140, now + 0.18);
    osc2.frequency.exponentialRampToValueAtTime(40, now + 0.3);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.5, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.33);

    setTimeout(() => ctx.close(), 500);
  } catch (e) {
    console.warn('AudioContext sound failed', e);
  }
}

/** Play a court chime alert */
export function playChimeSound(): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.08); // A5

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.46);
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

/**
 * Start listening to microphone and detect silence intervals for moot court interruption.
 */
export async function startAudioDetector(options: AudioDetectorOptions): Promise<AudioDetectorHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.3;
  source.connect(analyser);

  // Initialize MediaRecorder for multimodal audio capture (Prompt API / local recording)
  let mediaRecorder: MediaRecorder | null = null;
  const audioChunks: Blob[] = [];
  if (typeof MediaRecorder !== 'undefined') {
    try {
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.start(100);
    } catch (e) {
      console.info('MediaRecorder not available or failed to start', e);
    }
  }

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let active = true;
  let rafId = 0;

  let isSpeaking = false;
  let speechStartTime = 0;
  let totalSpeechSec = 0;
  let silenceStartTime = 0;
  let pausesCount = 0;
  let hasTriggeredForCurrentPause = false;

  const loop = () => {
    if (!active) return;
    analyser.getByteFrequencyData(dataArray);

    // Calculate RMS volume level 0.0 ~ 1.0
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 255;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    options.onVolume(Math.min(1, rms * 3.5));

    const now = performance.now();
    const isAboveFloor = rms > options.volumeFloor;

    if (isAboveFloor) {
      if (!isSpeaking) {
        isSpeaking = true;
        speechStartTime = now;
        options.onSpeechStart?.();
      }
      silenceStartTime = 0;
      hasTriggeredForCurrentPause = false;
      totalSpeechSec += 0.016; // approx per frame
    } else {
      if (isSpeaking) {
        if (silenceStartTime === 0) {
          silenceStartTime = now;
          pausesCount++;
        }
        const silenceDuration = now - silenceStartTime;
        if (silenceDuration >= options.silenceThresholdMs && !hasTriggeredForCurrentPause) {
          hasTriggeredForCurrentPause = true;
          options.onSilenceThreshold(silenceDuration, totalSpeechSec);
        }
      }
    }

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return {
    stop: () => {
      active = false;
      cancelAnimationFrame(rafId);
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch {}
      }
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
    },
    getStats: () => ({
      totalSpeechSec: Math.round(totalSpeechSec * 10) / 10,
      pausesCount,
      currentSilenceMs: silenceStartTime ? Math.round(performance.now() - silenceStartTime) : 0,
    }),
    getAudioBlob: async () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        return new Promise<Blob>((resolve) => {
          mediaRecorder!.onstop = () => {
            resolve(new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' }));
          };
          try { mediaRecorder!.stop(); } catch { resolve(new Blob(audioChunks, { type: 'audio/webm' })); }
        });
      }
      return audioChunks.length > 0 ? new Blob(audioChunks, { type: 'audio/webm' }) : null;
    },
  };
}

/** Check if Web Speech Recognition is available */
export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

/** Create a speech recognition session */
export function createSpeechRecognizer(options: {
  lang: string;
  continuous?: boolean;
  interimResults?: boolean;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (err: any) => void;
  onEnd?: () => void;
}) {
  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRec) {
    throw new Error('此瀏覽器不支援 Web Speech API。建議使用 Chrome 或 Edge。');
  }

  const rec = new SpeechRec();
  rec.lang = options.lang;
  rec.continuous = options.continuous ?? true;
  rec.interimResults = options.interimResults ?? true;
  rec.maxAlternatives = 1;

  rec.onresult = (event: any) => {
    let interim = '';
    let finalChunk = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const part = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalChunk += part;
      } else {
        interim += part;
      }
    }
    if (interim) options.onInterim(interim);
    if (finalChunk) options.onFinal(finalChunk);
  };

  rec.onerror = (e: any) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      options.onError?.(e);
    }
  };

  rec.onend = () => {
    options.onEnd?.();
  };

  return {
    start: () => {
      try {
        rec.start();
      } catch (err) {
        console.warn('SpeechRecognition start err', err);
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {}
    },
    abort: () => {
      try {
        rec.abort();
      } catch {}
    },
  };
}

import { speakWithCascade } from './tts';

/** Speak text with Multi-tier "先備位" (Primary -> Fallback) Cascade TTS */
export function speakText(text: string, lang: 'en' | 'zh', onEnd?: () => void): () => void {
  if (lang === 'zh') {
    return speakWithCascade(text, {
      lang: 'zh-TW',
      voice: 'zh-TW-HsiaoChenNeural',
      onEnd,
    });
  }
  if (!('speechSynthesis' in window)) {
    onEnd?.();
    return () => {};
  }
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1.0;
  u.pitch = 0.95;

  const voices = window.speechSynthesis.getVoices();
  const targetVoice = voices.find((v) => v.lang.startsWith('en'));
  if (targetVoice) u.voice = targetVoice;

  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();

  window.speechSynthesis.speak(u);

  return () => {
    window.speechSynthesis.cancel();
  };
}

/** Recitation text diff and word accuracy evaluation */
export interface DiffToken {
  type: 'correct' | 'missing' | 'extra';
  word: string;
}

export interface RecitationDiffResult {
  tokens: DiffToken[];
  accuracy: number; // 0 - 100
  totalRefWords: number;
  matchedWords: number;
}

export function computeRecitationDiff(reference: string, spoken: string): RecitationDiffResult {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, '')
      .trim();

  // Split into words, handling both English spaces and Chinese characters
  const tokenize = (s: string): string[] => {
    const clean = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, ' ');
    const parts = clean.split(/\s+/).filter(Boolean);
    const res: string[] = [];
    for (const p of parts) {
      if (/[\u4e00-\u9fff]/.test(p)) {
        for (const ch of p) res.push(ch);
      } else {
        res.push(p);
      }
    }
    return res;
  };

  const refTokens = tokenize(reference);
  const spokenTokens = tokenize(spoken);

  if (refTokens.length === 0) {
    return { tokens: [], accuracy: 100, totalRefWords: 0, matchedWords: 0 };
  }

  // Simple LCS (Longest Common Subsequence) diff
  const m = refTokens.length;
  const n = spokenTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (norm(refTokens[i - 1]) === norm(spokenTokens[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const diffs: DiffToken[] = [];
  let matched = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && norm(refTokens[i - 1]) === norm(spokenTokens[j - 1])) {
      diffs.unshift({ type: 'correct', word: refTokens[i - 1] });
      matched++;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffs.unshift({ type: 'extra', word: spokenTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffs.unshift({ type: 'missing', word: refTokens[i - 1] });
      i--;
    }
  }

  const accuracy = Math.round((matched / Math.max(1, refTokens.length)) * 100);
  return {
    tokens: diffs,
    accuracy: Math.min(100, Math.max(0, accuracy)),
    totalRefWords: refTokens.length,
    matchedWords: matched,
  };
}
