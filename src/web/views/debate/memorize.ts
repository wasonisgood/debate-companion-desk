/**
 * 口說教練 Oral Coach
 *
 * The advocate does not pick "modes". The coach chooses the next chunk of the
 * advocate's own seat, and walks it up a ladder:
 *   跟讀 read-through → 提詞 cue words → 脫稿 blind → 抗打斷 blind with a judge interruption → 串背 chain
 * The mic follows the voice through the script (ScriptTracker), finishes the
 * attempt automatically, scores it, and moves on. Space is the only control
 * that matters; H (hold) whispers the next words and is counted.
 */

import { html, raw, $, $$ } from '../../lib/dom';
import { loadDebateData } from '../../lib/debateStorage';
import { saveRecord, audioReason, uploadAudio, canKeepAudio, pushProgressSoon, type SaveResult } from '../../lib/debateRecords';
import type { BenchQuestion, OralUnit } from '../../lib/debateData';
import { computeRecitationDiff, type RecitationDiffResult } from '../../lib/speechAudio';
import {
  SEAT_INFO,
  TARGET_WPM,
  type Seat,
  type Side,
  ScriptTracker,
  benchHtml,
  anchorsOf,
  cleanScript,
  estimateSec,
  fmtClock,
  hasSpeechRecognition,
  loadMastery,
  loadPrefs,
  questionSeat,
  questionsOf,
  refsOf,
  saveMastery,
  savePrefs,
  setJudgeState,
  shortSection,
  speakAs,
  startLiveMic,
  tokenize,
  unitsFor,
  wordsCount,
  type LiveMic,
  type Mastery,
  type Tok,
  type Anchor,
  pick,
  OPENERS,
} from '../../lib/mootCourt';
import { sttNote } from '../../lib/stt';
import { changedUnits, clearChanged } from '../../lib/matchPrep';

type Stage = 'read' | 'cue' | 'blind' | 'interrupt' | 'chain';
type Phase = 'ready' | 'demo' | 'speaking' | 'judge' | 'answer' | 'resume' | 'result';

const STAGES: { key: Stage; zh: string; en: string; pass: number; brief: string }[] = [
  { key: 'read', zh: '跟讀', en: 'Read-through', pass: 85, brief: '看著稿，用出庭語速完整唸一遍。我會跟著你的聲音走。' },
  { key: 'cue', zh: '提詞', en: 'Cue words', pass: 80, brief: '只剩關鍵詞與句首。把句子補完整，說過的字會自動浮現。' },
  { key: 'blind', zh: '脫稿', en: 'Off-script', pass: 80, brief: '整段脫稿。卡住超過 4 秒我會輕聲提示下一個字（會扣分）。' },
  { key: 'interrupt', zh: '抗打斷', en: 'Under questioning', pass: 75, brief: '脫稿陳述中法官會插話。答完後要從被打斷的地方接回去。' },
  { key: 'chain', zh: '串背', en: 'Chain', pass: 80, brief: '把上一段和這一段連起來脫稿講完，練段落之間的轉場。' },
];

interface Block {
  idx: number;
  units: OralUnit[];
  section: string;
  text: string;
  toks: Tok[];
  refs: string[];
  anchors: Anchor[]; // judge insertion points (token index within block)
  words: number;
}

interface Attempt {
  stage: Stage;
  diff: RecitationDiffResult;
  score: number;
  pass: boolean;
  sec: number;
  wpm: number;
  hints: number;
  missedKeys: string[];
  resume?: 'ok' | 'skipped' | 'repeated';
  question?: BenchQuestion;
  answer?: string;
}

function buildBlocks(units: OralUnit[]): Block[] {
  const blocks: Block[] = [];
  let cur: OralUnit[] = [];
  let words = 0;
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((u) => cleanScript(u.textEn)).join(' ');
    const anchors: Anchor[] = [];
    let off = 0;
    for (const u of cur) {
      anchors.push(...anchorsOf(u.textEn, off));
      off += wordsCount(u.textEn);
    }
    blocks.push({
      idx: blocks.length,
      units: cur,
      section: cur[0].section,
      text,
      toks: tokenize(text),
      refs: cur.flatMap((u) => refsOf(u.textEn)),
      anchors,
      words: wordsCount(text),
    });
    cur = [];
    words = 0;
  };
  for (const u of units) {
    const w = wordsCount(u.textEn);
    if (cur.length && (cur[0].section !== u.section || words + w > 120)) flush();
    cur.push(u);
    words += w;
  }
  flush();
  return blocks;
}

