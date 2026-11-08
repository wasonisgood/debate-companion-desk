import '../styles/desk-shell.css';
import { AppView } from './AppView';
import { DeskOverview, type Destination } from './DeskOverview';
import type { DebatePracticeController } from '../controllers/DebatePracticeController';
import { debateView } from '../web/views/debate/index';

type Pane = 'overview' | 'live' | 'debate';

/** Rail order follows the researcher's workflow, not the order features were built. */
const GROUPS: { label: string; items: { tab?: string; pane?: Pane; name: string; glyph: string }[] }[] = [
  { label: '總覽', items: [{ pane: 'overview', name: '研究台', glyph: '總' }] },
  { label: '開庭', items: [{ pane: 'live', name: '即時陪練', glyph: '即' }] },
  { label: '準備', items: [
    { tab: 'prep', name: '對戰準備', glyph: '備' },
    { tab: 'manage', name: '題庫稿件', glyph: '庫' },
  ] },
  { label: '練習', items: [
    { tab: 'memorize', name: '口說教練', glyph: '說' },
    { tab: 'bench', name: '單題攻防', glyph: '攻' },
    { tab: 'simulation', name: '模擬庭', glyph: '模' },
  ] },
  { label: '檢討', items: [{ tab: 'records', name: '練習紀錄', glyph: '紀' }] },
];

/**
 * Top-level desktop frame, ordered by the researcher's workflow:
 * 總覽 (desk) → 開庭 (live) → 準備 → 練習 → 檢討. All panes stay mounted, so a
 * running session, recognition or timer is not dropped when switching.
 */
export class DeskShell {
  private root: HTMLElement;
  private controller: DebatePracticeController;
  private pane: Pane = 'overview';
  private tab = 'prep';
  private debateStarted = false;
  private abort = new AbortController();
  private overview!: DeskOverview;
  private liveView!: AppView;

  constructor(root: HTMLElement, controller: DebatePracticeController) {
    this.root = root;
    this.controller = controller;
    this.render();
    this.bind();
    this.show('overview');
  }

  private render(): void {
    const groups = GROUPS.map((g) => `
          <div class="desk-rail-group" aria-hidden="true">${g.label}</div>
          ${g.items.map((it) => `
          <button class="desk-rail-item" type="button"
            ${it.pane ? `data-pane="${it.pane}"` : `data-tab="${it.tab}"`}>
            <span class="desk-glyph" aria-hidden="true">${it.glyph}</span>
            <span class="desk-rail-label">${it.name}</span>
          </button>`).join('')}`).join('');

    this.root.innerHTML = `
      <div class="desk-shell">
        <nav class="desk-rail" aria-label="研究流程">
          <div class="desk-brand" data-drag>
            <span class="desk-seal" aria-hidden="true">辯</span>
            <span class="desk-brand-name">辯論台帳</span>
          </div>
          ${groups}
          <div class="desk-rail-spacer" data-drag></div>
          <div class="desk-winctl" role="group" aria-label="視窗">
            <button type="button" data-win="minimize" aria-label="最小化" title="最小化">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6.5h8" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
            <button type="button" data-win="maximize" aria-label="最大化或還原" title="最大化或還原">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
            <button type="button" data-win="close" aria-label="關閉" title="關閉">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
          </div>
        </nav>
        <main class="desk-main">
          <section id="desk-overview" class="desk-pane" aria-label="研究台總覽" hidden></section>
          <section id="desk-live" class="desk-pane" aria-label="即時陪練" hidden></section>
          <section id="desk-debate" class="desk-pane" aria-label="模組練習" hidden></section>
        </main>
      </div>`;

    this.overview = new DeskOverview(
      this.root.querySelector<HTMLElement>('#desk-overview')!,
      this.controller,
      (d) => this.go(d),
    );
    this.liveView = new AppView(this.root.querySelector<HTMLElement>('#desk-live')!, this.controller);
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach((b) => {
      b.addEventListener('click', () => (b.dataset.pane === 'live' ? this.go({ mode: 'live' }) : this.show(b.dataset.pane as Pane)));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => this.go({ mode: 'debate', tab: b.dataset.tab! }));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-win]').forEach((b) => {
      b.addEventListener('click', () => {
        const api = (window as any).electronAPI;
        const act = b.dataset.win;
        if (act === 'minimize') api?.minimize?.();
        else if (act === 'maximize') api?.maximize?.();
        else if (act === 'close') api?.close?.();
      });
    });
  }

  /** Move to a workflow place. Used by the rail, the overview and the live panel. */
  public go(dest: Destination): void {
    if (dest.mode === 'live') this.show('live');
    else this.openDebateTab(dest.tab);
  }

  private show(pane: Pane): void {
    this.pane = pane;
    const panes: Pane[] = ['overview', 'live', 'debate'];
    panes.forEach((p) => {
      const el = this.root.querySelector<HTMLElement>(`#desk-${p}`)!;
      el.hidden = p !== pane;
    });
    if (pane === 'overview') this.overview.render();
    this.markActive();
  }

  private openDebateTab(tab: string): void {
    this.tab = tab;
    const debate = this.root.querySelector<HTMLElement>('#desk-debate')!;
    const wasHidden = debate.hidden;
    this.show('debate');
    if (!this.debateStarted) {
      this.debateStarted = true;
      void debateView(debate, { params: {}, signal: this.abort.signal, url: new URL(`desk://debate/?tab=${tab}`) });
    } else if (wasHidden || this.pane === 'debate') {
      window.dispatchEvent(new CustomEvent('desk:debate-tab', { detail: tab }));
    }
    this.markActive();
  }

  /** Highlight the rail item for the current place. */
  private markActive(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.desk-rail-item').forEach((b) => {
      const on = b.dataset.pane ? b.dataset.pane === this.pane : (this.pane === 'debate' && b.dataset.tab === this.tab);
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  /** Current top-level place (for tests and the floating-mode layout). */
  public currentPane(): Pane {
    return this.pane;
  }
}
