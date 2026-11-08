/**
 * 40 分鐘模擬庭 Full hearing simulation (hot bench)
 *
 * Built for one or two advocates practising without real judges.
 * The screen carries almost nothing: the bench (default 3 judges, one speaks
 * at a time, with visual lean-in / speaking / note-taking cues because the
 * advocate cannot see real people), a clock with clerk time cards, one line
 * telling the advocate what to do, and an on-demand hint.
 *
 * Everything runs by itself: the bench opens the hearing, the tracker follows
 * the script by voice, judges interrupt at natural pauses (questions linked to
 * where counsel is in the script), the answer ends on a pause, time expiry and
 * handover are automatic, and judge questions count against counsel's time.
 * Every hint (when, how long, what was shown) goes into the final report.
 */

import { html, raw, $ } from '../../lib/dom';
import { loadDebateData } from '../../lib/debateStorage';
import { saveRecord, audioReason, listRecords, type SaveResult } from '../../lib/debateRecords';
import type { BenchQuestion, OralUnit } from '../../lib/debateData';
import { evaluateAnswer, evaluateHearing, getJudgeEngineStatus } from '../../lib/debateJudgeAI';
import { playGavelSound, playChimeSound } from '../../lib/speechAudio';
import {
  SEAT_INFO,
  REBUTTAL_MIN,
  type Seat,
  type Side,
  type Prefs,
  type HearingReport,
  type HintLog,
  type QaLog,
  type PhaseLog,
  type LiveMic,
  type Tok,
  type Anchor,
  ScriptTracker,
  JUDGES,
  OPENERS,
  RESUME_LINES,
  anchorsOf,
  benchHtml,
  cleanScript,
  fmtClock,
  fmtMin,
  hasSpeechRecognition,
  loadHearings,
  loadPrefs,
  oralOf,
  pick,
  questionSeat,
  questionsOf,
  saveHearing,
  savePrefs,
  setAllJudges,
  setJudgeState,
  shortSection,
  speakAs,
  startLiveMic,
  tokenize,
  unitsFor,
} from '../../lib/mootCourt';
import { focusMatch } from '../../lib/matchPrep';
import { generateQuestions, canGenerate } from '../../lib/questionGen';
import { sttNote } from '../../lib/stt';

type Mode = 'seat1' | 'seat2' | 'relay';
type State = 'setup' | 'intro' | 'speech' | 'judge' | 'answer' | 'handover' | 'paused' | 'closing' | 'report';

interface PDef {
  kind: 'seat1' | 'seat2' | 'rebuttal';
  seat: Seat;
  label: string;
  allotted: number;
}

interface PRun {
  def: PDef;
  used: number;
  qaSec: number;
  units: OralUnit[];
  starts: number[]; // token index where each unit starts
  tracker: ScriptTracker | null;
  transcript: string;
  voiced0: number;
  asked: Set<string>;
  nextQAt: number;
  cards: Set<number>;
  expiredAt: number | null;
  hotBench: boolean;
  spoke: boolean;
  anchors: Anchor[]; // ⚖ insertion points in the run's token stream
  anchorDone: Set<number>; // anchor indices the bench has already decided on
  lastQAt: number;
}

const INTERVAL: Record<Prefs['intensity'], number> = { light: 200, standard: 120, hot: 70 };
const FOLLOW_P: Record<Prefs['intensity'], number> = { light: 0.15, standard: 0.35, hot: 0.55 };
/** Chance the bench takes a ⚖ insertion point, and the minimum seconds since the last question. */
const ANCHOR_P: Record<Prefs['intensity'], number> = { light: 0.3, standard: 0.5, hot: 0.75 };
const ANCHOR_GAP: Record<Prefs['intensity'], number> = { light: 90, standard: 50, hot: 25 };
const FOLLOWUPS = [
  'But what is your best authority for that?',
  'How does that square with the facts before this Chamber?',
  'If we disagree with you on that point, where does it leave your case?',
  'Can you point me to the paragraph of the facts you rely on?',
  'Is that a legal test, or your reading of the evidence?',
];
const END_PHRASES = /(return to my|return to the|if that answers|may i (now )?(proceed|continue)|unless (there are|the court has) (any )?further|i will now (turn|return|move))/i;

