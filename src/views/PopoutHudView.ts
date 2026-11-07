import type { BenchQuestion } from '../types';
import { Icons } from './icons';

export interface PopoutHudCallbacks {
  onPracticeTTS: (text: string) => void;
  onAskNow: (q: BenchQuestion) => void;
  onGenerateFollowUp: (q: BenchQuestion) => void;
  onDismiss: () => void;
}

export class PopoutHudView {
  private container: HTMLElement;
  private currentQuestion: BenchQuestion | null = null;
  private callbacks: PopoutHudCallbacks;
  private autoHideTimer: any = null;
  private countdownProgress: number = 100;
  private countdownInterval: any = null;
  private timeoutSec: number = 8;
  private isPaused: boolean = false;

  constructor(container: HTMLElement, callbacks: PopoutHudCallbacks, timeoutSec: number = 8) {
    this.container = container;
    this.callbacks = callbacks;
    this.timeoutSec = timeoutSec;
    this.render();
  }

  public show(question: BenchQuestion, rationale: string = '辯士已進入爭點核心主張'): void {
    this.currentQuestion = question;
    this.container.classList.add('visible');
    this.renderContent(rationale);
    this.startCountdown();
  }

  public hide(): void {
    this.clearTimers();
    this.container.classList.remove('visible');
    this.callbacks.onDismiss();
  }

  private render(): void {
    this.container.id = 'popout-hud-container';
    this.container.innerHTML = `
      <div class="hud-progress-bar-track">
        <div class="hud-progress-bar-fill" id="hud-fill"></div>
      </div>
      <div id="hud-inner-content"></div>
    `;

    // Pause on hover or touch
    this.container.addEventListener('mouseenter', () => { this.isPaused = true; });
    this.container.addEventListener('mouseleave', () => { this.isPaused = false; });
    this.container.addEventListener('touchstart', () => { this.isPaused = true; }, { passive: true });
  }

  private renderContent(rationale: string): void {
    const inner = this.container.querySelector('#hud-inner-content');
    if (!inner || !this.currentQuestion) return;

    const q = this.currentQuestion;

    inner.innerHTML = `
      <div class="hud-header">
        <div class="hud-title-wrap">
          <span class="badge badge-shu">
            ${Icons.zap('', 12)}
            <span>即時提問時機點</span>
          </span>
          <span style="font-size: 0.82rem; font-weight: bold; color: var(--ink); font-family: var(--mono);">${q.id}</span>
        </div>
        <button class="hud-dismiss-btn" id="btn-hud-close" title="收起" type="button">
          ${Icons.close('', 14)}
        </button>
      </div>

      <div class="hud-body">
        <div class="hud-rationale">觸發契機：${rationale}</div>
        <div class="hud-question-en">"${q.questionEn}"</div>
        <div class="hud-question-zh">${q.questionZh}</div>
      </div>

      <div class="hud-actions">
        <button class="btn btn-primary btn-touch" id="btn-hud-tts" style="flex: 1;" type="button">
          ${Icons.speaker('', 14)}
          <span>朗讀發音</span>
        </button>
        <button class="btn btn-outline btn-touch" id="btn-hud-followup" title="動態追問" type="button">
          ${Icons.zap('', 14)}
          <span>追問</span>
        </button>
        <button class="btn btn-touch" id="btn-hud-ask" style="background: var(--ainezu); color: #fff;" type="button">
          ${Icons.check('', 14)}
          <span>提問辯士</span>
        </button>
      </div>
    `;

    this.bindActionEvents();
  }

  private bindActionEvents(): void {
    this.container.querySelector('#btn-hud-close')?.addEventListener('click', () => {
      this.hide();
    });

    this.container.querySelector('#btn-hud-tts')?.addEventListener('click', () => {
      if (this.currentQuestion) {
        this.callbacks.onPracticeTTS(this.currentQuestion.questionEn);
      }
    });

    this.container.querySelector('#btn-hud-followup')?.addEventListener('click', () => {
      if (this.currentQuestion) {
        this.callbacks.onGenerateFollowUp(this.currentQuestion);
      }
    });

    this.container.querySelector('#btn-hud-ask')?.addEventListener('click', () => {
      if (this.currentQuestion) {
        this.callbacks.onAskNow(this.currentQuestion);
        this.hide();
      }
    });
  }

  private startCountdown(): void {
    this.clearTimers();
    this.countdownProgress = 100;
    const intervalMs = 50;
    const totalSteps = (this.timeoutSec * 1000) / intervalMs;
    const stepDec = 100 / totalSteps;

    this.countdownInterval = setInterval(() => {
      if (!this.isPaused) {
        this.countdownProgress -= stepDec;
        const fill = this.container.querySelector('#hud-fill') as HTMLElement;
        if (fill) fill.style.width = `${Math.max(0, this.countdownProgress)}%`;

        if (this.countdownProgress <= 0) {
          this.hide();
        }
      }
    }, intervalMs);
  }

  private clearTimers(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }
}