export default function renderCoach(container: HTMLElement, signal: AbortSignal) {
  const data = loadDebateData();
  const prefs = loadPrefs();
  let side: Side = prefs.side;
  let seat: Seat = prefs.seat;
  const mastery: Record<string, Mastery> = loadMastery();
  const canHear = hasSpeechRecognition();

  let blocks: Block[] = [];
  let cursor = 0;
  let stage: Stage = 'read';
  let phase: Phase = 'ready';
  let chainWith: Block | null = null;
  let lastAttempt: Attempt | null = null;
  let failStreak = 0;
  const sessionLog: Attempt[] = [];
  let recBlob: Blob | null = null;
  let saved: SaveResult | null = null;

  // live attempt state
  let mic: LiveMic | null = null;
  let tracker: ScriptTracker | null = null;
  let transcript = '';
  let interim = '';
  let startedAt = 0;
  let hintsUsed = 0;
  let hintOn = false;
  let autoHintAt = -1;
  let poll: number | undefined;
  let cancelTTS: (() => void) | null = null;
  let interruptAt = -1; // tracker pos where the judge cut in
  let question: BenchQuestion | null = null;
  let answer = '';
  let answerStart = 0;
  let resumeText = '';
  let resumeVerdict: Attempt['resume'];

  function loadScope() {
    blocks = buildBlocks(unitsFor(data, side, seat));
    const qs = new URLSearchParams(location.search).get('sec');
    const bySec = qs ? blocks.findIndex((b) => b.section.includes(qs)) : -1;
    // ?changed=1 (from 對戰準備 / Word 同步): start at the first rewritten paragraph
    const byChange = new URLSearchParams(location.search).get('changed') ? nextChanged(-1) : -1;
    cursor = bySec >= 0 ? bySec : byChange >= 0 ? byChange : Math.max(0, blocks.findIndex((b) => levelOf(b) < 4));
    if (cursor < 0) cursor = 0;
    stage = stageFor(blocks[cursor]);
    chainWith = null;
    lastAttempt = null;
    phase = 'ready';
  }

  /** Next block (after `from`) holding a paragraph rewritten since it was last practised. */
  function nextChanged(from: number): number {
    const c = changedUnits();
    for (let k = 1; k <= blocks.length; k++) {
      const i = (from + k) % blocks.length;
      if (blocks[i].units.some((u) => c[u.id])) return i;
    }
    return -1;
  }

  function levelOf(b: Block): number {
    return Math.min(...b.units.map((u) => mastery[u.id]?.level ?? 0));
  }

  function stageFor(b: Block | undefined): Stage {
    if (!b) return 'read';
    const l = levelOf(b);
    return (['read', 'cue', 'blind', 'interrupt', 'blind'] as Stage[])[Math.min(4, l)];
  }

  function activeBlocks(): Block[] {
    const b = blocks[cursor];
    return stage === 'chain' && chainWith ? [chainWith, b] : [b];
  }
  function activeToks(): Tok[] {
    return activeBlocks().flatMap((b) => b.toks);
  }
  /** Insertion points of the active block(s), offset into the joined token list. */
  function activeAnchors(): Anchor[] {
    let o = 0;
    const out: Anchor[] = [];
    for (const b of activeBlocks()) {
      out.push(...b.anchors.map((a) => ({ ...a, at: a.at + o })));
      o += b.toks.length;
    }
    return out;
  }
  /** The insertion point the judge will use in 抗打斷: first one whose question exists. */
  function plannedAnchor(): { a: Anchor; q: BenchQuestion } | null {
    const pool = questionsOf(data, side);
    for (const a of activeAnchors()) {
      const q = pool.find((x) => x.id === a.qid);
      if (q) return { a, q };
    }
    return null;
  }
  function anchorMark(a: Anchor, planned: boolean): string {
    const q = questionsOf(data, side).find((x) => x.id === a.qid);
    const tip = q ? `${a.qid}｜${q.title || ''}\n${q.questionEn}` : `${a.qid}（題庫中找不到此題）`;
    return `<i class="tp-anchor${a.teacher ? ' teacher' : ''}${planned ? ' planned' : ''}${q ? '' : ' broken'}" title="${escapeWord(tip)}">⚖ ${escapeWord(a.qid)}</i> `;
  }

  function activeText(): string {
    return activeBlocks()
      .map((b) => b.text)
      .join(' ');
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (signal.aborted) return;
    const b = blocks[cursor];
    const seatWords = blocks.reduce((a, x) => a + x.words, 0);
    const seatSec = estimateSec(seatWords);
    const allotted = SEAT_INFO[seat].minutes * 60;
    const ratio = seatSec / allotted;
    const sections = groupSections();
    const st = STAGES.find((s) => s.key === stage)!;

    container.innerHTML = html`
      <div class="coach">
        <div class="coach-top">
          <div class="seg">
            <button class="${side === 'prosecution' ? 'on' : ''}" data-side="prosecution">控方</button>
            <button class="${side === 'defense' ? 'on' : ''}" data-side="defense">辯方</button>
          </div>
          <div class="seg">
            ${([1, 2] as Seat[]).map((s) =>
              raw(html`<button class="${seat === s ? 'on' : ''}" data-seat="${s}">${SEAT_INFO[s].zh} · ${SEAT_INFO[s].minutes}′</button>`),
            )}
          </div>
          <p class="coach-budget ${ratio > 0.7 ? 'warn' : ''}" title="以 ${TARGET_WPM} WPM 估算">
            主稿 ${seatWords} 字 ≈ ${fmtClock(seatSec)}／配給 ${SEAT_INFO[seat].minutes}:00
            ${ratio >= 1
              ? raw(html`<em>· 光主稿就超出 ${fmtClock(seatSec - allotted)}，完全沒有回答法官的時間——需要刪稿，建議壓到 ${Math.round((allotted * 0.65) / 60)} 分鐘內</em>`)
              : ratio > 0.7
              ? raw(html`<em>· 只剩 ${fmtClock(allotted - seatSec)} 給法官提問，建議主稿壓在 ${Math.round((allotted * 0.65) / 60)} 分鐘內</em>`)
              : raw(html`<em>· 約有 ${Math.round((1 - ratio) * 100)}% 時間可應付提問</em>`)}
          </p>
          ${(() => {
            const c = changedUnits();
            const n = blocks.filter((x) => x.units.some((u) => c[u.id])).length;
            return n ? raw(html`<p class="coach-changed mono">稿件有 ${n} 段改過，需要重新熟記 <button class="btn ghost small" data-next-changed>${b && b.units.some((u) => c[u.id]) ? '下一段改過的 →' : '跳到改過的段落 →'}</button></p>`) : '';
          })()}
        </div>

        <nav class="coach-map" aria-label="段落熟練度">
          ${sections.map(([sec, list]) =>
            raw(html`
              <button class="coach-sec ${b && b.section === sec ? 'on' : ''}" data-jump="${list[0].idx}" title="${sec}">
                <span>${shortSection(sec)}</span>
                <i>${list.map((x) => raw(`<b class="lv${levelOf(x)} ${x.idx === cursor ? 'cur' : ''}"></b>`))}</i>
              </button>
            `),
          )}
        </nav>

        ${!b
          ? raw(html`<p class="mono dim">此席位沒有稿件段落。</p>`)
          : raw(html`
          <section class="coach-stage" data-stage="${stage}" data-phase="${phase}">
            <header>
              <div class="coach-where">
                <span class="mono dim">${shortSection(b.section)} · 第 ${cursor + 1}/${blocks.length} 塊 · ${b.words} 字 ≈ ${estimateSec(b.words)} 秒</span>
              </div>
              <ol class="coach-ladder">
                ${STAGES.map((s, i) =>
                  raw(html`<li><button type="button" data-stage-pick="${s.key}"
                    class="${s.key === stage ? 'on' : ''} ${i < levelOf(b) && s.key !== 'chain' ? 'done' : ''}"
                    ${s.key === 'chain' && cursor === 0 ? raw('disabled') : ''}
                    title="${s.key === 'chain' && cursor === 0 ? '第一塊之前沒有段落可以串背' : `${s.en}：${s.brief}`}">${s.zh}</button></li>`),
                )}
              </ol>
            </header>

            <p class="coach-say" id="coach-say">${coachLine(st)}</p>

            ${phase === 'judge' || phase === 'answer' || phase === 'resume'
              ? raw(html`<div class="coach-bench">${raw(benchHtml(1))}<p class="coach-q" id="coach-q">${question ? `“${question.questionEn}”` : ''}</p></div>`)
              : ''}

            <div class="tp" id="tp" data-stage="${stage}">
              ${raw(tpHtml())}
            </div>

            ${phase === 'result' && lastAttempt ? raw(resultHtml(lastAttempt)) : ''}

            <footer class="coach-foot">
              <button class="coach-mic ${phase === 'speaking' || phase === 'answer' || phase === 'resume' ? 'live' : ''}" id="coach-mic" aria-label="開始／結束">
                <span id="coach-mic-lvl"></span>
              </button>
              <div class="coach-foot-txt">
                <b id="coach-primary">${primaryLabel()}</b>
                <span class="mono dim" id="coach-meter">${phase === 'speaking' ? '' : 'Space'}</span>
              </div>
              <div class="coach-keys mono dim">
                <button class="linkish" id="k-demo">D 示範朗讀</button>
                <button class="linkish" id="k-hint">H 提示（按住）</button>
                <button class="linkish" id="k-skip">→ 換下一塊</button>
              </div>
            </footer>
            ${!canHear ? raw(html`<p class="mono dim coach-note">此瀏覽器無法使用麥克風。改用自評：講完按 Space，再按 J（順）或 F（卡住）。</p>`) : sttNote() ? raw(html`<p class="mono dim coach-note">${sttNote()}跟讀進度會在每句停頓後更新。</p>`) : ''}
          </section>

          ${sessionLog.length
            ? raw(html`<p class="coach-session mono dim">本次練習 ${sessionLog.length} 回 · 通過 ${sessionLog.filter((a) => a.pass).length} · 平均 ${Math.round(sessionLog.reduce((a, x) => a + x.score, 0) / sessionLog.length)} 分 · 提示 ${sessionLog.reduce((a, x) => a + x.hints, 0)} 次</p>`)
            : ''}
        `)}
      </div>
    `;
    bind();
    paintTp();
    if (phase === 'result') paintSave();
  }

  /** Script words plus ⚖ insertion-point flags (flags are not words: not spoken, not scored). */
  function tpHtml(): string {
    const anchors = activeAnchors();
    const planned = stage === 'interrupt' ? plannedAnchor()?.a : undefined;
    const flagsAt = (i: number) =>
      anchors.filter((a) => a.at === i).map((a) => anchorMark(a, !!planned && a.at === planned.at && a.qid === planned.qid)).join('');
    let out = '';
    let g = 0;
    activeBlocks().forEach((blk, bi) => {
      if (bi > 0) out += '<span class="tp-join">／</span>';
      blk.toks.forEach((t) => {
        out += flagsAt(g);
        out += `<span class="tp-w${t.key ? ' key' : ''}" data-i="${g}">${escapeWord(t.raw)}</span> `;
        g++;
      });
    });
    out += flagsAt(g);
    return out;
  }

  function offset(bi: number): number {
    const bl = activeBlocks();
    let o = 0;
    for (let i = 0; i < bi; i++) o += bl[i].toks.length;
    return o;
  }

  function escapeWord(w: string): string {
    return w.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  }

  function groupSections(): [string, Block[]][] {
    const m = new Map<string, Block[]>();
    for (const b of blocks) {
      if (!m.has(b.section)) m.set(b.section, []);
      m.get(b.section)!.push(b);
    }
    return [...m.entries()];
  }

  function coachLine(st: (typeof STAGES)[number]): string {
    if (phase === 'demo') return '先聽一次節奏與重音，注意停頓落在哪裡。';
    if (phase === 'judge') return '法官插話。先聽完問題。';
    if (phase === 'answer') return '直接回答：先表態（Yes / No, Your Excellency），再給理由。答完停兩秒即可。';
    if (phase === 'resume') return '接回主稿：從剛才被打斷的那句話繼續講。';
    if (phase === 'result' && lastAttempt) return lastAttempt.pass ? '過關。按 Space 進入下一關。' : '還不穩，再來一次同一關。';
    if (stage === 'interrupt') {
      const p = plannedAnchor();
      const where = p ? `法官會在 ⚖ ${p.a.qid} 標記處插問（${p.a.at >= activeToks().length - 1 ? '講完這段時' : '講到該處時'}）。` : '這段沒有標記插問點，法官會在中段停頓時隨機插話。';
      return phase === 'speaking' ? where : `${st.zh}：${where}答完後從被打斷處接回。`;
    }
    if (phase === 'speaking') return st.brief;
    const n = activeAnchors().length;
    return `${st.zh}：${st.brief}${n ? `　⚖ 是法官插問點，不用唸出來；講到那裡要預期被打斷。` : ''}`;
  }

  function primaryLabel(): string {
    if (phase === 'speaking' || phase === 'resume') return canHear ? '講完自動結算（或按 Space）' : '講完按 Space';
    if (phase === 'answer') return '回答中…停頓 2 秒結束';
    if (phase === 'judge') return '法官發問中';
    if (phase === 'demo') return '示範中（Space 停止）';
    if (phase === 'result') return lastAttempt?.pass ? '下一關' : '再試一次';
    return '開始';
  }

  function resultHtml(a: Attempt): string {
    const st = STAGES.find((s) => s.key === a.stage)!;
    const pace = a.wpm > 160 ? '偏快，法官會跟不上，句尾停半拍' : a.wpm < 100 ? '偏慢，會吃掉提問時間' : '語速合宜';
    return html`
      <div class="coach-result ${a.pass ? 'pass' : 'fail'}">
        <div class="coach-score">
          <b>${a.score}</b><span>/ 100 · ${st.zh}門檻 ${st.pass}</span>
        </div>
        <ul class="coach-facts">
          <li>完整度 ${a.diff.accuracy}%（${a.diff.matchedWords}/${a.diff.totalRefWords} 字）</li>
          <li>${fmtClock(a.sec)} · ${a.wpm} WPM · ${pace}</li>
          ${a.hints ? raw(html`<li>使用提示 ${a.hints} 次（每次 −5）</li>`) : ''}
          ${a.resume
            ? raw(html`<li>接回主稿：${a.resume === 'ok' ? '準確接回' : a.resume === 'skipped' ? '跳過了被打斷後的內容' : '重講了前面已說過的內容'}</li>`)
            : ''}
        </ul>
        ${a.missedKeys.length
          ? raw(html`<p class="coach-miss"><span class="mono">漏掉的關鍵詞</span>${a.missedKeys.map((k) => raw(html`<i>${k}</i>`))}</p>`)
          : ''}
        ${a.question
          ? raw(html`<details class="coach-qa"><summary class="mono">法官問題與你的回答</summary>
            <p><b>Q</b> ${a.question.questionEn}</p><p><b>A</b> ${a.answer || '（未收到回答）'}</p>
            <p class="dim"><b>參考</b> ${a.question.sampleEn}</p></details>`)
          : ''}
        <p class="mono dim coach-save" id="coach-save">${raw(saveLine())}</p>
      </div>
    `;
  }

  /** Update teleprompter classes without re-rendering. */
  function paintTp() {
    const tp = $('#tp', container);
    if (!tp) return;
    const words = $$<HTMLElement>('.tp-w', tp);
    const showAll = phase === 'result' || phase === 'demo' || stage === 'read' || phase === 'ready';
    tp.classList.toggle('reveal', showAll && (phase === 'result' || phase === 'demo' || stage === 'read'));
    tp.classList.toggle('peek', phase === 'ready' && stage !== 'read');
    const pos = tracker?.pos ?? -1;
    const missing = new Set<number>();
    if (phase === 'result' && tracker) for (let i = 0; i < words.length; i++) if (!tracker.covered[i]) missing.add(i);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      w.classList.toggle('done', Boolean(tracker?.covered[i]));
      w.classList.toggle('cur', i === pos && (phase === 'speaking' || phase === 'resume'));
      w.classList.toggle('miss', missing.has(i));
      w.classList.toggle('hint', hintOn && i >= pos && i < pos + 4);
      w.classList.toggle('cut', i === interruptAt);
    }
    tp.querySelector('.tp-anchor.planned')?.classList.toggle('fired', interruptAt >= 0);
  }

  /* ------------------------------------------------------------ flow */

  async function begin() {
    stopAll();
    tracker = new ScriptTracker(activeToks());
    transcript = '';
    interim = '';
    hintsUsed = 0;
    interruptAt = -1;
    question = null;
    answer = '';
    resumeText = '';
    resumeVerdict = undefined;
    autoHintAt = -1;
    phase = 'speaking';
    startedAt = performance.now();
    render();
    if (canHear) {
      try {
        mic = await startLiveMic({ onFinal, onInterim: (t) => (interim = t) });
        mic.startRecording();
      } catch {
        say('無法啟動麥克風，請確認瀏覽器權限。');
        phase = 'ready';
        render();
        return;
      }
    }
    poll = window.setInterval(onTick, 120);
  }

  function onFinal(text: string) {
    if (!tracker) return;
    if (phase === 'speaking') {
      transcript += ' ' + text;
      tracker.feedText(text);
    } else if (phase === 'answer') {
      answer += ' ' + text;
    } else if (phase === 'resume') {
      resumeText += ' ' + text;
      if (!resumeVerdict && resumeText.trim().split(/\s+/).length >= 5) judgeResume();
      transcript += ' ' + text;
      tracker.feedText(text);
    }
    interim = '';
    paintTp();
  }

  function onTick() {
    if (!tracker) return;
    const lvl = mic?.level() ?? 0;
    const el = $('#coach-mic-lvl', container);
    if (el) el.style.transform = `scale(${1 + lvl * 0.9})`;
    const elapsed = (performance.now() - startedAt) / 1000;
    const meter = $('#coach-meter', container);
    if (meter && (phase === 'speaking' || phase === 'resume')) {
      const tgt = estimateSec(tracker.toks.length);
      meter.textContent = `${fmtClock(elapsed)} / 目標 ${fmtClock(tgt)} · ${Math.round(tracker.coverage() * 100)}%`;
    }
    if (!mic) return;
    const sil = mic.silenceMs();
    const len = tracker.toks.length;
    const started = transcript.trim().length > 0;

    if (phase === 'speaking' || phase === 'resume') {
      // auto whisper when stuck in blind stages
      if ((stage === 'blind' || stage === 'interrupt' || stage === 'chain') && started && sil > 4000 && autoHintAt !== tracker.pos) {
        autoHintAt = tracker.pos;
        flashHint(2200);
        say('提示：看一眼下一個字，繼續講。');
      }
      // judge cuts in at the marked insertion point (or mid-block if none), at a natural pause
      if (stage === 'interrupt' && phase === 'speaking' && interruptAt < 0) {
        const p = plannedAnchor();
        const reached = p ? tracker.pos >= Math.min(p.a.at, len - 2) : tracker.pos > len * 0.35;
        if (reached && sil > 450) {
          interrupt(p);
          return;
        }
      }
      const nearEnd = tracker.pos >= len - 2 || tracker.coverage(Math.floor(len * 0.9)) > 0.5;
      if (started && ((nearEnd && sil > 1200) || sil > 7000)) finish();
    } else if (phase === 'answer') {
      const ansSec = (performance.now() - answerStart) / 1000;
      if (answer.trim() && ansSec > 4 && sil > 2200) endAnswer();
      else if (ansSec > 75) endAnswer();
    }
  }

  function pickQuestion(): BenchQuestion | null {
    const pool = questionsOf(data, side);
    const all = unitsFor(data, side);
    const seatPool = pool.filter((q) => questionSeat(q, all) === seat);
    return pick(seatPool) ?? pick(pool) ?? null;
  }

  function interrupt(p: { a: Anchor; q: BenchQuestion } | null) {
    question = p ? p.q : pickQuestion();
    if (!question || !tracker) return;
    interruptAt = p ? Math.min(p.a.at, tracker.toks.length) : tracker.pos;
    phase = 'judge';
    mic?.setMuted(true);
    render();
    const bench = $('.coach-bench', container)!;
    setJudgeState(bench, 0, 'lean');
    setTimeout(() => {
      setJudgeState(bench, 0, 'speaking');
      cancelTTS = speakAs(`${pick(OPENERS)} ${question!.simplified || question!.questionEn}`, 0, () => {
        cancelTTS = null;
        if (signal.aborted || phase !== 'judge') return;
        setJudgeState(bench, 0, 'listening');
        mic?.setMuted(false);
        phase = 'answer';
        answerStart = performance.now();
        updateTexts();
      });
    }, 700);
  }

  function endAnswer() {
    phase = 'judge';
    mic?.setMuted(true);
    const bench = $('.coach-bench', container);
    if (bench) setJudgeState(bench, 0, 'speaking');
    updateTexts();
    cancelTTS = speakAs('Thank you, counsel. Please return to your submission.', 0, () => {
      cancelTTS = null;
      if (signal.aborted) return;
      if (bench) setJudgeState(bench, 0, 'writing');
      mic?.setMuted(false);
      // cut in at the end of the passage: nothing left to resume
      if (tracker && interruptAt >= tracker.toks.length - 2) {
        resumeVerdict = 'ok';
        finish();
        return;
      }
      phase = 'resume';
      updateTexts();
      paintTp();
    });
  }

  function judgeResume() {
    if (!tracker) return;
    const p = tracker.peek(resumeText);
    const base = interruptAt;
    resumeVerdict = p >= base - 3 && p <= base + 10 ? 'ok' : p > base + 10 ? 'skipped' : 'repeated';
  }

  function updateTexts() {
    const say1 = $('#coach-say', container);
    const st = STAGES.find((s) => s.key === stage)!;
    if (say1) say1.textContent = coachLine(st);
    const p = $('#coach-primary', container);
    if (p) p.textContent = primaryLabel();
    $('#coach-mic', container)?.classList.toggle('live', phase === 'speaking' || phase === 'answer' || phase === 'resume');
    const stEl = $('.coach-stage', container);
    if (stEl) stEl.dataset.phase = phase;
  }

  function say(t: string) {
    const el = $('#coach-say', container);
    if (el) el.textContent = t;
  }

  function finish(selfGrade?: boolean) {
    if (!tracker) return;
    const sec = (performance.now() - startedAt) / 1000;
    if (phase === 'resume' && !resumeVerdict && resumeText.trim()) judgeResume();
    const blobP = mic?.stopRecording() ?? Promise.resolve(null);
    stopAll();
    const ref = activeText();
    const spoken = transcript.trim();
    let diff = computeRecitationDiff(ref, spoken || '');
    if (selfGrade !== undefined) {
      const acc = selfGrade ? 90 : 55;
      diff = { tokens: [], accuracy: acc, totalRefWords: tracker.toks.length, matchedWords: Math.round((tracker.toks.length * acc) / 100) };
      tracker.covered.fill(selfGrade ? 1 : 0);
    }
    const missedKeys = [
      ...new Set(
        tracker.toks
          .filter((t, i) => t.key && !t.sentHead && /\d|[A-Z]/.test(t.raw) && !tracker!.covered[i])
          .map((t) => t.raw.replace(/[,.;:]+$/, '')),
      ),
    ].slice(0, 12);
    const st = STAGES.find((s) => s.key === stage)!;
    let score = Math.max(0, diff.accuracy - hintsUsed * 5);
    if (stage === 'interrupt' && resumeVerdict && resumeVerdict !== 'ok') score = Math.max(0, score - 10);
    const pass = score >= st.pass && (stage !== 'interrupt' || resumeVerdict === 'ok' || !canHear);
    const voicedMin = Math.max(0.1, sec / 60);
    const a: Attempt = {
      stage,
      diff,
      score,
      pass,
      sec,
      wpm: Math.round((spoken ? spoken.split(/\s+/).length : diff.matchedWords) / voicedMin),
      hints: hintsUsed,
      missedKeys,
      resume: resumeVerdict,
      question: question ?? undefined,
      answer: answer.trim(),
    };
    lastAttempt = a;
    sessionLog.push(a);
    applyMastery(a);
    pushProgressSoon();
    recBlob = null;
    saved = null;
    phase = 'result';
    render();
    const blk = blocks[cursor];
    void blobP.then(async (blob) => {
      recBlob = blob;
      saved = await saveRecord(
        {
          kind: 'coach',
          side,
          target_id: blk.units[0].id,
          title: `${shortSection(blk.section)} · ${st.zh}`,
          stage,
          score,
          accuracy: diff.accuracy,
          passed: pass,
          duration_sec: Math.round(sec),
          engine: canHear ? '語音辨識比對' : '自評',
          transcript: spoken,
          detail: {
            section: blk.section,
            units: activeBlocks().flatMap((b) => b.units.map((u) => u.id)),
            chainWith: chainWith?.section ?? null,
            words: diff.totalRefWords, matched: diff.matchedWords,
            wpm: a.wpm, hints: hintsUsed, missedKeys,
            resume: resumeVerdict ?? null,
            question: question ? { id: question.id, text: question.questionEn } : null,
            answer: answer.trim(),
          },
        },
        blob,
        audioReason('coach', { passed: pass, stage }),
      );
      paintSave();
    });
  }

  function saveLine(): string {
    if (!saved) return '保存中…';
    if (saved.queued) return '離線：紀錄暫存在這台裝置，下次開啟時上傳。';
    if (saved.audio === 'saved') return html`已保存，含錄音（${saved.reason}）。`;
    if (saved.audio === 'skipped' && recBlob && canKeepAudio())
      return html`已保存（文字）。通過脫稿以上的關卡才自動留錄音 · <button class="linkish" id="keep-audio">仍要保存這段錄音</button>`;
    if (saved.audio === 'no-account') return '已保存（文字）。以帳號登入才會保存錄音。';
    if (saved.audio === 'failed') return html`已保存，但錄音上傳失敗：${saved.error ?? ''}`;
    return '已保存（文字）。';
  }

  function paintSave() {
    const el = $('#coach-save', container);
    if (!el) return;
    el.innerHTML = saveLine();
    $('#keep-audio', el)?.addEventListener('click', async () => {
      if (!saved?.id || !recBlob) return;
      el.textContent = '上傳錄音中…';
      try {
        await uploadAudio(saved.id, recBlob, '手動保存');
        saved = { ...saved, audio: 'saved', reason: '手動保存' };
      } catch (e: any) {
        saved = { ...saved, audio: 'failed', error: e?.message };
      }
      paintSave();
    });
  }

  function applyMastery(a: Attempt) {
    const target = { read: 1, cue: 2, blind: 3, interrupt: 4, chain: 0 }[a.stage];
    for (const u of activeBlocks().flatMap((b) => b.units)) {
      const m = mastery[u.id] ?? { level: 0, best: 0, attempts: 0, last: 0 };
      m.attempts++;
      m.last = Date.now();
      m.best = Math.max(m.best, a.score);
      if (a.pass && target > m.level && blocks[cursor].units.includes(u)) m.level = target;
      if (a.pass && target >= 2 && blocks[cursor].units.includes(u)) clearChanged(u.id);
      if (!a.pass && a.score < 50 && m.level > 0 && a.stage !== 'read') m.level--;
      mastery[u.id] = m;
    }
    saveMastery(mastery);
    failStreak = a.pass ? 0 : failStreak + 1;
  }

  function nextStep() {
    const a = lastAttempt;
    if (!a) return begin();
    if (!a.pass) {
      if (failStreak >= 2 && (stage === 'blind' || stage === 'interrupt')) {
        stage = 'cue';
        failStreak = 0;
      }
      phase = 'ready';
      lastAttempt = null;
      render();
      return;
    }
    const order: Stage[] = ['read', 'cue', 'blind', 'interrupt'];
    if (stage === 'chain' || (stage === 'interrupt' && cursor === 0) || (stage === 'blind' && levelOf(blocks[cursor]) >= 4)) {
      advanceBlock();
    } else if (stage === 'interrupt') {
      chainWith = blocks[cursor - 1];
      stage = 'chain';
    } else {
      stage = order[order.indexOf(stage) + 1];
    }
    phase = 'ready';
    lastAttempt = null;
    render();
  }

  function advanceBlock() {
    chainWith = null;
    cursor = (cursor + 1) % blocks.length;
    stage = stageFor(blocks[cursor]);
  }

  function demo() {
    if (phase === 'demo') {
      cancelTTS?.();
      cancelTTS = null;
      phase = 'ready';
      render();
      return;
    }
    stopAll();
    phase = 'demo';
    render();
    cancelTTS = speakAs(activeText(), 1, () => {
      cancelTTS = null;
      if (phase === 'demo') {
        phase = 'ready';
        render();
      }
    }, 0.92);
  }

  function flashHint(ms: number) {
    hintsUsed++;
    hintOn = true;
    paintTp();
    setTimeout(() => {
      hintOn = false;
      paintTp();
    }, ms);
  }

  function primary() {
    if (phase === 'ready') return void begin();
    if (phase === 'speaking' || phase === 'resume') {
      if (!canHear) {
        phase = 'result';
        say('講得順嗎？按 J（順）或 F（卡住）。');
        return;
      }
      return finish();
    }
    if (phase === 'answer') return endAnswer();
    if (phase === 'demo') return demo();
    if (phase === 'result' && lastAttempt) return nextStep();
  }

  function stopAll() {
    if (poll) clearInterval(poll);
    poll = undefined;
    mic?.stop();
    mic = null;
    cancelTTS?.();
    cancelTTS = null;
  }

  /* ------------------------------------------------------------ events */

  function bind() {
    $$<HTMLButtonElement>('[data-side]', container).forEach((b) =>
      b.addEventListener('click', () => {
        stopAll();
        side = b.dataset.side as Side;
        savePrefs({ side });
        loadScope();
        render();
      }),
    );
    $$<HTMLButtonElement>('[data-seat]', container).forEach((b) =>
      b.addEventListener('click', () => {
        stopAll();
        seat = Number(b.dataset.seat) as Seat;
        savePrefs({ seat });
        loadScope();
        render();
      }),
    );
    $('[data-next-changed]', container)?.addEventListener('click', () => {
      const i = nextChanged(cursor);
      if (i < 0) return;
      stopAll();
      cursor = i;
      stage = stageFor(blocks[cursor]);
      chainWith = null;
      phase = 'ready';
      lastAttempt = null;
      render();
    });
    $$<HTMLButtonElement>('[data-jump]', container).forEach((b) =>
      b.addEventListener('click', () => {
        stopAll();
        cursor = Number(b.dataset.jump);
        stage = stageFor(blocks[cursor]);
        chainWith = null;
        phase = 'ready';
        lastAttempt = null;
        render();
      }),
    );
    $$<HTMLButtonElement>('[data-stage-pick]', container).forEach((btn) =>
      btn.addEventListener('click', () => {
        const pickStage = btn.dataset.stagePick as Stage;
        if (pickStage === 'chain' && cursor === 0) return;
        stopAll();
        stage = pickStage;
        chainWith = pickStage === 'chain' ? blocks[cursor - 1] : null;
        failStreak = 0;
        phase = 'ready';
        lastAttempt = null;
        render();
      }),
    );
    $('#coach-mic', container)?.addEventListener('click', primary);
    $('#k-demo', container)?.addEventListener('click', demo);
    $('#k-skip', container)?.addEventListener('click', () => {
      stopAll();
      advanceBlock();
      phase = 'ready';
      lastAttempt = null;
      render();
    });
    $('#k-hint', container)?.addEventListener('click', () => flashHint(2000));
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) primary();
    } else if (e.key === 'h' || e.key === 'H') {
      if (!e.repeat && !hintOn && phase !== 'result') {
        hintsUsed++;
        hintOn = true;
        paintTp();
      }
    } else if (e.key === 'd' || e.key === 'D') demo();
    else if (e.key === 'ArrowRight') $('#k-skip', container)?.click();
    else if (!canHear && phase === 'result' && !lastAttempt && (e.key === 'j' || e.key === 'f')) {
      phase = 'speaking';
      finish(e.key === 'j');
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if ((e.key === 'h' || e.key === 'H') && hintOn) {
      hintOn = false;
      paintTp();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  loadScope();
  render();

  return () => {
    stopAll();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
  };
}