export default function renderSimulation(container: HTMLElement, signal: AbortSignal) {
  const data = loadDebateData();
  const prefs = loadPrefs();
  let side: Side = prefs.side;
  let mode: Mode = prefs.seat === 2 ? 'seat2' : 'relay';
  let withRebuttal = true;
  let judges = Math.max(1, Math.min(3, prefs.judges || 3));
  let intensity: Prefs['intensity'] = prefs.intensity || 'standard';
  const canHear = hasSpeechRecognition();

  // runtime
  let state: State = 'setup';
  let prevState: State = 'speech';
  let plan: PDef[] = [];
  let runs: PRun[] = [];
  let pi = 0;
  let elapsed = 0;
  let total = 0;
  let last = 0;
  let timer: number | undefined;
  let mic: LiveMic | null = null;
  let cancelTTS: (() => void) | null = null;
  let room: HTMLElement | null = null;
  let qa: QaLog[] = [];
  let hints: HintLog[] = [];
  let timeline: HearingReport['timeline'] = [];
  let curQ: { rec: QaLog; q: BenchQuestion | null; ansStart: number } | null = null;
  let resumeCheck: { rec: QaLog; pos: number; text: string } | null = null;
  let hintOpen: HintLog | null = null;
  let handoverAt = 0;
  let pauses = 0;
  let longSilences = 0;
  let silenceFlag = false;
  let ambientAt = 0;
  let report: HearingReport | null = null;
  let scoring = '';
  let clockOn = false;
  let saved: SaveResult | null = null;
  let cloudPast: HearingReport[] | null = null;
  let overall = '';

  /* ================================================================ setup */

  function buildPlan(): PDef[] {
    const p: PDef[] = [];
    const seatDef = (s: Seat): PDef => ({ kind: s === 1 ? 'seat1' : 'seat2', seat: s, label: `${SEAT_INFO[s].zh} · ${SEAT_INFO[s].en}`, allotted: SEAT_INFO[s].minutes * 60 });
    if (mode === 'relay' || mode === 'seat1') p.push(seatDef(1));
    if (mode === 'relay' || mode === 'seat2') p.push(seatDef(2));
    if (withRebuttal)
      p.push({
        kind: 'rebuttal',
        seat: mode === 'seat2' ? 2 : 1,
        label: side === 'prosecution' ? '反駁 · Rebuttal' : '再反駁 · Sur-rebuttal',
        allotted: REBUTTAL_MIN * 60,
      });
    return p;
  }

  function renderSetup() {
    if (signal.aborted) return;
    plan = buildPlan();
    const tot = plan.reduce((a, x) => a + x.allotted, 0);
    const past = pastHearings();
    if (cloudPast === null) {
      cloudPast = [];
      listRecords({ kind: 'hearing', limit: 30 })
        .then((rows) => {
          cloudPast = rows.map((r) => (r.detail as any)?.report).filter(Boolean) as HearingReport[];
          if (state === 'setup') renderSetup();
        })
        .catch(() => {});
    }
    container.innerHTML = html`
      <div class="hear-setup">
        <section class="hear-card">
          <h2>開庭設定</h2>
          <p class="dim">模擬法官在場的完整出庭。法官可隨時打斷追問，問答時間計入發言時間。畫面只會留下法官席、時鐘與一行指示；需要時再叫出提示，提示的使用會寫進庭後報告。</p>

          <div class="hear-row"><span>代表</span>
            <div class="seg">
              <button class="${side === 'prosecution' ? 'on' : ''}" data-side="prosecution">控方 Prosecution</button>
              <button class="${side === 'defense' ? 'on' : ''}" data-side="defense">辯方 Defense</button>
            </div></div>

          <div class="hear-row"><span>出庭辯士</span>
            <div class="seg">
              <button class="${mode === 'seat1' ? 'on' : ''}" data-mode="seat1">只練第一辯士 20′</button>
              <button class="${mode === 'seat2' ? 'on' : ''}" data-mode="seat2">只練第二辯士 17′</button>
              <button class="${mode === 'relay' ? 'on' : ''}" data-mode="relay">兩人接力</button>
            </div></div>

          <div class="hear-row"><span>反駁</span>
            <div class="seg">
              <button class="${withRebuttal ? 'on' : ''}" data-reb="1">保留 3′</button>
              <button class="${!withRebuttal ? 'on' : ''}" data-reb="0">不練</button>
            </div></div>

          <div class="hear-row"><span>法官</span>
            <div class="seg">${[1, 2, 3].map((n) => raw(html`<button class="${judges === n ? 'on' : ''}" data-judges="${n}">${n} 位</button>`))}</div></div>

          <div class="hear-row"><span>提問強度</span>
            <div class="seg">
              <button class="${intensity === 'light' ? 'on' : ''}" data-int="light">溫和</button>
              <button class="${intensity === 'standard' ? 'on' : ''}" data-int="standard">標準</button>
              <button class="${intensity === 'hot' ? 'on' : ''}" data-int="hot">Hot bench</button>
            </div></div>

          <ol class="hear-plan">
            ${plan.map((p) => raw(html`<li style="flex:${p.allotted}"><b>${p.label}</b><span>${p.allotted / 60} 分鐘</span></li>`))}
          </ol>
          <p class="mono dim">合計 ${tot / 60} 分鐘${mode === 'relay' ? ' · 第一辯士講完會自動交棒，第二辯士開口即開始計時' : ''}</p>

          <button class="btn primary hear-go" id="hear-go" ${canHear ? '' : 'disabled'}>開庭</button>
          ${!canHear || sttNote() ? raw(html`<p class="mono" style="color:var(--shu)">${sttNote() || '此瀏覽器無法使用麥克風。'}</p>`) : ''}
          <p class="mono dim hear-keys">開庭後：Esc 暫停（休庭）· H 按住看提示 · 其餘全自動</p>
        </section>

        ${past.length
          ? raw(html`
          <section class="hear-card">
            <h3>過去的庭期</h3>
            <ul class="hear-past">
              ${past.map((r) =>
                raw(html`<li><button class="linkish" data-report="${r.id}">${new Date(r.ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</button>
                  <span>${r.side === 'prosecution' ? '控方' : '辯方'} · ${modeLabel(r.mode)} · ${fmtClock(r.elapsed)} · 提問 ${r.qa.length} · 提示 ${r.hints.length} 次</span></li>`),
              )}
            </ul>
          </section>`)
          : ''}
      </div>
    `;
    const on = (sel: string, fn: (b: HTMLElement) => void) =>
      container.querySelectorAll<HTMLElement>(sel).forEach((b) => b.addEventListener('click', () => (fn(b), renderSetup())));
    on('[data-side]', (b) => savePrefs({ side: (side = b.dataset.side as Side) }));
    on('[data-mode]', (b) => {
      mode = b.dataset.mode as Mode;
      if (mode !== 'relay') savePrefs({ seat: mode === 'seat2' ? 2 : 1 });
    });
    on('[data-reb]', (b) => (withRebuttal = b.dataset.reb === '1'));
    on('[data-judges]', (b) => savePrefs({ judges: (judges = Number(b.dataset.judges)) }));
    on('[data-int]', (b) => savePrefs({ intensity: (intensity = b.dataset.int as Prefs['intensity']) }));
    $('#hear-go', container)?.addEventListener('click', () => void openCourt());
    container.querySelectorAll<HTMLElement>('[data-report]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = pastHearings().find((x) => x.id === b.dataset.report);
        if (r) {
          report = r;
          state = 'report';
          renderReport();
        }
      }),
    );
  }

  /** Cloud reports first, then any that exist only on this device. */
  function pastHearings(): HearingReport[] {
    const seen = new Set<string>();
    return [...(cloudPast ?? []), ...loadHearings()]
      .filter((r) => !seen.has(r.id) && (seen.add(r.id), true))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20);
  }

  function modeLabel(m: Mode) {
    return m === 'relay' ? '兩人接力' : m === 'seat1' ? '第一辯士' : '第二辯士';
  }

  /* ================================================================ hearing */

  function makeRun(def: PDef): PRun {
    const units = def.kind === 'rebuttal' ? [] : unitsFor(data, side, def.seat);
    const starts: number[] = [];
    const toks: Tok[] = [];
    const anchors: Anchor[] = [];
    for (const u of units) {
      starts.push(toks.length);
      anchors.push(...anchorsOf(u.textEn, toks.length));
      toks.push(...tokenize(u.textEn));
    }
    return {
      def,
      used: 0,
      qaSec: 0,
      units,
      starts,
      tracker: units.length ? new ScriptTracker(toks) : null,
      transcript: '',
      voiced0: 0,
      asked: new Set(),
      nextQAt: def.kind === 'rebuttal' ? (intensity === 'hot' ? 70 : 1e9) : 55 + Math.random() * 40,
      cards: new Set(),
      expiredAt: null,
      hotBench: false,
      spoke: false,
      anchors,
      anchorDone: new Set(),
      lastQAt: -1e9,
    };
  }

  async function openCourt() {
    plan = buildPlan();
    runs = plan.map(makeRun);
    total = plan.reduce((a, x) => a + x.allotted, 0);
    pi = 0;
    elapsed = 0;
    clockOn = false;
    qa = [];
    hints = [];
    timeline = [];
    pauses = longSilences = 0;
    report = null;
    try {
      mic = await startLiveMic({ onFinal, onInterim });
    } catch {
      alert('無法使用麥克風，請允許瀏覽器存取。');
      return;
    }
    mic.setMuted(true);
    mic.startRecording();
    saved = null;
    overall = '';
    buildRoom();
    state = 'intro';
    last = performance.now();
    timer = window.setInterval(tick, 200);
    playGavelSound();
    const who = side === 'prosecution' ? 'the Prosecution' : 'the Defence';
    setTimeout(() => {
      judgeSay(0, `The Court is now in session. Counsel for ${who}, you may begin when ready.`, () => startPhase());
    }, 600);
  }

  function buildRoom() {
    room?.remove();
    room = document.createElement('div');
    room.className = 'moot-room';
    room.innerHTML = html`
      <header class="moot-hud">
        <span class="mono" id="hud-phase"></span>
        <span class="moot-clock" id="hud-clock">00:00</span>
        <span class="mono dim" id="hud-total"></span>
      </header>
      <div class="moot-card" id="time-card" hidden></div>
      ${raw(benchHtml(judges))}
      <p class="moot-caption" id="caption"></p>
      <div class="moot-centre">
        <p class="moot-prompt" id="prompt"></p>
        <div class="moot-points" id="points" hidden></div>
      </div>
      <aside class="moot-hint" id="hint" hidden></aside>
      <footer class="moot-foot">
        <span class="moot-level"><i id="lvl"></i></span>
        <span class="mono dim" id="where"></span>
        <span class="moot-foot-btns">
          <button class="linkish" id="hint-btn">提示 H</button>
          <button class="linkish" id="pause-btn">休庭 Esc</button>
          <button class="linkish" id="end-btn">結束</button>
        </span>
      </footer>
    `;
    document.body.appendChild(room);
    document.body.classList.add('moot-lock');
    $('#hint-btn', room)!.addEventListener('click', () => (hintOpen ? hintEnd() : hintStart()));
    $('#pause-btn', room)!.addEventListener('click', togglePause);
    $('#end-btn', room)!.addEventListener('click', () => void closeCourt(true));
    setAllJudges(room, 'listening');
  }

  function cur(): PRun {
    return runs[pi];
  }

  function startPhase() {
    const r = cur();
    state = 'speech';
    clockOn = true;
    r.voiced0 = mic?.voicedSec() ?? 0;
    mic?.setMuted(false);
    setPrompt(openingPrompt(r));
    setCaption('');
    showPoints(r.def.kind === 'rebuttal');
    updateHud();
  }

  function openingPrompt(r: PRun): string {
    if (r.def.kind === 'rebuttal') return '反駁：只挑對造最致命的一兩點回應，最後重申請求。';
    const first = r.units[0] ? cleanScript(r.units[0].textEn).split(/\s+/).slice(0, 5).join(' ') : 'May it please the Court';
    return `${SEAT_INFO[r.def.seat].zh}請開始陳述 — “${first} …”`;
  }

  function showPoints(on: boolean) {
    const el = $('#points', room!);
    if (!el) return;
    el.hidden = !on;
    if (!on) return;
    const opp = oralOf(data, side === 'prosecution' ? 'defense' : 'prosecution');
    const seen = new Set<string>();
    const pts: string[] = [];
    for (const u of opp) {
      if (seen.has(u.section) || !/【重點】/.test(u.notesZh)) continue;
      seen.add(u.section);
      pts.push(`${shortSection(u.section)}：${u.notesZh.split(/【重點】/)[1]?.split(/[。\n【]/)[0] ?? ''}`);
    }
    const chosen = pts.sort(() => Math.random() - 0.5).slice(0, 3);
    el.innerHTML = html`<span class="mono dim">對造在庭上的主張（模擬）</span><ul>${chosen.map((p) => raw(html`<li>${p}</li>`))}</ul>`;
  }

  /* ---------------------------------------------------------------- speech input */

  function onInterim(t: string) {
    if (state === 'answer') {
      const el = $('#prompt', room!);
      if (el && t) el.dataset.live = t;
    }
  }

  function onFinal(t: string) {
    const r = cur();
    if (!r) return;
    if (state === 'speech') {
      if (!r.spoke) setPrompt(r.def.kind === 'rebuttal' ? '反駁中' : '陳述中');
      r.spoke = true;
      r.transcript += ' ' + t;
      if (resumeCheck && r.tracker) {
        resumeCheck.text += ' ' + t;
        if (resumeCheck.text.trim().split(/\s+/).length >= 5) {
          const p = r.tracker.peek(resumeCheck.text);
          const b = resumeCheck.pos;
          resumeCheck.rec.resumed = p >= b - 3 && p <= b + 12 ? 'ok' : p > b + 12 ? 'skipped' : 'repeated';
          resumeCheck = null;
        }
      }
      r.tracker?.feedText(t);
      updateWhere();
    } else if (state === 'answer' && curQ) {
      curQ.rec.answer = (curQ.rec.answer + ' ' + t).trim();
    } else if (state === 'handover') {
      startHandedPhase();
      r.transcript += ' ' + t;
      r.tracker?.feedText(t);
    }
  }

  /* ---------------------------------------------------------------- clock */

  function tick() {
    if (signal.aborted) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const lvl = $('#lvl', room ?? document);
    if (lvl) lvl.style.width = `${Math.round((mic?.level() ?? 0) * 100)}%`;

    if (state === 'handover') {
      if (mic?.speaking() || (now - handoverAt) / 1000 > 15) startHandedPhase();
      return;
    }
    if (!clockOn || state === 'setup' || state === 'paused' || state === 'report' || state === 'closing' || state === 'intro') return;
    const r = cur();
    elapsed += dt;
    r.used += dt;
    if (state === 'judge' || state === 'answer') r.qaSec += dt;
    updateHud();
    timeCards(r);
    ambient(now);
    if (state === 'speech') onSpeechTick(r);
    else if (state === 'answer') onAnswerTick();
  }

  function remaining(r: PRun) {
    return r.def.allotted - r.used;
  }

  function updateHud() {
    if (!room) return;
    const r = cur();
    const rem = remaining(r);
    const c = $('#hud-clock', room)!;
    c.textContent = fmtClock(rem);
    c.classList.toggle('low', rem < 120);
    c.classList.toggle('over', rem < 0);
    $('#hud-phase', room)!.textContent = r.def.label;
    $('#hud-total', room)!.textContent = `全場 ${fmtClock(elapsed)} / ${fmtClock(total)}`;
  }

  function timeCards(r: PRun) {
    const rem = remaining(r);
    for (const mark of [300, 120, 60, 0]) {
      if (mark >= r.def.allotted) continue;
      if (rem <= mark && !r.cards.has(mark)) {
        r.cards.add(mark);
        const el = $('#time-card', room!)!;
        el.textContent = mark === 0 ? 'STOP' : `${mark / 60}`;
        el.dataset.level = mark === 0 ? 'stop' : mark <= 60 ? 'red' : mark <= 120 ? 'amber' : 'green';
        el.hidden = false;
        playChimeSound();
        setTimeout(() => el && mark !== 0 && (el.hidden = true), 6000);
      }
    }
  }

  function ambient(now: number) {
    if (!room || state !== 'speech' || now < ambientAt) return;
    ambientAt = now + 9000 + Math.random() * 14000;
    const idx = Math.floor(Math.random() * judges);
    setJudgeState(room, idx, 'writing');
    setTimeout(() => state === 'speech' && room && setJudgeState(room, idx, 'listening'), 3500);
  }

  function onSpeechTick(r: PRun) {
    const sil = mic?.silenceMs() ?? 0;
    const rem = remaining(r);
    const t = r.tracker;

    // long silence prompt
    if (r.spoke && sil > 6000) {
      if (!silenceFlag) {
        silenceFlag = true;
        longSilences++;
        setPrompt(`請繼續陳述${whereLabel() ? ` — 你停在〈${whereLabel()}〉` : ''}。卡住可按 H 看提示。`);
      }
    } else if (silenceFlag && sil < 500) {
      silenceFlag = false;
      setPrompt(r.def.kind === 'rebuttal' ? '反駁中' : '陳述中');
    }

    // time expiry
    if (rem <= 0 && r.expiredAt === null) {
      r.expiredAt = r.used;
      judgeSay(0, 'Counsel, your time has expired. Please conclude briefly.', () => backToSpeech('時間到 — 用一句話收尾，請求法庭。'));
      return;
    }
    if (r.expiredAt !== null && (r.used - r.expiredAt > 35 || (r.used - r.expiredAt > 6 && sil > 2500))) return endPhase();

    // rebuttal ends on its own
    if (r.def.kind === 'rebuttal' && r.spoke && r.used > 30 && sil > 5000) return endPhase();

    // script finished early -> hot bench uses remaining time
    if (t && !r.hotBench && t.pos >= t.toks.length - 3 && sil > 2500) {
      if (rem > 45) {
        r.hotBench = true;
        judgeSay(0, 'Thank you, counsel. You still have some time remaining, and the bench has some questions.', () => askQuestion(false));
      } else endPhase();
      return;
    }
    if (r.hotBench && rem < 25) {
      judgeSay(0, 'Thank you, counsel. Your time is up.', () => endPhase());
      return;
    }

    if (rem < 45 || r.expiredAt !== null) return;
    const naturalPause = sil > 350 && sil < 1600;

    // ⚖ marked insertion point: counsel has just reached it and paused
    if (t && r.spoke && naturalPause) {
      const q = anchorQuestion(r, t);
      if (q) return askQuestion(false, undefined, q);
    }

    // free question when the bench has been quiet for a while
    const due = r.used >= r.nextQAt;
    const overdue = r.used > r.nextQAt + 25;
    if (r.spoke && due && (naturalPause || overdue)) askQuestion(false);
  }

  /** Decide once per reached insertion point whether the bench cuts in there. */
  function anchorQuestion(r: PRun, t: ScriptTracker): BenchQuestion | null {
    const pool = questionsOf(data, side);
    const askedAll = new Set(qa.map((x) => x.qid));
    const len = t.toks.length;
    const lim = t.pos >= len - 2 ? len : t.pos; // a point at the very end counts once the last words are said
    const reached = r.anchors.map((a, i) => ({ a, i })).filter(({ a, i }) => !r.anchorDone.has(i) && a.at <= lim);
    if (!reached.length) return null;
    // the point counsel is at now; anything well behind was skipped past
    const here = reached.filter(({ a }) => lim - a.at <= 25);
    reached.forEach(({ i }) => r.anchorDone.add(i));
    if (!here.length) return null;
    const at = here[here.length - 1].a.at;
    const cands = here
      .filter(({ a }) => a.at === at && !askedAll.has(a.qid))
      .map(({ a }) => pool.find((q) => q.id === a.qid))
      .filter(Boolean) as BenchQuestion[];
    if (!cands.length || r.used - r.lastQAt < ANCHOR_GAP[intensity]) return null;
    return Math.random() < ANCHOR_P[intensity] ? pick(cands)! : null;
  }

  function unitAt(r: PRun): number {
    if (!r.tracker) return -1;
    const p = Math.max(0, r.tracker.pos - 1);
    let i = 0;
    while (i + 1 < r.starts.length && r.starts[i + 1] <= p) i++;
    return i;
  }

  function whereLabel(): string {
    const r = cur();
    const ui = unitAt(r);
    return ui >= 0 && r.units[ui] ? shortSection(r.units[ui].section) : '';
  }

  function updateWhere() {
    const el = $('#where', room ?? document);
    if (!el) return;
    const r = cur();
    el.textContent = r.tracker ? `${whereLabel()} · 主稿 ${Math.round((r.tracker.maxPos / r.tracker.toks.length) * 100)}%` : '';
  }

  /* ---------------------------------------------------------------- judges */

  function judgeSay(idx: number, text: string, after: () => void, caption = true) {
    if (!room) return;
    prevState = state === 'judge' ? prevState : state;
    state = 'judge';
    mic?.setMuted(true);
    setAllJudges(room, 'listening');
    setJudgeState(room, idx, 'lean');
    if (caption) setCaption(text, idx);
    setTimeout(() => {
      if (signal.aborted || !room) return;
      setJudgeState(room, idx, 'speaking');
      cancelTTS = speakAs(text, idx, () => {
        cancelTTS = null;
        if (signal.aborted || !room) return;
        setJudgeState(room, idx, 'listening');
        after();
      });
    }, 650);
  }

  const topping = new Set<string>();
  function chooseQuestion(r: PRun): BenchQuestion | null {
    const pool = questionsOf(data, side);
    const all = unitsFor(data, side);
    const askedAll = new Set(qa.map((x) => x.qid));
    const fresh = pool.filter((q) => !askedAll.has(q.id));
    const seatPool = fresh.filter((q) => {
      const s = questionSeat(q, all);
      return r.def.kind === 'rebuttal' ? true : s === r.def.seat;
    });
    // prefer questions whose ⚖ point counsel has already passed; never ask ahead of the argument
    const pos = r.tracker?.maxPos ?? 0;
    const behindIds = new Set(r.anchors.filter((a) => a.at <= pos).map((a) => a.qid));
    const aheadIds = new Set(r.anchors.filter((a) => a.at > pos).map((a) => a.qid));
    const behind = seatPool.filter((q) => behindIds.has(q.id));
    const unanchored = seatPool.filter((q) => !aheadIds.has(q.id));
    // the bank is running dry for this counsel: have the AI write new ones in the background
    const key = `${side}:${r.def.kind === 'rebuttal' ? 0 : r.def.seat}`;
    if (seatPool.length < 3 && canGenerate() && !topping.has(key)) {
      topping.add(key);
      generateQuestions(side, r.def.kind === 'rebuttal' ? 0 : r.def.seat, 5, data).catch(() => topping.delete(key));
    }
    // drill focus from 對戰準備: this opponent's likely questions come up more often
    const fmid = focusMatch(data, side)?.id;
    const forMatch = fmid ? fresh.filter((q) => q.match === fmid && !aheadIds.has(q.id) && (r.def.kind === 'rebuttal' || [0, r.def.seat].includes(questionSeat(q, all)))) : [];
    if (forMatch.length && Math.random() < 0.6) return pick(forMatch)!;
    return pick(behind) ?? pick(unanchored) ?? (r.hotBench ? pick(seatPool) : null) ?? null;
  }

  function askQuestion(followUp: boolean, prev?: QaLog, anchored?: BenchQuestion) {
    const r = cur();
    let q: BenchQuestion | null = null;
    let text: string;
    let judge: number;
    if (followUp && prev) {
      judge = prev.judge;
      text = pick(FOLLOWUPS)!;
      q = curQ?.q ?? null;
    } else {
      q = anchored ?? chooseQuestion(r);
      if (!q) {
        r.nextQAt = r.used + INTERVAL[intensity];
        return;
      }
      r.asked.add(q.id);
      r.lastQAt = r.used;
      judge = qa.length === 0 ? 0 : Math.floor(Math.random() * judges);
      const short = q.simplified && intensity !== 'hot' && Math.random() < 0.4 ? q.simplified : q.questionEn;
      text = `${r.hotBench ? '' : pick(OPENERS) + ' '}${short}`;
    }
    const ui = unitAt(r);
    const rec: QaLog = {
      at: elapsed,
      phase: pi,
      judge,
      qid: q?.id ?? '',
      question: text,
      followUp,
      answer: '',
      answerSec: 0,
      askSec: 0,
      unitId: ui >= 0 ? r.units[ui]?.id ?? '' : '',
      resumed: 'n/a',
      anchored: !!anchored,
    };
    qa.push(rec);
    curQ = { rec, q, ansStart: 0 };
    resumeCheck = null;
    const t0 = elapsed;
    judgeSay(judge, text, () => {
      rec.askSec = elapsed - t0;
      state = 'answer';
      curQ!.ansStart = elapsed;
      mic?.setMuted(false);
      setPrompt('回答法官 — 先表態，再給理由。答完停兩秒，法官會讓你繼續。');
    });
  }

  function onAnswerTick() {
    if (!curQ) return;
    const sec = elapsed - curQ.ansStart;
    const sil = mic?.silenceMs() ?? 0;
    const a = curQ.rec.answer;
    const el = $('#prompt', room!);
    if (el && el.dataset.live) {
      el.textContent = `回答中 ${fmtClock(sec)} · ${(a + ' ' + el.dataset.live).trim().split(/\s+/).slice(-14).join(' ')}`;
    }
    if ((a && sec > 3 && sil > 2300) || sec > 100 || (a && END_PHRASES.test(a) && sil > 800) || (!a && sec > 20)) endAnswer();
  }

  function endAnswer() {
    if (!curQ) return;
    const r = cur();
    const rec = curQ.rec;
    rec.answerSec = elapsed - curQ.ansStart;
    timeline.push({ at: rec.at, dur: rec.askSec + rec.answerSec, type: 'qa', phase: pi });
    const el = $('#prompt', room!);
    if (el) delete el.dataset.live;
    if (hintOpen && hintOpen.kind === 'answer') hintEnd();

    if (!rec.followUp && rec.answer && Math.random() < FOLLOW_P[intensity] && remaining(r) > 50) {
      askQuestion(true, rec);
      return;
    }
    r.nextQAt = r.used + INTERVAL[intensity] * (0.6 + Math.random() * 0.8);
    const base = qa.filter((x) => !x.followUp).pop() ?? rec;
    if (r.hotBench) {
      curQ = null;
      if (remaining(r) < 25) return judgeSay(0, 'Thank you, counsel.', () => endPhase());
      state = 'speech';
      setTimeout(() => state === 'speech' && cur() === r && askQuestion(false), 1800);
      return;
    }
    curQ = null;
    const after = () => {
      if (r.tracker) {
        resumeCheck = { rec: base, pos: r.tracker.pos, text: '' };
        base.resumed = 'skipped';
      }
      backToSpeech(`接回主稿 — 你被打斷在〈${whereLabel()}〉。`);
    };
    if (Math.random() < 0.6) judgeSay(rec.judge, pick(RESUME_LINES)!, after);
    else after();
  }

  function backToSpeech(prompt: string) {
    state = 'speech';
    mic?.setMuted(false);
    setPrompt(prompt);
    setTimeout(() => state === 'speech' && setCaption(''), 2500);
  }

  /* ---------------------------------------------------------------- phases */

  function endPhase() {
    const r = cur();
    if (hintOpen) hintEnd();
    curQ = null;
    resumeCheck = null;
    clockOn = false;
    $('#time-card', room!)!.hidden = true;
    if (pi + 1 >= runs.length) {
      judgeSay(0, 'Thank you, counsel. The Court will now rise.', () => void closeCourt(false));
      return;
    }
    const next = runs[pi + 1];
    const handover = next.def.kind === 'seat2' && r.def.kind === 'seat1';
    const line =
      next.def.kind === 'rebuttal'
        ? `Thank you. Counsel, you have reserved three minutes for ${side === 'prosecution' ? 'rebuttal' : 'sur-rebuttal'}.`
        : 'Thank you, counsel. The Court will now hear from your co-counsel.';
    judgeSay(0, line, () => {
      pi++;
      if (handover) {
        state = 'handover';
        handoverAt = performance.now();
        mic?.setMuted(false);
        setPrompt('交棒 — 第二辯士請就位。開口說 “May it please the Court” 即開始計時。');
        updateHud();
      } else startPhase();
    });
  }

  function startHandedPhase() {
    if (state !== 'handover') return;
    startPhase();
    cur().spoke = true;
  }

  function togglePause() {
    if (!room) return;
    if (state === 'paused') {
      state = prevState;
      last = performance.now();
      mic?.setMuted(state === 'judge');
      room.classList.remove('paused');
      setPrompt('繼續開庭');
      return;
    }
    if (state === 'report' || state === 'closing' || state === 'setup') return;
    if (state === 'judge') return; // let the judge finish
    prevState = state;
    state = 'paused';
    pauses++;
    mic?.setMuted(true);
    room.classList.add('paused');
    setPrompt('休庭中 — Esc 繼續，或按「結束」直接看報告。');
  }

  /* ---------------------------------------------------------------- hints */

  function hintStart() {
    if (!room || hintOpen || !['speech', 'answer', 'judge'].includes(state)) return;
    const r = cur();
    let kind: HintLog['kind'] = 'script';
    let ref = '';
    let label = '';
    let shown = '';
    let bodyHtml = '';
    if ((state === 'answer' || state === 'judge') && curQ?.q) {
      const q = curQ.q;
      kind = 'answer';
      ref = q.id;
      label = q.title.replace(/^(\S+)\s+\1\s+/, '$1 ');
      const struct = q.structure.filter((s) => !/[一-鿿]/.test(s));
      shown = `${q.questionZh} | ${struct.join(' / ')}`;
      bodyHtml = html`<span class="mono dim">${q.id} 回答架構</span><p>${q.questionZh}</p><ol>${struct.map((s) => raw(html`<li>${s}</li>`))}</ol>`;
    } else if (r.tracker) {
      const t = r.tracker;
      const ui = unitAt(r);
      const words = t.toks.slice(t.pos, t.pos + 40).map((x) => x.raw);
      const cut = words.join(' ').match(/^(.*?[.?!])\s(.*?[.?!])?/);
      shown = cut ? `${cut[1]} ${cut[2] ?? ''}`.trim() : words.join(' ');
      ref = r.units[ui]?.id ?? '';
      label = whereLabel();
      bodyHtml = html`<span class="mono dim">接下來 · ${label}</span><p class="moot-hint-en">${shown}</p>`;
    } else {
      const own = oralOf(data, side).filter((u) => /^Prayer/.test(u.section) || /respectfully (requests|submits)/i.test(u.textEn));
      shown = own.length ? cleanScript(own[own.length - 1].textEn) : 'Restate the relief sought.';
      label = '結論請求';
      bodyHtml = html`<span class="mono dim">收尾請求</span><p class="moot-hint-en">${shown}</p>`;
    }
    hintOpen = { at: elapsed, dur: 0, phase: pi, kind, ref, label, shown: shown.slice(0, 400) };
    const el = $('#hint', room)!;
    el.innerHTML = bodyHtml;
    el.hidden = false;
    $('#hint-btn', room)!.classList.add('on');
  }

  function hintEnd() {
    if (!hintOpen || !room) return;
    hintOpen.dur = Math.max(0.3, elapsed - hintOpen.at);
    hints.push(hintOpen);
    timeline.push({ at: hintOpen.at, dur: hintOpen.dur, type: 'hint', phase: hintOpen.phase });
    hintOpen = null;
    $('#hint', room)!.hidden = true;
    $('#hint-btn', room)!.classList.remove('on');
  }

  /* ---------------------------------------------------------------- ui bits */

  function setPrompt(t: string) {
    const el = room && $('#prompt', room);
    if (el) el.textContent = t;
  }
  function setCaption(t: string, judge = 0) {
    const el = room && $('#caption', room);
    if (!el) return;
    el.innerHTML = t ? html`<span class="mono">${JUDGES[judge].zh}</span> ${t}` : '';
  }

  /* ================================================================ report */

  const scoreAbort = new AbortController();
  async function closeCourt(early: boolean) {
    if (state === 'closing' || state === 'report') return;
    if (hintOpen) hintEnd();
    state = 'closing';
    cancelTTS?.();
    if (timer) clearInterval(timer);
    timer = undefined;
    const voicedEnd = mic?.voicedSec() ?? 0;
    const blobP = mic?.stopRecording() ?? Promise.resolve(null);
    mic?.stop();
    mic = null;
    if (!early) playGavelSound();
    teardownRoom();

    const phases: PhaseLog[] = runs.map((r, i) => {
      const t = r.tracker;
      const nextVoiced = i === pi ? voicedEnd : r.voiced0;
      const skipped = new Set<string>();
      const notReached = new Set<string>();
      if (t) {
        r.units.forEach((u, ui) => {
          const from = r.starts[ui];
          const to = r.starts[ui + 1] ?? t.toks.length;
          if (to - from < 6) return;
          if (from >= t.maxPos) notReached.add(shortSection(u.section));
          else if (t.coverage(from, to) < 0.25) skipped.add(shortSection(u.section));
        });
      }
      const words = r.transcript.trim() ? r.transcript.trim().split(/\s+/).length : 0;
      return {
        kind: r.def.kind,
        label: r.def.label,
        allotted: r.def.allotted,
        used: Math.round(r.used),
        words,
        voicedSec: Math.max(0, Math.round((runs[i + 1]?.voiced0 || nextVoiced) - r.voiced0)),
        qaSec: Math.round(r.qaSec),
        coverage: t ? Math.round(t.coverage() * 100) : 0,
        finished: t ? t.maxPos >= t.toks.length - 5 : r.spoke,
        overtime: Math.max(0, Math.round(r.used - r.def.allotted)),
        skipped: [...skipped].filter((s) => !notReached.has(s)),
        notReached: [...notReached],
        transcript: r.transcript.trim(),
      };
    }).filter((p, i) => runs[i].used > 0);

    report = {
      id: Math.random().toString(36).slice(2, 10),
      ts: Date.now(),
      side,
      mode,
      judges,
      intensity,
      total,
      elapsed: Math.round(elapsed),
      phases,
      qa,
      hints,
      timeline,
      advice: [],
      engine: getJudgeEngineStatus().description,
    };
    state = 'report';
    scoring = qa.length ? `法官評議中 0/${qa.length}` : '';
    renderReport();

    // score answers after the hearing so the hearing itself never lags
    const pool = questionsOf(data, side);
    const graded = qa.some((x) => x.answer)
      ? await evaluateHearing({
          side,
          mode: modeLabel(mode),
          stats: report.phases
            .map((p) => `${p.label}: used ${p.used}s of ${p.allotted}s, Q&A ${p.qaSec}s, script coverage ${p.coverage}%, ${p.finished ? 'finished' : 'not finished'}`)
            .join('; ') + `; hints used ${hints.length}`,
          qa: qa.map((x) => ({ qid: x.qid, question: x.question, answer: x.answer, sec: Math.round(x.answerSec), followUp: x.followUp })),
          questions: pool,
        }, scoreAbort.signal)
      : null;
    if (signal.aborted) return;
    if (graded) {
      for (const it of graded.items) {
        const rec = qa[it.i];
        if (!rec) continue;
        rec.score = Math.max(0, Math.min(100, Math.round(it.score)));
        rec.feedback = it.note;
      }
      qa.forEach((rec) => {
        if (!rec.answer) {
          rec.score = 0;
          rec.feedback = '未回答';
        }
      });
      overall = graded.overall;
      report.engine = graded.engine;
      report.advice = [...graded.advice, ...buildAdvice(report)];
    }
    for (let i = 0; i < (graded ? 0 : qa.length); i++) {
      if (signal.aborted) return;
      const rec = qa[i];
      const q = pool.find((x) => x.id === rec.qid);
      if (!q || !rec.answer) {
        rec.score = rec.answer ? undefined : 0;
        rec.feedback = rec.answer ? '' : '未回答';
      } else {
        try {
          const ev = await evaluateAnswer(q, rec.answer, { durationSec: Math.max(1, rec.answerSec), pausesCount: 0, silenceTotalSec: 0 });
          rec.score = ev.totalScore;
          rec.feedback = ev.feedback.summary || ev.feedback.improvements[0] || '';
        } catch {}
      }
      scoring = `法官評議中 ${i + 1}/${qa.length}`;
      if (state === 'report') renderReport();
    }
    scoring = '';
    if (!graded) report.advice = buildAdvice(report);
    if (overall) (report as any).overall = overall;
    saveHearing(report);
    if (state === 'report') renderReport();
    const rep = report;
    const blob = await blobP;
    saved = await saveRecord(
      {
        kind: 'hearing',
        side,
        target_id: rep.id,
        title: `模擬庭 · ${modeLabel(mode)}`,
        stage: mode,
        score: avgScore(rep),
        duration_sec: rep.elapsed,
        engine: rep.engine,
        transcript: rep.phases.map((p) => `【${p.label}】${p.transcript}`).join('\n\n'),
        detail: { report: rep },
      },
      blob,
      audioReason('hearing', { elapsed: rep.elapsed }),
    );
    if (state === 'report' && report === rep) renderReport();
  }

  function avgScore(r: HearingReport): number | undefined {
    const s = r.qa.filter((x) => typeof x.score === 'number');
    return s.length ? Math.round(s.reduce((a, x) => a + (x.score ?? 0), 0) / s.length) : undefined;
  }

  function buildAdvice(r: HearingReport): string[] {
    const out: string[] = [];
    const qaSec = r.phases.reduce((a, p) => a + p.qaSec, 0);
    const used = r.phases.reduce((a, p) => a + p.used, 0) || 1;
    for (const p of r.phases) {
      if (p.kind === 'rebuttal') continue;
      if (!p.finished && p.notReached.length)
        out.push(`${p.label}：主稿沒講完，未講到〈${p.notReached.slice(0, 3).join('〉〈')}〉。主稿需要再壓縮，或把回答縮短，確保請求一定講得到。`);
      if (p.skipped.length) out.push(`${p.label}：〈${p.skipped.slice(0, 3).join('〉〈')}〉幾乎被跳過（覆蓋率不到 25%）。`);
      if (p.overtime > 0) out.push(`${p.label}：超時 ${p.overtime} 秒。看到 1 分鐘的時間卡就應該進結論。`);
      const wpm = p.voicedSec > 30 ? Math.round(p.words / (p.voicedSec / 60)) : 0;
      if (wpm > 165) out.push(`${p.label}：語速約 ${wpm} WPM，偏快，法官會更常打斷要你重述。`);
      if (wpm && wpm < 95) out.push(`${p.label}：語速約 ${wpm} WPM，偏慢，主稿會講不完。`);
    }
    const share = Math.round((qaSec / used) * 100);
    if (r.qa.length) out.push(`法官問答佔用 ${share}% 的時間（${fmtMin(qaSec)}），共 ${r.qa.length} 問。${share > 40 ? '回答太長：先一句結論，再一個理由，然後主動回到主稿。' : ''}`);
    const main = r.qa.filter((x) => !x.followUp && x.answer);
    const avgAns = main.length ? main.reduce((a, x) => a + x.answerSec, 0) / main.length : 0;
    if (avgAns > 60) out.push(`首答平均 ${Math.round(avgAns)} 秒。理想是 30–45 秒。`);
    const bad = r.qa.filter((x) => x.resumed === 'skipped' || x.resumed === 'repeated');
    if (bad.length) out.push(`${bad.length} 次答完沒有從打斷處接回主稿（跳段或重講）。練習用一句 “Returning to …” 接回。`);
    const unanswered = r.qa.filter((x) => !x.answer).length;
    if (unanswered) out.push(`${unanswered} 個問題沒有回答到（或辨識不到）。`);
    if (r.hints.length) {
      const hs = r.hints.reduce((a, h) => a + h.dur, 0);
      const bySec = new Map<string, number>();
      r.hints.filter((h) => h.kind === 'script').forEach((h) => bySec.set(h.label, (bySec.get(h.label) ?? 0) + h.dur));
      const worst = [...bySec.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push(`使用提示 ${r.hints.length} 次，共 ${fmtMin(hs)}。${worst ? `最常卡在〈${worst[0]}〉，回口說教練從這段練到「抗打斷」。` : ''}`);
    } else out.push('全程沒有使用提示。');
    if (longSilences) out.push(`陳述中出現 ${longSilences} 次超過 6 秒的停頓。`);
    return out;
  }

  function renderReport() {
    if (signal.aborted || !report) return;
    const r = report;
    const qaSec = r.phases.reduce((a, p) => a + p.qaSec, 0);
    const hintSec = r.hints.reduce((a, h) => a + h.dur, 0);
    const avg = avgScore(r);
    const cov = r.phases.filter((p) => p.kind !== 'rebuttal');
    const covAvg = cov.length ? Math.round(cov.reduce((a, p) => a + p.coverage, 0) / cov.length) : 0;
    // phase offsets on a single timeline
    const starts: number[] = [];
    let acc = 0;
    for (const p of r.phases) {
      starts.push(acc);
      acc += Math.max(p.used, p.allotted);
    }
    const span = acc || 1;
    const pos = (phase: number, at: number) => {
      // `at` is global elapsed; convert using cumulative used
      let before = 0;
      for (let i = 0; i < phase; i++) before += r.phases[i]?.used ?? 0;
      return ((starts[phase] ?? 0) + Math.max(0, at - before)) / span;
    };
    const advice = r.advice.length ? r.advice : buildAdvice(r);
    const weakSec = r.hints.find((h) => h.kind === 'script')?.label;

    container.innerHTML = html`
      <article class="hear-report">
        <header>
          <span class="kicker">庭後報告 · ${new Date(r.ts).toLocaleString('zh-TW')}</span>
          <h2>${r.side === 'prosecution' ? '控方' : '辯方'} · ${modeLabel(r.mode)} · ${r.judges} 位法官 · ${{ light: '溫和', standard: '標準', hot: 'Hot bench' }[r.intensity]}</h2>
          ${scoring ? raw(html`<p class="mono dim">${scoring}（${r.engine}）</p>`) : raw(html`<p class="mono dim">評分：${r.engine}${saved ? ` · ${saveText()}` : ''}</p>`)}
          ${(r as any).overall ? raw(html`<p class="hear-overall">${(r as any).overall}</p>`) : ''}
        </header>

        <div class="hear-stats">
          <div><b>${fmtClock(r.elapsed)}</b><span>使用 / ${fmtClock(r.total)}</span></div>
          <div><b>${r.qa.length}</b><span>法官提問（追問 ${r.qa.filter((x) => x.followUp).length}）</span></div>
          <div><b>${Math.round((qaSec / Math.max(1, r.elapsed)) * 100)}%</b><span>問答佔時</span></div>
          <div><b>${covAvg}%</b><span>主稿覆蓋</span></div>
          <div class="${r.hints.length ? 'warn' : ''}"><b>${r.hints.length}</b><span>提示 · ${fmtMin(hintSec)}</span></div>
          <div><b>${avg ?? '—'}</b><span>回答平均分</span></div>
        </div>

        <figure class="hear-tl" aria-label="時間軸">
          ${r.phases.map((p, i) =>
            raw(html`<div class="tl-phase" style="left:${(starts[i] / span) * 100}%;width:${(p.allotted / span) * 100}%"><span>${p.label.split(' · ')[0]}</span></div>
              ${p.overtime ? raw(html`<div class="tl-over" style="left:${((starts[i] + p.allotted) / span) * 100}%;width:${(p.overtime / span) * 100}%"></div>`) : ''}`),
          )}
          ${r.timeline.map((t) =>
            raw(html`<div class="tl-${t.type}" style="left:${pos(t.phase, t.at) * 100}%;width:${Math.max(0.35, (t.dur / span) * 100)}%" title="${t.type === 'qa' ? '法官問答' : '提示'} ${fmtClock(t.at)} · ${Math.round(t.dur)} 秒"></div>`),
          )}
          <figcaption class="mono dim"><i class="k-qa"></i>法官問答 <i class="k-hint"></i>提示 <i class="k-over"></i>超時</figcaption>
        </figure>

        <section>
          <h3>教練建議</h3>
          <ol class="hear-advice">${advice.map((a) => raw(html`<li>${a}</li>`))}</ol>
          ${weakSec ? raw(html`<p><a class="btn ghost small" href="/debate?tab=memorize&sec=${encodeURIComponent(weakSec)}">到口說教練練〈${weakSec}〉</a></p>`) : ''}
        </section>

        <section>
          <h3>各階段</h3>
          <table class="hear-table">
            <thead><tr><th>階段</th><th>用時</th><th>問答</th><th>主稿覆蓋</th><th>字數</th><th>狀態</th></tr></thead>
            <tbody>
              ${r.phases.map((p) =>
                raw(html`<tr><td>${p.label}</td><td>${fmtClock(p.used)} / ${fmtClock(p.allotted)}</td><td>${fmtClock(p.qaSec)}</td>
                  <td>${p.kind === 'rebuttal' ? '—' : `${p.coverage}%`}</td><td>${p.words}</td>
                  <td>${p.overtime ? `超時 ${p.overtime}s` : p.finished ? '講完' : p.kind === 'rebuttal' ? '—' : '未講完'}</td></tr>`),
              )}
            </tbody>
          </table>
        </section>

        <section>
          <h3>法官問答（${r.qa.length}）</h3>
          ${r.qa.length
            ? raw(html`<ol class="hear-qa">${r.qa.map((x) =>
                raw(html`<li class="${x.followUp ? 'fu' : ''}">
                  <header><span class="mono">${fmtClock(x.at)} · ${JUDGES[x.judge]?.zh ?? ''}${x.followUp ? ' · 追問' : ''}${x.qid ? ` · ${x.qid}` : ''}${x.anchored ? ' · ⚖ 插問點' : ''}</span>
                    <b>${typeof x.score === 'number' ? `${x.score} 分` : x.answer ? '…' : ''}</b></header>
                  <p class="q">${x.question}</p>
                  <p class="a">${x.answer || '（沒有收到回答）'}</p>
                  <p class="mono dim">回答 ${Math.round(x.answerSec)} 秒${x.resumed !== 'n/a' ? ` · 接回主稿：${{ ok: '準確', skipped: '跳段', repeated: '重講' }[x.resumed]}` : ''}${x.feedback ? ` · ${x.feedback}` : ''}</p>
                </li>`),
              )}</ol>`)
            : raw('<p class="dim">本場沒有提問。</p>')}
        </section>

        <section>
          <h3>提示使用紀錄（${r.hints.length}）</h3>
          ${r.hints.length
            ? raw(html`<table class="hear-table"><thead><tr><th>時間</th><th>階段</th><th>持續</th><th>類型</th><th>看到的內容</th></tr></thead><tbody>
              ${r.hints.map((h) =>
                raw(html`<tr><td>${fmtClock(h.at)}</td><td>${r.phases[h.phase]?.label.split(' · ')[0] ?? ''}</td><td>${h.dur.toFixed(1)} 秒</td>
                  <td>${h.kind === 'answer' ? `回答架構 ${h.ref}` : h.label}</td><td class="hint-shown">${h.shown}</td></tr>`),
              )}</tbody></table>`)
            : raw('<p class="dim">沒有使用提示。</p>')}
        </section>

        <details>
          <summary class="mono">逐字稿</summary>
          ${r.phases.map((p) => raw(html`<h4>${p.label}</h4><p class="hear-transcript">${p.transcript || '（無）'}</p>`))}
        </details>

        <footer class="hear-actions">
          <button class="btn primary" id="again">再開一庭</button>
          <button class="btn ghost" id="copy-md">複製報告（Markdown）</button>
        </footer>
      </article>
    `;
    $('#again', container)?.addEventListener('click', () => {
      state = 'setup';
      report = null;
      cloudPast = null;
      renderSetup();
    });
    $('#copy-md', container)?.addEventListener('click', (e) => {
      navigator.clipboard.writeText(toMarkdown(r, advice)).then(() => ((e.target as HTMLElement).textContent = '已複製'));
    });
  }

  function saveText(): string {
    if (!saved) return '';
    if (saved.queued) return '紀錄暫存在這台裝置，下次開啟時上傳';
    if (saved.audio === 'saved') return `已保存到練習紀錄，含整場錄音`;
    if (saved.audio === 'no-account') return '已保存（文字）；以帳號登入才會保存錄音';
    if (saved.audio === 'skipped') return '已保存（文字）；未滿 5 分鐘不留錄音';
    if (saved.audio === 'failed') return `已保存，錄音上傳失敗：${saved.error ?? ''}`;
    return '已保存到練習紀錄';
  }

  function toMarkdown(r: HearingReport, advice: string[]): string {
    const L: string[] = [];
    L.push(`# 模擬庭報告 ${new Date(r.ts).toLocaleString('zh-TW')}`);
    L.push(`${r.side === 'prosecution' ? '控方' : '辯方'} · ${modeLabel(r.mode)} · 用時 ${fmtClock(r.elapsed)} / ${fmtClock(r.total)} · 提問 ${r.qa.length} · 提示 ${r.hints.length} 次`);
    L.push('', '## 教練建議', ...advice.map((a) => `- ${a}`));
    L.push('', '## 各階段', '| 階段 | 用時 | 問答 | 覆蓋 | 狀態 |', '|---|---|---|---|---|');
    for (const p of r.phases) L.push(`| ${p.label} | ${fmtClock(p.used)}/${fmtClock(p.allotted)} | ${fmtClock(p.qaSec)} | ${p.coverage}% | ${p.overtime ? `超時 ${p.overtime}s` : p.finished ? '講完' : '未講完'} |`);
    L.push('', '## 法官問答');
    r.qa.forEach((x, i) => L.push(`${i + 1}. [${fmtClock(x.at)}] ${x.followUp ? '(追問) ' : ''}${x.question}`, `   - 回答（${Math.round(x.answerSec)}s${typeof x.score === 'number' ? `，${x.score} 分` : ''}）：${x.answer || '—'}`));
    L.push('', '## 提示紀錄');
    r.hints.forEach((h) => L.push(`- [${fmtClock(h.at)}] ${h.dur.toFixed(1)}s · ${h.kind === 'answer' ? `回答架構 ${h.ref}` : h.label}：${h.shown}`));
    return L.join('\n');
  }

  /* ================================================================ wiring */

  function teardownRoom() {
    room?.remove();
    room = null;
    document.body.classList.remove('moot-lock');
  }

  const onKey = (e: KeyboardEvent) => {
    if (!room) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      togglePause();
    } else if ((e.key === 'h' || e.key === 'H') && !e.repeat) hintStart();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (room && (e.key === 'h' || e.key === 'H')) hintEnd();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  renderSetup();

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    if (timer) clearInterval(timer);
    scoreAbort.abort();
    cancelTTS?.();
    mic?.stop();
    teardownRoom();
  };
}

