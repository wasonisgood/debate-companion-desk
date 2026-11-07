import type { BenchQuestion } from '../types';
import { Icons } from './icons';

export interface QuestionPrompterCallbacks {
  onPracticeTTS: (text: string) => void;
  onGenerateFollowUp: (q: BenchQuestion) => void;
  onSelectAlternativeQuestion: (qId: string) => void;
}

export class QuestionPrompterView {
  private container: HTMLElement;
  private currentQuestion: BenchQuestion | null = null;
  private allQuestions: BenchQuestion[] = [];
  private callbacks: QuestionPrompterCallbacks;

  constructor(container: HTMLElement, callbacks: QuestionPrompterCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public setQuestions(questions: BenchQuestion[], activeQuestion?: BenchQuestion): void {
    this.allQuestions = questions;
    this.currentQuestion = activeQuestion || questions[0] || null;
    this.render();
  }

  public setRecommendedQuestion(question: BenchQuestion): void {
    this.currentQuestion = question;
    this.render();
  }

  public render(): void {
    if (!this.currentQuestion) {
      this.container.innerHTML = `
        <div class="col-prompter">
          <div class="panel-header">
            <span class="panel-title">
              <span class="panel-icon">${Icons.scales('', 16)}</span>
              <span>提問輔助與追問</span>
            </span>
          </div>
          <div class="panel-body">
            <p style="color: var(--ink-3); font-size: 0.85rem;">暫無關聯問題</p>
          </div>
        </div>
      `;
      return;
    }

    const q = this.currentQuestion;

    this.container.innerHTML = `
      <div class="col-prompter">
        <div class="panel-header">
          <div class="panel-title">
            <span class="panel-icon">${Icons.scales('', 16)}</span>
            <span>提問與追問提示</span>
            <span class="badge badge-shu">${q.id}</span>
          </div>
          <span class="badge badge-ainezu">${q.category}</span>
        </div>

        <div class="panel-body">
          <!-- Question Title & Scope -->
          <div style="font-weight: bold; font-size: 0.95rem; color: var(--ink);">
            ${q.title}
          </div>
          <div style="font-size: 0.78rem; color: var(--ink-3);">
            適合問點：${q.whereZh || q.where}
          </div>

          <!-- English Question Formulation -->
          <div class="card" style="border-left: 3px solid var(--shu); gap: 0.45rem; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.75rem; font-family: var(--mono); color: var(--shu-ink); font-weight: bold;">
                大法官英文提問 (法官原句)
              </span>
              <button class="btn btn-outline" id="btn-prompter-tts" style="min-height: 28px; padding: 0.2rem 0.55rem; font-size: 0.75rem;" type="button">
                ${Icons.speaker('', 13)}
                <span>朗讀練習</span>
              </button>
            </div>
            <div style="font-family: var(--latin); font-size: 0.95rem; line-height: 1.45; color: var(--ink);">
              "${q.questionEn}"
            </div>
            <div style="font-size: 0.8rem; color: var(--ink-2); margin-top: 0.2rem;">
              ${q.questionZh}
            </div>
          </div>

          <!-- AI Follow-up Section -->
          <div class="card" style="border-left: 3px solid var(--ainezu); gap: 0.45rem; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.75rem; font-family: var(--mono); color: var(--ainezu); font-weight: bold;">
                即時追問準備 (Follow-up)
              </span>
              <button class="btn btn-outline" id="btn-prompter-followup" style="min-height: 28px; padding: 0.2rem 0.55rem; font-size: 0.75rem;" type="button">
                ${Icons.zap('', 13)}
                <span>動態追問</span>
              </button>
            </div>
            <div style="font-family: var(--latin); font-size: 0.88rem; color: var(--ink);">
              "${q.followUp || 'Counsel, what is your best authority for that proposition?'}"
            </div>
            <div style="font-size: 0.78rem; color: var(--ink-2);">
              ${q.followUpZh || '若辯士迴避，可直接追問其所依據之習慣國際法權威依據。'}
            </div>
          </div>

          <!-- Legal Structure Checklist -->
          <div class="card" style="gap: 0.4rem; padding: 0.85rem;">
            <span style="font-size: 0.75rem; font-family: var(--mono); color: var(--ink-3); font-weight: bold;">
              提問要件架構審核
            </span>
            <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem; color: var(--ink-2); line-height: 1.55;">
              ${(q.structure || []).map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-prompter-tts')?.addEventListener('click', () => {
      if (this.currentQuestion) {
        this.callbacks.onPracticeTTS(this.currentQuestion.questionEn);
      }
    });

    this.container.querySelector('#btn-prompter-followup')?.addEventListener('click', () => {
      if (this.currentQuestion) {
        this.callbacks.onGenerateFollowUp(this.currentQuestion);
      }
    });
  }
}
