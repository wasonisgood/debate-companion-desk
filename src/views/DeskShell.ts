import '../styles/desk-shell.css';
import { AppView } from './AppView';
import type { DebatePracticeController } from '../controllers/DebatePracticeController';
import { debateView } from '../web/views/debate/index';

type Mode = 'live' | 'debate';

/**
 * Top-level desktop frame. The left rail switches between the live-support
 * workspace (roadmap, script, question prompter, floating ball) and the moot
 * court practice module. Both panes stay mounted, so switching never drops a
 * running session, speech recognition or timer.
 */
export class DeskShell {
  private root: HTMLElement;
  private controller: DebatePracticeController;
  private mode: Mode = 'live';
  private debateStarted = false;
  private abort = new AbortController();

  constructor(root: HTMLElement, controller: DebatePracticeController) {
    this.root = root;
    this.controller = controller;
    this.render();
    this.bind();
    this.show('live');
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="desk-shell">
        <nav class="desk-rail" aria-label="功能切換">
          <div class="desk-brand" data-drag>
            <span class="desk-seal" aria-hidden="true">辯</span>
            <span class="desk-brand-name">辯論台帳</span>
          </div>
          <button class="desk-rail-item" data-mode="live" type="button">
            <span class="desk-glyph" aria-hidden="true">即</span>
            <span class="desk-rail-label">即時陪練</span>
          </button>
          <button class="desk-rail-item" data-mode="debate" type="button">
            <span class="desk-glyph" aria-hidden="true">練</span>
            <span class="desk-rail-label">模組練習</span>
          </button>
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
          <section id="desk-live" class="desk-pane" aria-label="即時陪練"></section>
          <section id="desk-debate" class="desk-pane" aria-label="模組練習" hidden></section>
        </main>
      </div>`;
    const live = this.root.querySelector<HTMLElement>('#desk-live')!;
    this.liveView = new AppView(live, this.controller);
  }

  private liveView!: AppView;

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => this.show(b.dataset.mode as Mode));
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

  private show(mode: Mode): void {
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const live = this.root.querySelector<HTMLElement>('#desk-live')!;
    const debate = this.root.querySelector<HTMLElement>('#desk-debate')!;
    live.hidden = mode !== 'live';
    debate.hidden = mode !== 'debate';
    if (mode === 'debate' && !this.debateStarted) {
      this.debateStarted = true;
      void debateView(debate, { params: {}, signal: this.abort.signal, url: new URL('desk://debate/') });
    }
  }

  /** Current top-level mode (for tests and the floating-mode layout). */
  public currentMode(): Mode {
    return this.mode;
  }
}
