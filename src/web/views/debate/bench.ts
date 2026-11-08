/**
 * 單題攻防 Single-question drill
 *
 * One question at a time, fully automatic: a judge on the bench leans in and
 * asks, the mic listens, a natural 2.5 s pause ends the answer, the bench may
 * press with one follow-up, then the answer is scored. Space advances; H (hold)
 * shows the Chinese gloss and answer structure and is logged in the result.
 */

import { html, raw, $, $$ } from '../../lib/dom';
import { loadDebateData } from '../../lib/debateStorage';
import { saveRecord, audioReason, uploadAudio, canKeepAudio, loadBenchScores, saveBenchScores, type SaveResult } from '../../lib/debateRecords';
import type { BenchQuestion } from '../../lib/debateData';
import { evaluateAnswer, generateFollowUpQuestion, getJudgeEngineStatus, type EvaluationResult } from '../../lib/debateJudgeAI';
import {
  SEAT_INFO,
  type Seat,
  type Side,
  benchHtml,
  fmtClock,
  hasSpeechRecognition,
  loadPrefs,
  pick,
  questionSeat,
  questionsOf,
  savePrefs,
  setAllJudges,
  setJudgeState,
  speakAs,
  startLiveMic,
  unitsFor,
  type LiveMic,
  OPENERS,
} from '../../lib/mootCourt';
import { sttNote } from '../../lib/stt';
import { generateQuestions, canGenerate } from '../../lib/questionGen';
import { matchesOf, focusMatch, setActiveMatch, matchTitle } from '../../lib/matchPrep';
import { OFFICIAL_FOLLOWUPS } from '../../lib/debateQuestionSanitizer';

type Phase = 'ready' | 'asking' | 'answer' | 'thinking' | 'followup' | 'answer2' | 'scoring' | 'result';
type Scope = 'seat' | 'all' | 'teacher' | 'match';


const GENERIC_FOLLOWUPS = [
  'Counsel, what is your best authority for that proposition?',
  'But how does that square with the facts of this case?',
  'If the Chamber disagrees with you on that, where does it leave your case?',
  'Is that a legal standard, or simply your reading of the facts?',
  'Can you point me to the specific paragraph of the facts you rely on?',
];


