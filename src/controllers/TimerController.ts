import type { TimerState, MootTimerRule } from '../types';

export type TimerCallback = (state: TimerState) => void;

export class TimerController {
  private totalSeconds: number;
  private warningSeconds: number;
  private elapsedSeconds: number = 0;
  private intervalId: any = null;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private warningFired: boolean = false;
  private finishedFired: boolean = false;
  private subscribers: Set<TimerCallback> = new Set();
  private audioCtx: any = null;

  constructor(rule?: Partial<MootTimerRule>) {
    this.totalSeconds = rule?.totalSeconds ?? (15 * 60); // 15 mins default
    this.warningSeconds = rule?.warningSeconds ?? (2 * 60); // 2 mins warning
  }

  public subscribe(cb: TimerCallback): () => void {
    this.subscribers.add(cb);
    cb(this.getState());
    return () => this.subscribers.delete(cb);
  }

  public getState(): TimerState {
    const remainingSeconds = Math.max(0, this.totalSeconds - this.elapsedSeconds);
    const isOvertime = this.elapsedSeconds > this.totalSeconds;

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      elapsedSeconds: this.elapsedSeconds,
      remainingSeconds,
      totalSeconds: this.totalSeconds,
      isWarningFired: this.warningFired,
      isFinishedFired: this.finishedFired,
      isOvertime
    };
  }

  public start(): void {
    if (this.isRunning && !this.isPaused) return;

    this.isRunning = true;
    this.isPaused = false;

    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
    if (this.intervalId && typeof this.intervalId.unref === 'function') {
      this.intervalId.unref();
    }

    this.notify();
  }

  public pause(): void {
    if (!this.isRunning) return;
    this.isPaused = true;
    if (this.intervalId) clearInterval(this.intervalId);
    this.notify();
  }

  public reset(newTotalSeconds?: number): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.isRunning = false;
    this.isPaused = false;
    this.elapsedSeconds = 0;
    this.warningFired = false;
    this.finishedFired = false;
    if (newTotalSeconds) {
      this.totalSeconds = newTotalSeconds;
    }
    this.notify();
  }

  public tick(): void {
    this.elapsedSeconds += 1;
    const remaining = this.totalSeconds - this.elapsedSeconds;

    // Warning bell (e.g. 2 minutes remaining)
    if (remaining === this.warningSeconds && !this.warningFired) {
      this.warningFired = true;
      this.ringBell(1); // Single warning ring
    }

    // Time's up bell
    if (remaining === 0 && !this.finishedFired) {
      this.finishedFired = true;
      this.ringBell(2); // Double finish ring
    }

    this.notify();
  }

  public ringBell(count: number = 1): void {
    try {
      if (typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          if (!this.audioCtx) {
            this.audioCtx = new AudioContextClass();
          }
          if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
          }

          for (let i = 0; i < count; i++) {
            const delay = i * 0.6;
            this.synthesizeBellChime(this.audioCtx.currentTime + delay);
          }
        }
      }
    } catch (_) {}
  }

  private synthesizeBellChime(startTime: number): void {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;

    // Create realistic bell resonance with fundamental + partials
    const frequencies = [880, 1760, 2640];
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      const amp = 0.25 / (idx + 1);
      gain.gain.setValueAtTime(amp, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2 - idx * 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.3);
    });
  }

  private notify(): void {
    const state = this.getState();
    this.subscribers.forEach(cb => {
      try { cb(state); } catch (_) {}
    });
  }
}
