import type { DebatePracticeController } from '../controllers/DebatePracticeController';
import type { MatchPrep, Side } from '../types';
import { pendingCount } from '../web/lib/debateRecords';

/** Where a workflow step leads. */
export type Destination = { mode: 'live' } | { mode: 'debate'; tab: string };

const SIDE_LABEL: Record<Side, string> = { prosecution: '控方（申請方）', defense: '辯方（被申請方）' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

/**
 * 總覽: the researcher's desk. Shows the next match and the five workflow stages
 * (準備 → 口說 → 攻防 → 模擬 → 檢討) with real counts from the shared bank, and
 * a button that opens the place where each stage is worked on.
 */
export class DeskOverview {
  private root: HTMLElement;
  private controller: DebatePracticeController;
  private go: (d: Destination) => void;

  constructor(root: HTMLElement, controller: DebatePracticeController, go: (d: Destination) => void) {
    this.root = root;
    this.controller = controller;
    this.go = go;
  }

  /** Upcoming matches first (by date and time), then the rest. */
  private nextMatch(): MatchPrep | null {
    const today = new Date().toISOString().slice(0, 10);
    const list = [...(this.controller.debateModel.getData().matches ?? [])];
    const key = (m: MatchPrep) => `${m.date || '9999-12-31'} ${m.time || ''}`;
    list.sort((a, b) => key(a).localeCompare(key(b)));
    return list.find((m) => (m.date || '') >= today) ?? list[0] ?? null;
  }

  public render(): void {
    const model = this.controller.debateModel;
    const data = model.getData();
    const match = this.nextMatch();
    const side: Side = match?.ourSide ?? this.controller.contextEngine.getSide();
    const seat = this.controller.contextEngine.getSeat();
    const oral = model.getOralUnitsForSide(side, seat).length;
    const questions = model.getQuestionsForSide(side, seat).length;
    const pending = pendingCount();
    const memorialParas = match?.memorial?.paras.length ?? 0;
    const qaCount = match?.script.qa.length ?? 0;
    const demo = model.isDemo();

    const step = (no: string, name: string, state: string, detail: string, dest: Destination, cta: string) => `
      <li class="ov-step">
        <span class="ov-no">${no}</span>
        <div class="ov-step-body">
          <div class="ov-step-head"><b>${name}</b><span class="ov-state">${esc(state)}</span></div>
          <p class="ov-detail">${esc(detail)}</p>
        </div>
        <button type="button" class="ov-go" data-dest='${esc(JSON.stringify(dest))}'>${esc(cta)}</button>
      </li>`;

    this.root.innerHTML = `
      <div class="ov">
        <header class="ov-head">
          <span class="ov-kicker">研究台總覽</span>
          <h1>${match ? `下一場：第 ${esc(match.round)} 回合` : '尚未排定場次'}</h1>
          <p class="ov-sub">${match
            ? `${esc(match.date)} ${esc(match.time)} · ${esc(match.room)} · 我方 ${esc(match.ourTeam)} 對 ${esc(match.oppTeam)} · ${SIDE_LABEL[side]}`
            : '到「對戰準備」匯入賽程表後，這裡會顯示下一場與各階段進度。'}</p>
          ${demo ? `<p class="ov-banner">目前顯示的是示範案例，尚未取得共用題庫。登入後會自動載入雲端題庫。</p>` : ''}
        </header>

        <section class="ov-section" aria-labelledby="ov-flow">
          <h2 id="ov-flow">研究流程</h2>
          <ol class="ov-steps">
            ${step('1', '準備', match ? (memorialParas ? `已匯入對方書狀（${memorialParas} 段）` : '尚未匯入對方書狀') : '尚無場次',
              match ? (match.assess.priorities.length ? `我方重點 ${match.assess.priorities.length} 條` : '分析對方書狀，列出我方重點與風險') : '先建立場次',
              { mode: 'debate', tab: 'prep' }, '對戰準備')}
            ${step('2', '口說', `${oral} 段口說稿`, '逐段背誦，系統依你的朗讀同步進度與中文摘要', { mode: 'debate', tab: 'memorize' }, '口說教練')}
            ${step('3', '攻防', `${questions} 題法官提問`, '針對對方論點練習追問與答辯，可用 AI 出新題', { mode: 'debate', tab: 'bench' }, '單題攻防')}
            ${step('4', '模擬', qaCount ? `已備 ${qaCount} 條法官問答` : '尚未備妥法官問答', '40 分鐘完整開庭，含計時與法官提問', { mode: 'debate', tab: 'simulation' }, '模擬庭')}
            ${step('5', '檢討', pending ? `${pending} 筆紀錄待同步` : '紀錄已同步', '檢視每次練習的評分、建議與錄音', { mode: 'debate', tab: 'records' }, '練習紀錄')}
          </ol>
        </section>

        <div class="ov-row">
          <section class="ov-section ov-bank" aria-labelledby="ov-bank">
            <h2 id="ov-bank">題庫</h2>
            <dl>
              <dt>來源</dt><dd>${demo ? '示範案例' : '共用題庫（雲端同步）'}</dd>
              <dt>控方題目</dt><dd>${data.prosecutionQuestions.length} 題</dd>
              <dt>辯方題目</dt><dd>${data.defenseQuestions.length} 題</dd>
              <dt>口說稿</dt><dd>控方 ${data.prosecutionOral.length} 段 · 辯方 ${data.defenseOral.length} 段</dd>
            </dl>
          </section>
          <section class="ov-section ov-live" aria-labelledby="ov-live">
            <h2 id="ov-live">開庭</h2>
            <p class="ov-detail">進入開庭時，即時陪練會同步口說進度、提示爭點與提問時機，並自動計時與錄音。</p>
            <button type="button" class="ov-primary" data-dest='${esc(JSON.stringify({ mode: 'live' }))}'>開始開庭</button>
          </section>
        </div>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>('.ov-go, .ov-primary').forEach((b) => {
      b.addEventListener('click', () => {
        const dest = JSON.parse(b.dataset.dest ?? '{}') as Destination;
        this.go(dest);
      });
    });
  }
}
