import { Icons } from './icons';
import type { BenchQuestion, OralUnit } from '../types';

export interface FloatingMiniHudCallbacks {
  onExpand: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onToggleTimer: () => void;
  onTagFeedback: () => void;
  onTTSDrill: (text: string) => void;
  onNextQuestion: () => void;
}

export class FloatingMiniHudView {
  private container: HTMLElement;
  private callbacks: FloatingMiniHudCallbacks;
  private currentUnit: OralUnit | null = null;
  private currentQuestion: BenchQuestion | null = null;
  private remainingSec: number = 900;
  private isRunning: boolean = false;
  private isRecording: boolean = false;

  constructor(container: HTMLElement, callbacks: FloatingMiniHudCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public setData(unit: OralUnit | null, question: BenchQuestion | null): void {
    this.currentUnit = unit;
    this.currentQuestion = question;
    this.render();
  }

  public updateTimer(remainingSec: number, isRunning: boolean, isRecording: boolean): void {
    this.remainingSec = remainingSec;
    this.isRunning = isRunning;
    this.isRecording = isRecording;

    const timerEl = this.container.querySelector('#mini-hud-timer');
    if (timerEl) {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    const recDot = this.container.querySelector('#mini-hud-rec-dot') as HTMLElement;
    if (recDot) {
      recDot.style.display = isRecording ? 'inline-block' : 'none';
    }
  }

  public render(): void {
    const mins = Math.floor(this.remainingSec / 60);
    const secs = this.remainingSec % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const unitTitle = this.currentUnit ? `${this.currentUnit.section}` : '模擬庭辯論實況';
    const qText = this.currentQuestion ? this.currentQuestion.questionEn : '點擊右側按鈕隨時發起法官即時提問';
    const qZh = this.currentQuestion ? this.currentQuestion.questionZh : '';

    this.container.innerHTML = `
      <div class="mini-hud-card">
        <!-- Drag Header -->
        <div class="mini-hud-header" style="-webkit-app-region: drag;">
          <div class="mini-hud-title-wrap">
            <span class="app-seal" style="width: 18px; height: 18px; font-size: 0.68rem;">辯</span>
            <span class="mini-hud-title" style="font-size: 0.82rem; font-weight: bold; color: var(--ink);">${unitTitle}</span>
          </div>

          <div class="mini-hud-controls" style="-webkit-app-region: no-drag;">
            <button class="win-control-btn" id="btn-mini-expand" title="展開回主視窗" type="button" style="width: 24px; height: 24px;">
              ${Icons.expand('', 13)}
            </button>
            <button class="win-control-btn" id="btn-mini-min" title="最小化" type="button" style="width: 24px; height: 24px;">
              ${Icons.min('', 13)}
            </button>
            <button class="win-control-btn close" id="btn-mini-close" title="關閉" type="button" style="width: 24px; height: 24px;">
              ${Icons.close('', 13)}
            </button>
          </div>
        </div>

        <!-- Body: Timer & Live Question -->
        <div class="mini-hud-body">
          <div class="mini-hud-status-row">
            <div class="mini-hud-timer-badge" id="btn-mini-timer-toggle" title="點擊暫停或繼續計時">
              ${Icons.timer('', 13)}
              <span id="mini-hud-timer" style="font-family: var(--mono); font-weight: bold;">${timeStr}</span>
              <span id="mini-hud-rec-dot" class="badge-status rec-dot" style="${this.isRecording ? 'display: inline-block;' : 'display: none;'}"></span>
            </div>
            ${this.currentQuestion ? `<span class="badge badge-shu" style="font-size: 0.7rem;">${this.currentQuestion.id}</span>` : ''}
          </div>

          <div class="mini-hud-prompt-box">
            <div class="mini-hud-q-en">"${qText}"</div>
            ${qZh ? `<div class="mini-hud-q-zh">${qZh}</div>` : ''}
          </div>
        </div>

        <!-- Action Toolbar -->
        <div class="mini-hud-actions" style="-webkit-app-region: no-drag;">
          <button class="btn btn-outline" id="btn-mini-tts" type="button" title="發音朗讀">
            ${Icons.speaker('', 14)}
            <span>朗讀練習</span>
          </button>
          <button class="btn btn-outline" id="btn-mini-feedback" type="button" title="標記老師講評段落">
            ${Icons.tag('', 14)}
            <span>標註講評</span>
          </button>
          <button class="btn btn-primary" id="btn-mini-next-q" type="button" title="切換提問">
            ${Icons.zap('', 14)}
            <span>即時提問</span>
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-mini-expand')?.addEventListener('click', () => this.callbacks.onExpand());
    this.container.querySelector('#btn-mini-min')?.addEventListener('click', () => this.callbacks.onMinimize());
    this.container.querySelector('#btn-mini-close')?.addEventListener('click', () => this.callbacks.onClose());

    this.container.querySelector('#btn-mini-timer-toggle')?.addEventListener('click', () => this.callbacks.onToggleTimer());
    this.container.querySelector('#btn-mini-feedback')?.addEventListener('click', () => this.callbacks.onTagFeedback());
    this.container.querySelector('#btn-mini-next-q')?.addEventListener('click', () => this.callbacks.onNextQuestion());

    this.container.querySelector('#btn-mini-tts')?.addEventListener('click', () => {
      const text = this.currentQuestion ? this.currentQuestion.questionEn : (this.currentUnit?.textEn || 'Moot court debate practice.');
      this.callbacks.onTTSDrill(text);
    });
  }
}