export default function renderBench(container: HTMLElement, signal: AbortSignal) {
  const data = loadDebateData();
  const prefs = loadPrefs();
  let side: Side = prefs.side;
  let seat: Seat = prefs.seat;
  let scope: Scope = 'seat';
  // ?match=… (from 對戰準備) or the drill focus: this round's questions first
  const urlMatch = matchesOf(data).find((m) => m.id === new URL(location.href).searchParams.get('match'));
  if (urlMatch) {
    side = urlMatch.ourSide;
    setActiveMatch(urlMatch.id);
    scope = 'match';
  }
  const fm = () => focusMatch(data, side);
  const judges = Math.max(1, Math.min(3, prefs.judges || 3));
  const scores = loadBenchScores();
  const canHear = hasSpeechRecognition();

  let deck: BenchQuestion[] = [];
  let q: BenchQuestion | null = null;
  let phase: Phase = 'ready';
  let asker = 0;
  let followText = '';
  let answer1 = '';
  let answer2 = '';
  let interim = '';
  let ansStart = 0;
  let ans1Sec = 0;
  let ans2Sec = 0;
  let evalRes: EvaluationResult | null = null;
  let hints = 0;
  let hintSec = 0;
  let hintFrom = 0;
  let hintOn = false;
  let mic: LiveMic | null = null;
  let poll: number | undefined;
  let cancelTTS: (() => void) | null = null;
  let abort: AbortController | null = null;
  let streak = { n: 0, sum: 0 };
  let followSource: 'official' | 'ai' | 'generic' | '' = '';
  let recBlob: Blob | null = null;
  let saved: SaveResult | null = null;
  let qStarted = 0;
  let genBusy = false;
  let genNote = '';
  const drilled = new Set<string>();

  function buildDeck() {
    const pool = questionsOf(data, side);
    const all = unitsFor(data, side);
    let list = pool;
    if (scope === 'seat') list = pool.filter((x) => {
      const s = questionSeat(x, all);
      return s === seat || s === 0;
    });
    if (scope === 'teacher') list = pool.filter((x) => x.id.startsWith('T'));
    if (scope === 'match') {
      const m = fm();
      list = m ? pool.filter((x) => x.match === m.id) : [];
    }
    // unseen first, then weakest, shuffled within bands
    deck = [...list]
      .map((x) => ({ x, k: (scores[x.id] ?? -1) + Math.random() * 15 }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.x);
  }

  function render() {
    if (signal.aborted) return;
    const eng = getJudgeEngineStatus();
    container.innerHTML = html`
      <div class="drill">
        <div class="coach-top">
          <div class="seg">
            <button class="${side === 'prosecution' ? 'on' : ''}" data-side="prosecution">控方</button>
            <button class="${side === 'defense' ? 'on' : ''}" data-side="defense">辯方</button>
          </div>
          <div class="seg">
            <button class="${scope === 'seat' ? 'on' : ''}" data-scope="seat">${SEAT_INFO[seat].zh}負責題</button>
            ${scope === 'seat'
              ? raw(html`<button class="mini" data-seat-toggle title="切換席位">⇄</button>`)
              : ''}
            <button class="${scope === 'all' ? 'on' : ''}" data-scope="all">全部</button>
            <button class="${scope === 'teacher' ? 'on' : ''}" data-scope="teacher">老師題</button>
            ${fm() ? raw(html`<button class="${scope === 'match' ? 'on' : ''}" data-scope="match" title="對戰準備中加入題庫的題目">對戰 ${matchTitle(fm()!)}</button>`) : ''}
          </div>
          ${canGenerate() ? raw(html`<button class="btn ghost small" id="gen-q" ${genBusy ? raw('disabled') : ''} title="題目練完了？請 AI 依你的稿件、對手與事實段出 5 題沒出過的新題">AI 出新題</button>`) : ''}
          <p class="coach-budget">${genNote ? `${genNote} · ` : ''}題庫 ${deck.length} 題 · ${streak.n ? `本次 ${streak.n} 題，平均 ${Math.round(streak.sum / streak.n)} 分` : '尚未作答'} · ${eng.isLocalLLM ? `AI：${eng.description}` : '規則引擎評分'}</p>
        </div>

        <section class="drill-court" data-phase="${phase}">
          ${raw(benchHtml(judges))}
          <div class="drill-caption" id="drill-caption">${raw(captionHtml())}</div>
          <div class="drill-hint" id="drill-hint" ${hintOn ? '' : 'hidden'}>${q ? raw(hintHtml(q)) : ''}</div>

          <div class="drill-you">
            <button class="coach-mic ${phase === 'answer' || phase === 'answer2' ? 'live' : ''}" id="drill-mic" aria-label="開始／下一題"><span id="drill-lvl"></span></button>
            <div>
              <b id="drill-status">${statusText()}</b>
              <p class="drill-live" id="drill-live">${phase === 'answer2' ? answer2 : phase === 'answer' ? answer1 : ''}</p>
            </div>
          </div>
        </section>

        ${phase === 'result' && evalRes && q ? raw(resultHtml(q, evalRes)) : ''}

        <p class="coach-keys mono dim">Space 開始／下一題 · H 按住看提示（會記錄）· R 請法官重述 · → 換一題
          ${sttNote() ? raw(html` · <b>${sttNote()}</b>`) : ''}</p>
      </div>
    `;
    bind();
  }

  function captionHtml(): string {
    if (!q) return html`<span class="dim">法官席就位。按 Space 開始，法官會直接對你發問。</span>`;
    if (phase === 'followup' || phase === 'answer2' || ((phase === 'scoring' || phase === 'result') && followText))
      return html`<span class="mono dim">追問</span> “${followText}”`;
    return html`“${q.questionEn}”`;
  }

  function hintHtml(x: BenchQuestion): string {
    return html`<p>${x.questionZh}</p><ol>${x.structure
      .filter((s) => !/[一-鿿]/.test(s))
      .map((s) => raw(html`<li>${s}</li>`))}</ol>`;
  }

  function statusText(): string {
    switch (phase) {
      case 'ready':
        return q ? '按 Space 下一題' : '按 Space 開庭';
      case 'asking':
        return '法官發問中…';
      case 'answer':
      case 'answer2':
        return '請回答 — 先表態，再給理由；講完停兩秒';
      case 'thinking':
        return '法官在筆記…';
      case 'followup':
        return '法官追問中…';
      case 'scoring':
        return '評分中…';
      case 'result':
        return 'Space 下一題';
    }
  }

  function resultHtml(x: BenchQuestion, r: EvaluationResult): string {
    return html`
      <section class="drill-result">
        <div class="coach-score"><b>${r.totalScore}</b><span>/ 100 · 法理 ${r.legalScore} · 直接 ${r.directScore} · 流暢 ${r.fluencyScore} · 策略 ${r.strategyScore}</span></div>
        <ul class="coach-facts">
          <li>首答 ${fmtClock(ans1Sec)}${followText ? ` · 追問回答 ${fmtClock(ans2Sec)}` : ''} · ${r.wpm} WPM${r.fillerWordsCount ? ` · 贅詞 ${r.fillerWordsCount}` : ''}</li>
          <li>${hints ? `使用提示 ${hints} 次，共 ${Math.round(hintSec)} 秒` : '未使用提示'}</li>
          <li>評分：${r.engineName ?? '離線規則引擎'}${followText ? ` · 追問來源：${{ official: '題庫老師追問', ai: 'AI 依你的回答產生', generic: '通用追問', '': '' }[followSource]}` : ''}</li>
          ${ans1Sec > 75 ? raw('<li>首答超過 75 秒：法官會打斷你，先給結論再展開。</li>') : ''}
        </ul>
        ${r.feedback.summary ? raw(html`<p>${r.feedback.summary}</p>`) : ''}
        ${r.feedback.legalCritique ? raw(html`<p class="dim">${r.feedback.legalCritique}</p>`) : ''}
        <p class="mono dim drill-save" id="drill-save">${raw(saveLine())}</p>
        <div class="drill-fb">
          <div><span class="mono">做得好</span>${r.feedback.strengths.slice(0, 3).map((s) => raw(html`<p>${s}</p>`))}</div>
          <div><span class="mono">下次改</span>${r.feedback.improvements.slice(0, 3).map((s) => raw(html`<p>${s}</p>`))}</div>
        </div>
        <details><summary class="mono">你的回答 · 參考答案</summary>
          <p><b>你：</b>${answer1 || '（未收到）'}</p>
          ${followText ? raw(html`<p><b>追問：</b>${followText}</p><p><b>你：</b>${answer2 || '（未收到）'}</p>`) : ''}
          <p class="dim"><b>參考：</b>${x.sampleEn}</p>
        </details>
      </section>`;
  }

  /* ------------------------------------------------------------ flow */

  async function ensureMic() {
    if (mic || !canHear) return;
    mic = await startLiveMic({
      onFinal: (t) => {
        if (phase === 'answer') answer1 = (answer1 + ' ' + t).trim();
        else if (phase === 'answer2') answer2 = (answer2 + ' ' + t).trim();
        interim = '';
        paintLive();
      },
      onInterim: (t) => {
        interim = t;
        paintLive();
      },
    });
    mic.setMuted(true);
    poll = window.setInterval(tick, 120);
  }

  function paintLive() {
    const el = $('#drill-live', container);
    if (!el) return;
    const base = phase === 'answer2' ? answer2 : phase === 'answer' ? answer1 : '';
    el.textContent = `${base} ${interim}`.trim();
  }

  /** Bank drilled through (or empty): ask the AI for new questions instead of repeating. */
  async function topUp(manual: boolean): Promise<boolean> {
    if (genBusy || !canGenerate()) return false;
    genBusy = true;
    const st = $('#drill-status', container);
    if (st) st.textContent = 'AI 正在出新題…';
    try {
      const fresh = await generateQuestions(side, scope === 'seat' ? seat : 0, 5, data, signal);
      deck.unshift(...fresh.filter((x) => scope !== 'teacher').map((x) => questionsOf(data, side).find((y) => y.id === x.id) ?? x));
      genNote = `AI 新增 ${fresh.length} 題（分類「AI 新題」，已存入題庫）`;
      return fresh.length > 0;
    } catch (e: any) {
      genNote = manual ? `出新題失敗：${e?.message ?? e}` : '';
      return false;
    } finally {
      genBusy = false;
    }
  }

  async function nextQuestion() {
    if (!deck.length) {
      // every question in scope answered this session: new ones rather than a repeat
      if (!(drilled.size && (await topUp(false)))) buildDeck();
    }
    q = deck.shift() ?? null;
    if (q) drilled.add(q.id);
    if (!q) return;
    answer1 = answer2 = followText = interim = '';
    ans1Sec = ans2Sec = 0;
    hints = 0;
    hintSec = 0;
    evalRes = null;
    asker = judges === 1 ? 0 : Math.floor(Math.random() * judges);
    try {
      await ensureMic();
    } catch {
      alert('無法啟動麥克風，請允許瀏覽器使用麥克風。');
      return;
    }
    recBlob = null;
    saved = null;
    followSource = '';
    qStarted = performance.now();
    mic?.startRecording();
    ask(`${Math.random() < 0.5 ? pick(OPENERS)!.replace(/ —$/, ',') + ' ' : ''}${q.questionEn}`, 'asking', 'answer');
  }

  function saveLine(): string {
    if (!saved) return '保存中…';
    if (saved.queued) return '離線：紀錄已暫存在這台裝置，下次開啟時上傳。';
    const base = '已保存到練習紀錄';
    if (saved.audio === 'saved') return html`${base}，含錄音（${saved.reason}）。`;
    if (saved.audio === 'skipped' && recBlob && canKeepAudio())
      return html`${base}（文字）。錄音未達自動保存門檻 · <button class="linkish" id="keep-audio">仍要保存這段錄音</button>`;
    if (saved.audio === 'no-account') return html`${base}（文字）。以帳號登入才會保存錄音。`;
    if (saved.audio === 'failed') return html`${base}，但錄音上傳失敗：${saved.error ?? ''}`;
    return `${base}（文字）。`;
  }

  function ask(text: string, during: Phase, after: Phase) {
    phase = during;
    mic?.setMuted(true);
    render();
    const court = $('.drill-court', container)!;
    setAllJudges(court, 'listening');
    setJudgeState(court, asker, 'lean');
    setTimeout(() => {
      if (signal.aborted || phase !== during) return;
      setJudgeState(court, asker, 'speaking');
      cancelTTS = speakAs(text, asker, () => {
        cancelTTS = null;
        if (signal.aborted || phase !== during) return;
        setJudgeState(court, asker, 'listening');
        phase = after;
        ansStart = performance.now();
        mic?.setMuted(false);
        refreshStatus();
      });
    }, 650);
  }

  function refreshStatus() {
    const s = $('#drill-status', container);
    if (s) s.textContent = statusText();
    $('#drill-mic', container)?.classList.toggle('live', phase === 'answer' || phase === 'answer2');
    const c = $('#drill-caption', container);
    if (c) c.innerHTML = captionHtml();
    const court = $('.drill-court', container);
    if (court) court.dataset.phase = phase;
  }

  function tick() {
    const lvl = mic?.level() ?? 0;
    const el = $('#drill-lvl', container);
    if (el) el.style.transform = `scale(${1 + lvl * 0.9})`;
    if (!mic || (phase !== 'answer' && phase !== 'answer2')) return;
    const sec = (performance.now() - ansStart) / 1000;
    const text = phase === 'answer' ? answer1 : answer2;
    const s = $('#drill-status', container);
    if (s) s.textContent = `${statusText()} · ${fmtClock(sec)}`;
    if ((text && sec > 3 && mic.silenceMs() > 2500) || sec > 120) endAnswer(sec);
  }

  async function endAnswer(sec: number) {
    mic?.setMuted(true);
    if (phase === 'answer') {
      ans1Sec = sec;
      const short = answer1.split(/\s+/).length < 45;
      if (q && (short || Math.random() < 0.55)) {
        phase = 'thinking';
        refreshStatus();
        const court = $('.drill-court', container)!;
        setJudgeState(court, asker, 'writing');
        followText = await makeFollowUp(q, answer1);
        if (signal.aborted || phase !== 'thinking') return;
        if (judges > 1 && Math.random() < 0.5) asker = (asker + 1) % judges;
        ask(followText, 'followup', 'answer2');
        return;
      }
    } else {
      ans2Sec = sec;
    }
    score();
  }

  async function makeFollowUp(x: BenchQuestion, ans: string): Promise<string> {
    abort = new AbortController();

    // 1. Official follow-up if available and strictly English
    let off = x.followUp && !/[\u4e00-\u9fa5]/.test(x.followUp) ? x.followUp : OFFICIAL_FOLLOWUPS[x.id]?.en;
    if (off && Math.random() < 0.7) {
      followSource = 'official';
      return off.trim().replace(/^Counsel,?\s*/i, 'Counsel, ');
    }

    // 2. Call AI follow-up (supports Claude cloud and local LLM)
    const eng = getJudgeEngineStatus();
    if (eng.engine === 'claude' || eng.isLocalLLM) {
      try {
        const out = await Promise.race([
          generateFollowUpQuestion(x, ans, abort.signal),
          new Promise<string>((r) => setTimeout(() => r(''), 9000)),
        ]);
        const m = out.match(/[“"]([^”"]*[A-Za-z][^”"]*)[”"]/);
        const en = (m ? m[1] : out.split('\n').find((l) => /^[A-Za-z"“]/.test(l.trim())) || '').trim();
        if (en && !/[一-鿿]/.test(en)) {
          followSource = 'ai';
          return en.replace(/^Counsel,?\s*/i, 'Counsel, ');
        }
      } catch {}
    }

    if (off) {
      followSource = 'official';
      return off.trim().replace(/^Counsel,?\s*/i, 'Counsel, ');
    }

    followSource = 'generic';
    return pick(GENERIC_FOLLOWUPS)!;
  }

  async function score() {
    if (!q) return;
    phase = 'scoring';
    refreshStatus();
    const court = $('.drill-court', container);
    if (court) setAllJudges(court, 'writing');
    const full = [answer1, answer2].filter(Boolean).join(' ');
    abort = new AbortController();
    const blobP = mic?.stopRecording() ?? Promise.resolve(null);
    evalRes = await evaluateAnswer(q, full || '(no answer)', {
      durationSec: Math.max(1, ans1Sec + ans2Sec),
      pausesCount: 0,
      silenceTotalSec: 0,
    }, abort.signal, followText ? { firstAnswer: answer1, followUp: followText, followAnswer: answer2 } : undefined);
    if (signal.aborted) return;
    evalRes.totalScore = Math.max(0, evalRes.totalScore - hints * 4);
    const prevBest = scores[q.id];
    scores[q.id] = Math.max(scores[q.id] ?? 0, evalRes.totalScore);
    saveBenchScores(scores);
    streak = { n: streak.n + 1, sum: streak.sum + evalRes.totalScore };
    recBlob = await blobP;
    saved = null;
    phase = 'result';
    render();
    const r = evalRes;
    const x = q;
    saved = await saveRecord(
      {
        kind: 'bench',
        side,
        target_id: x.id,
        title: x.title,
        score: r.totalScore,
        duration_sec: Math.round((performance.now() - qStarted) / 1000),
        engine: r.engineName ?? '離線規則引擎',
        transcript: [`Q: ${x.questionEn}`, `A: ${answer1}`, followText ? `Q2: ${followText}` : '', followText ? `A2: ${answer2}` : ''].filter(Boolean).join('\n'),
        detail: {
          question: x.questionEn,
          answer1, answer2, followUp: followText, followSource,
          ans1Sec: Math.round(ans1Sec), ans2Sec: Math.round(ans2Sec),
          hints, hintSec: Math.round(hintSec),
          scores: { legal: r.legalScore, direct: r.directScore, fluency: r.fluencyScore, strategy: r.strategyScore },
          wpm: r.wpm, fillers: r.fillerWordsCount,
          feedback: r.feedback,
        },
      },
      recBlob,
      audioReason('bench', { score: r.totalScore, prevBest }),
    );
    paintSave();
  }

  function paintSave() {
    const el = $('#drill-save', container);
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

  function primary() {
    if (phase === 'ready' || phase === 'result') return void nextQuestion();
    if (phase === 'answer' || phase === 'answer2') return void endAnswer((performance.now() - ansStart) / 1000);
  }

  function hintStart() {
    if (!q || hintOn || phase === 'result' || phase === 'ready') return;
    hintOn = true;
    hints++;
    hintFrom = performance.now();
    $('#drill-hint', container)?.removeAttribute('hidden');
  }
  function hintEnd() {
    if (!hintOn) return;
    hintOn = false;
    hintSec += (performance.now() - hintFrom) / 1000;
    $('#drill-hint', container)?.setAttribute('hidden', '');
  }

  function reset() {
    cancelTTS?.();
    abort?.abort();
    q = null;
    phase = 'ready';
    buildDeck();
    render();
  }

  function bind() {
    $$<HTMLButtonElement>('[data-side]', container).forEach((b) =>
      b.addEventListener('click', () => {
        side = b.dataset.side as Side;
        savePrefs({ side });
        if (scope === 'match' && !fm()) scope = 'seat';
        reset();
      }),
    );
    $('#gen-q', container)?.addEventListener('click', async () => {
      await topUp(true);
      render();
    });
    $$<HTMLButtonElement>('[data-scope]', container).forEach((b) =>
      b.addEventListener('click', () => {
        scope = b.dataset.scope as Scope;
        reset();
      }),
    );
    $('[data-seat-toggle]', container)?.addEventListener('click', () => {
      seat = seat === 1 ? 2 : 1;
      savePrefs({ seat });
      reset();
    });
    $('#drill-mic', container)?.addEventListener('click', primary);
    const hb = $('#drill-hint', container);
    hb?.addEventListener('click', hintEnd);
    if (phase === 'result') paintSave();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) primary();
    } else if (e.key === 'h' || e.key === 'H') {
      if (!e.repeat) hintStart();
    } else if ((e.key === 'r' || e.key === 'R') && q && (phase === 'answer' || phase === 'answer2')) {
      const t = phase === 'answer2' ? followText : q.questionEn;
      ask(t, phase === 'answer2' ? 'followup' : 'asking', phase);
    } else if (e.key === 'ArrowRight') {
      cancelTTS?.();
      void mic?.stopRecording();
      abort?.abort();
      mic?.setMuted(true);
      phase = 'ready';
      void nextQuestion();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'h' || e.key === 'H') hintEnd();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  buildDeck();
  render();

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    if (poll) clearInterval(poll);
    cancelTTS?.();
    abort?.abort();
    mic?.stop();
  };
}
