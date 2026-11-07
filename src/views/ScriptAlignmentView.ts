import type { OralUnit, LiveChineseSummary } from '../types';
import { Icons } from './icons';

export interface ScriptAlignmentCallbacks {
  onInterruptionTriggerClick: () => void;
}

export class ScriptAlignmentView {
  private container: HTMLElement;
  private currentUnit: OralUnit | null = null;
  private matchedWordsCount: number = 0;
  private summaries: LiveChineseSummary[] = [];
  private callbacks: ScriptAlignmentCallbacks;

  constructor(container: HTMLElement, callbacks: ScriptAlignmentCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public setUnit(unit: OralUnit | null): void {
    this.currentUnit = unit;
    this.matchedWordsCount = 0;
    this.render();
  }

  public updateAlignment(matchedCount: number): void {
    this.matchedWordsCount = matchedCount;
    this.renderWords();
  }

  public addSummary(summary: LiveChineseSummary): void {
    this.summaries.push(summary);
    this.renderSummaries();
  }

  public render(): void {
    if (!this.currentUnit) {
      this.container.innerHTML = `
        <div class="col-tracker">
          <div class="card">
            <div class="card-title">口說稿即時對照</div>
            <p style="color: var(--ink-3); font-size: 0.9rem;">尚未選取練習段落</p>
          </div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="col-tracker">
        <!-- Script Alignment Card -->
        <div class="card" style="flex: 1;">
          <div class="card-header">
            <div class="card-title">
              <span class="panel-icon">${Icons.mic('', 16)}</span>
              <span>口說稿即時對照追蹤</span>
              <span class="badge badge-shu">${this.currentUnit.section}</span>
            </div>
            <div class="pills">
              <span class="pill-item active">${this.currentUnit.speaker}</span>
              <span class="pill-item">${this.currentUnit.side === 'prosecution' ? '正方 (申請方)' : '反方 (被申請方)'}</span>
            </div>
          </div>

          <div class="script-viewer" id="script-viewer-text"></div>
        </div>

        <!-- Live Chinese Summary Card -->
        <div class="card" style="height: 240px;">
          <div class="card-header">
            <div class="card-title">
              <span class="panel-icon">${Icons.zap('', 16)}</span>
              <span>隨念隨摘 · 即時中文摘要</span>
              <span class="badge badge-koke" id="summary-counter">${this.summaries.length} 條摘要</span>
            </div>
            <span style="font-size: 0.75rem; color: var(--ink-3);">依即時口說流動生成</span>
          </div>

          <div class="summary-stream" id="summary-stream-list"></div>
        </div>
      </div>
    `;

    this.renderWords();
    this.renderSummaries();
  }

  private renderWords(): void {
    const viewer = this.container.querySelector('#script-viewer-text');
    if (!viewer || !this.currentUnit) return;

    const words = this.currentUnit.textEn.split(/\s+/);
    viewer.innerHTML = words.map((w, idx) => {
      let cls = 'script-word';
      if (idx < this.matchedWordsCount) {
        cls += ' read';
      } else if (idx === this.matchedWordsCount) {
        cls += ' active';
      }

      // Check if word represents key legal point
      const clean = w.toLowerCase().replace(/[^a-z]/g, '');
      if (['article', 'control', 'defence', 'proportionality', 'civilian'].includes(clean)) {
        cls += ' interruption-point';
      }

      return `<span class="${cls}">${w} </span>`;
    }).join('');

    // Auto scroll viewer to active word
    const activeWordEl = viewer.querySelector('.script-word.active');
    if (activeWordEl) {
      activeWordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private renderSummaries(): void {
    const list = this.container.querySelector('#summary-stream-list');
    const counter = this.container.querySelector('#summary-counter');
    if (!list) return;

    if (counter) counter.textContent = `${this.summaries.length} 條摘要`;

    if (this.summaries.length === 0) {
      list.innerHTML = `<p style="font-size: 0.8rem; color: var(--ink-3); padding: 0.5rem;">辯士開始朗讀後，此處將隨時提取關鍵中文脈絡...</p>`;
      return;
    }

    list.innerHTML = this.summaries.map(s => {
      const date = new Date(s.timestamp);
      const timeStr = `${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
      return `
        <div class="summary-bullet">
          <span class="bullet-time">[${timeStr}]</span>
          <span>${s.summaryZh}</span>
        </div>
      `;
    }).join('');

    list.scrollTop = list.scrollHeight;
  }
}
