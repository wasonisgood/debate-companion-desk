/**
 * 對戰準備 Match preparation — one workspace per scheduled round.
 *
 *   賽程      rounds for our team (import the organiser's schedule), facts (SAF)
 *   1 書狀    the opponent memorial as numbered ¶ with footnotes; offline
 *             cross-check of what they cite / concede vs. our script
 *   2 導讀    guided reading: argument by argument, think first, then compare;
 *             predicted courtroom lines can be heard aloud
 *   3 應對    risks (write your own response before seeing the suggestion),
 *             points for us, priorities, things to verify
 *   4 稿件    fixes located in our script and applied in one click, arguments to
 *             add, expected attacks, time plan vs. the script, rebuttal points
 *   5 演練    bench Q&A into the drill bank, spoken rebuttal drill, 3-minute
 *             rebuttal, re-drill of changed script units, drill focus
 *
 * Content comes from the team's own Word analyses, Claude / the local model,
 * the offline cross-check, or typing. Saved on this device with the bank;
 * managers publish it for the team.
 */
import { html, raw, $, $$ } from '../../lib/dom';
import { loadDebateData, saveDebateData, onSyncStatus, debateBank, type DebateData } from '../../lib/debateStorage';
import { fileToBlocks, pdfLines, textToBlocks, buildDocx, download, type OutBlock } from '../../lib/docx';
import {
  type MatchPrep, type Source, type Fix, type Level, type PrepStep,
  matchesOf, prepMeta, blankMatch, matchTitle, progress, parseSchedule, fixturesFor, splitMemorial, crossCheck,
  importAnalysis, locateFix, runPrepAI, mergeAI, qaToBench, gradeRebuttal, timingCheck, markChanged, changedUnits,
  activeMatchId, setActiveMatch, type RebutGrade,
} from '../../lib/matchPrep';
import { blocksText } from '../../lib/docx';
import { resolveEngine, engineDescription } from '../../lib/debateAI';
import { sttNote } from '../../lib/stt';
import { oralOf, SEAT_INFO, fmtClock, speakAs, startLiveMic, hasSpeechRecognition, shortSection, type LiveMic, type Side, REBUTTAL_MIN } from '../../lib/mootCourt';

type Step = 'memorial' | 'read' | 'assess' | 'script' | 'drill';
const STEPS: [Step, string, string][] = [
  ['memorial', '1 書狀', '匯入對方書狀，逐段閱讀'],
  ['read', '2 導讀', '對方每段在主張什麼、會怎麼說'],
  ['assess', '3 應對評估', '風險、有利點、優先序'],
  ['script', '4 稿件調整', '修正我方口說稿'],
  ['drill', '5 演練', '法官題、反駁演練'],
];
const SRC: Record<Source, string> = { word: 'Word', ai: 'AI', auto: '自動', me: '自己' };
const LEVELS: Level[] = ['高', '中高', '中', '低'];
const STEP_KEY = 'debate_prep_step_v1';

/* ---------------------------------------------------------------- card specs */

type Kind = 'line' | 'text' | 'en' | 'level' | 'strength' | 'num';
interface Spec { title: string; path: (m: MatchPrep) => any[]; fields: [string, string, Kind][]; blank: () => any; }
const SPECS: Record<string, Spec> = {
  claims: { title: '對方論點', path: (m) => m.reading.claims, fields: [['issue', '爭點', 'line'], ['claim', '對方主張', 'text'], ['paras', '書狀段落（例：¶24–29）', 'line'], ['predict', '預測庭上說法（英文）', 'en'], ['strength', '對方強度', 'strength']], blank: () => ({ issue: '', claim: '', paras: '', predict: '', src: 'me' }) },
  admissions: { title: '對方的承認', path: (m) => m.reading.admissions, fields: [['text', '原文／摘要', 'text'], ['paras', '段落', 'line'], ['use', '口說怎麼用', 'text']], blank: () => ({ text: '', paras: '', use: '', src: 'me' }) },
  pros: { title: '對我方有利', path: (m) => m.assess.pros, fields: [['point', '有利點', 'text'], ['basis', '依據', 'line'], ['use', '口說運用', 'text']], blank: () => ({ point: '', basis: '', use: '', src: 'me' }) },
  cons: { title: '對我方不利', path: (m) => m.assess.cons, fields: [['risk', '風險', 'line'], ['detail', '說明', 'text'], ['level', '等級', 'level'], ['response', '建議應對', 'text']], blank: () => ({ risk: '', detail: '', level: '中', response: '', src: 'me' }) },
  attacks: { title: '預期攻擊與應對', path: (m) => m.script.attacks, fields: [['claim', '對方論點', 'text'], ['response', '我方應對要點', 'text'], ['cite', '引用', 'line']], blank: () => ({ claim: '', response: '', cite: '', src: 'me' }) },
  timing: { title: '時間分配', path: (m) => m.script.timing, fields: [['part', '段落', 'line'], ['minutes', '建議分鐘', 'num'], ['focus', '重點', 'text']], blank: () => ({ part: '', minutes: 1, focus: '', src: 'me' }) },
  qa: { title: '法官可能的問題', path: (m) => m.script.qa, fields: [['question', '問題', 'text'], ['en', '英文問句（法官語音用）', 'en'], ['answer', '建議回答重點', 'text'], ['avoid', '避免的說法', 'text'], ['sampleEn', '參考答案（英文）', 'en']], blank: () => ({ question: '', answer: '', avoid: '', src: 'me' }) },
  fixes: { title: '稿件修正', path: (m) => m.script.fixes, fields: [['where', '位置', 'line'], ['current', '現稿寫法（逐字）', 'en'], ['problem', '問題', 'text'], ['suggest', '建議修改', 'text'], ['replacement', '替換成（英文，可直接套用）', 'en']], blank: () => ({ where: '', current: '', problem: '', suggest: '', replacement: '', status: 'open', src: 'me' }) },
};
const LISTS: Record<string, [string, (m: MatchPrep) => string[]]> = {
  summary: ['核心結論', (m) => m.reading.summary],
  gaps: ['對方未處理的事項', (m) => m.reading.gaps],
  priorities: ['處理優先序', (m) => m.assess.priorities],
  directions: ['調整的整體方向', (m) => m.script.directions],
  rebuttal: ['反駁要點（依序）', (m) => m.script.rebuttal],
  reminders: ['臨場提醒', (m) => m.script.reminders],
};
const CHECKS: Record<string, [string, (m: MatchPrep) => { text: string; done: boolean; src: Source }[]]> = {
  verify: ['使用前需核對', (m) => m.assess.verify],
  additions: ['口說中應新增的論點', (m) => m.script.additions],
};

/** ¶ numbers mentioned in a string: "¶24–29、¶45" → [24..29, 45]. */
function paraNums(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/¶{1,2}\s*(\d+)(?:\s*[–\-~～]\s*(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= Math.min(b, a + 40); i++) out.push(i);
  }
  return out;
}

export default function renderPrep(container: HTMLElement, signal: AbortSignal) {
  let data: DebateData = loadDebateData();
  const qs = new URL(location.href).searchParams;
  let activeId = qs.get('match') || activeMatchId() || matchesOf(data)[0]?.id || '';
  let step: Step = (qs.get('step') as Step) || ((() => { try { return localStorage.getItem(STEP_KEY) as Step; } catch { return null; } })() ?? 'memorial');
  if (!STEPS.some(([k]) => k === step)) step = 'memorial';
  let editing = '';
  let busy = '';
  let msg = '';
  let msgWarn = false;
  let guided = 0; // index in the guided reading walk; -1 = list view
  let walkReveal = false;
  let paraOpen = new Set<string>();
  let memQuery = '';
  let saveTimer: number | undefined;
  // rebuttal drill
  let drill: { kind: 'claim' | 'full'; idx: number; phase: 'idle' | 'listen' | 'speak' | 'grade' | 'done'; text: string; interim: string; start: number; grade: RebutGrade | null } = { kind: 'claim', idx: 0, phase: 'idle', text: '', interim: '', start: 0, grade: null };
  let mic: LiveMic | null = null;
  let cancelTTS: (() => void) | null = null;
  let tick: number | undefined;
  let beginNow: (() => void) | null = null;

  const match = () => matchesOf(data).find((m) => m.id === activeId) ?? null;
  const canManage = () => !!debateBank()?.can_manage;

  const unsubSync = onSyncStatus((st, info) => {
    if (signal.aborted) return;
    if (st === 'saving') {
      note('正在自動同步至雲端…');
    } else if (st === 'synced') {
      note(`✓ 已自動同步至雲端 ${info || ''}`);
    } else if (st === 'error') {
      note(`⚠ ${info || '雲端同步失敗'}（本機已暫存）`, true);
    }
  });
  signal.addEventListener('abort', unsubSync, { once: true });

  /* ------------------------------------------------------------ persistence */

  function persist() {
    try {
      saveDebateData(data);
    } catch (e: any) {
      note(e?.message ?? '儲存失敗', true);
    }
  }
  function touch(m?: MatchPrep | null) {
    if (m) m.updatedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 400);
  }
  function note(t: string, warn = false) {
    msg = t;
    msgWarn = warn;
    const el = $('#prep-msg', container);
    if (el) { el.textContent = t; el.classList.toggle('warn', warn); }
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (signal.aborted) return;
    const m = match();
    const meta = prepMeta(data);
    container.innerHTML = html`
      <div class="prep">
        ${raw(scheduleBar(meta))}
        <p class="prep-msg mono ${msgWarn ? 'warn' : ''}" id="prep-msg" aria-live="polite">${msg}</p>
        ${m ? raw(matchView(m)) : raw(emptyView())}
      </div>`;
    if (m && step === 'drill') paintDrill();
  }

  function scheduleBar(meta: ReturnType<typeof prepMeta>): string {
    const list = [...matchesOf(data)].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const now = Date.now();
    return html`
      <section class="prep-sched">
        <div class="prep-sched-head">
          <h2>賽程與對手</h2>
          <label class="mono dim">我方隊號 <input type="text" id="team" value="${meta.team}" placeholder="04" size="4" spellcheck="false"></label>
          <button class="btn ghost small" data-act="pick-schedule">匯入賽程表（PDF／Word）</button>
          <button class="btn ghost small" data-act="add-match">＋ 新增場次</button>
          <button class="btn ghost small" data-act="pick-facts" title="所有場次共用，AI 分析時一併參考">${meta.facts ? `事實段：${meta.factsName || '已匯入'}（${Math.round(meta.facts.length / 1000)}k 字元）` : '匯入事實段（SAF）'}</button>
          <input type="file" id="file-schedule" accept=".pdf,.docx,.txt" hidden>
          <input type="file" id="file-facts" accept=".pdf,.docx,.txt,.md" hidden>
        </div>
        ${list.length
          ? raw(html`<ol class="prep-matches">${list.map((x) => {
              const p = progress(x);
              const t = x.date ? new Date(`${x.date}T${(x.time.split('–')[0] || '09:00').padStart(5, '0')}`).getTime() : 0;
              const days = t ? Math.ceil((t - now) / 86_400_000) : null;
              const dots = [p.memorial, p.reading, p.assess, p.script, p.drill];
              return raw(html`<li><button class="prep-match ${x.id === activeId ? 'on' : ''}" data-match="${x.id}">
                <span class="mono dim">${x.round || '場次'}${x.id === activeMatchId() ? ' · 演練焦點' : ''}</span>
                <b>${matchTitle(x)}</b>
                <span class="prep-side ${x.ourSide}">${x.ourSide === 'prosecution' ? '我方檢方' : '我方辯方'}</span>
                <span class="mono dim">${x.date ? x.date.slice(5).replace('-', '/') : '日期未定'} ${x.time} ${x.room ? `· ${x.room}` : ''}${days != null ? ` · ${days > 0 ? `${days} 天後` : days === 0 ? '今天' : '已結束'}` : ''}</span>
                <span class="prep-dots" aria-label="準備進度">${dots.map((v, i) => raw(html`<i style="--p:${Math.round(v * 100)}%" title="${STEPS[i][1]} ${Math.round(v * 100)}%"></i>`))}</span>
              </button></li>`);
            })}</ol>`)
          : ''}
      </section>`;
  }

  function emptyView(): string {
    return html`
      <section class="hear-card prep-empty">
        <h3>從賽程開始</h3>
        <ol>
          <li>填入我方隊號（例：04），按「匯入賽程表」選主辦單位的賽程 PDF，系統會找出我方每一場的時間、教室與對手。也可以手動新增場次。</li>
          <li>每一場匯入對方書狀（PDF／Word），系統會切成編號段落並比對雙方引用。</li>
          <li>依序走過導讀 → 應對評估 → 稿件調整 → 演練。隊上已經寫好的 Word 分析（書狀分析、口說稿調整）可以直接匯入，表格會自動歸位。</li>
        </ol>
      </section>`;
  }

  function matchView(m: MatchPrep): string {
    const p = progress(m);
    const pv: Record<Step, number> = { memorial: p.memorial, read: p.reading, assess: p.assess, script: p.script, drill: p.drill };
    return html`
      <section class="prep-match-head">
        <div>
          <span class="kicker">${m.round || '場次'} · ${m.date} ${m.time} ${m.room ? `· ${m.room} 教室` : ''}</span>
          <h2>${matchTitle(m)} <small class="dim">我方 ${m.ourTeam || '—'}（${m.ourSide === 'prosecution' ? '檢方' : '辯方'}）對 ${m.oppTeam || '—'}</small></h2>
        </div>
        <div class="prep-head-actions">
          <button class="btn ghost small" data-act="pick-analysis" title="書狀分析、口說稿調整等 Word 檔，可一次選多個">匯入隊上分析（Word）</button>
          <button class="btn ghost small" data-act="export-prep">匯出整理（Word）</button>
          <button class="btn ghost small ${m.id === activeMatchId() ? 'on' : ''}" data-act="focus" title="單題攻防與模擬庭會優先出這一場的題目">${m.id === activeMatchId() ? '✓ 演練焦點' : '設為演練焦點'}</button>
          <input type="file" id="file-analysis" accept=".docx,.txt,.md" multiple hidden>
          ${step === 'memorial' ? '' : raw('<input type="file" id="file-memorial" accept=".pdf,.docx,.txt,.md" hidden>')}
        </div>
      </section>
      <details class="prep-meta">
        <summary class="mono dim">場次資料${m.sources.length ? ` · 來源：${m.sources.slice(-4).map((s) => s.name).join('、')}` : ''}</summary>
        <form id="meta-form" class="mg-row three" autocomplete="off">
          <label class="field"><span>輪次</span><input type="text" name="round" value="${m.round}"></label>
          <label class="field"><span>日期</span><input type="date" name="date" value="${m.date}"></label>
          <label class="field"><span>時間</span><input type="text" name="time" value="${m.time}" placeholder="10:00–11:40"></label>
          <label class="field"><span>教室</span><input type="text" name="room" value="${m.room}"></label>
          <label class="field"><span>我方立場</span><select name="ourSide"><option value="prosecution" ${m.ourSide === 'prosecution' ? raw('selected') : ''}>檢方</option><option value="defense" ${m.ourSide === 'defense' ? raw('selected') : ''}>辯方</option></select></label>
          <label class="field"><span>我方隊號</span><input type="text" name="ourTeam" value="${m.ourTeam}" placeholder="P04"></label>
          <label class="field"><span>對方隊號</span><input type="text" name="oppTeam" value="${m.oppTeam}" placeholder="D01"></label>
        </form>
        <p><button class="btn ghost small danger" data-act="del-match">刪除這個場次</button></p>
      </details>
      ${raw(uploadChecklist(m))}
      <nav class="prep-steps" aria-label="準備步驟">
        ${STEPS.map(([k, label, hint]) => raw(html`<button class="${k === step ? 'on' : ''}" data-step="${k}" title="${hint}"><b>${label}</b><span style="--p:${Math.round(pv[k] * 100)}%"></span></button>`))}
      </nav>
      <div class="prep-body">${raw(stepView(m))}</div>`;
  }

  /** What still has to be uploaded for this round, each with the button that does it. */
  function uploadChecklist(m: MatchPrep): string {
    const meta = prepMeta(data);
    const analyses = m.sources.filter((x) => /Word/.test(x.kind)).length;
    const ours = oralOf(data, m.ourSide).length;
    const rows: [boolean, string, string, string][] = [
      [!!meta.team && !!m.date, '賽程表', m.date ? `${m.date} ${m.time}` : '主辦單位的賽程 PDF', 'pick-schedule'],
      [!!meta.facts, '事實段（SAF）', meta.facts ? meta.factsName || '已匯入' : '題目的 Statement of Agreed Facts，所有場次共用', 'pick-facts'],
      [!!m.memorial, `對方書狀（${m.oppTeam || '對手'}）`, m.memorial ? m.memorial.name : '交換書狀拿到的 PDF 或 Word', 'pick-memorial'],
      [analyses > 0, '隊上的分析（Word，選填）', analyses ? `${analyses} 份` : '書狀分析、口說稿調整，可一次選多份', 'pick-analysis'],
      [ours > 0, `我方${m.ourSide === 'prosecution' ? '檢方' : '辯方'}口說稿`, ours ? `${ours} 段（Word 改過請到 Word 同步匯入）` : '到 題庫與稿件 → Word 同步 匯入', ''],
    ];
    const done = rows.filter((r) => r[0]).length;
    return html`<details class="prep-upload" ${done < rows.length ? raw('open') : ''}>
      <summary class="mono">要上傳的文件 ${done} / ${rows.length}</summary>
      <ol>${rows.map(([ok, name, hint, act]) => raw(html`<li class="${ok ? 'ok' : ''}"><b>${ok ? '✓' : '○'} ${name}</b> <span class="dim">${hint}</span>
        ${act ? raw(html`<button class="btn ghost small" data-act="${act}">${ok ? '更換' : '上傳'}</button>`) : raw('<a class="btn ghost small" href="/debate?tab=manage&sub=word">Word 同步</a>')}</li>`))}</ol>
    </details>`;
  }

  function stepView(m: MatchPrep): string {
    switch (step) {
      case 'memorial': return memorialView(m);
      case 'read': return readView(m);
      case 'assess': return assessView(m);
      case 'script': return scriptView(m);
      case 'drill': return drillView(m);
    }
  }

  function aiBar(m: MatchPrep, s: PrepStep, label: string, what: string): string {
    const eng = resolveEngine();
    const can = eng !== 'rules';
    const need = s !== 'script' && !m.memorial;
    return html`<div class="prep-ai">
      <button class="btn primary small" data-ai="${s}" ${busy || !can || need ? raw('disabled') : ''}>${busy === s ? 'AI 分析中…' : label}</button>
      <span class="mono dim">${need ? '先在「1 書狀」匯入對方書狀' : can ? `${engineDescription(eng, 'evaluate').replace(/（雲端）$/, '')} · ${what}${prepMeta(data).facts ? '' : ' · 建議先匯入事實段，AI 才能引用事實段號'}` : '沒有可用的 AI：用帳號登入使用 Claude，或在「本地模型」頁設定。仍可匯入 Word 分析或自行填寫。'}</span>
    </div>`;
  }

  /* ---------------- 1 memorial */

  function memorialView(m: MatchPrep): string {
    const mem = m.memorial;
    const upload = html`<div class="prep-drop" data-drop="memorial">
      <p><b>${mem ? '更換對方書狀' : '匯入對方書狀'}</b> <span class="dim">PDF、Word 或純文字；拖曳到這裡或</span>
      <button class="btn ghost small" data-act="pick-memorial">選擇檔案…</button></p>
      <details><summary class="mono dim">或貼上全文</summary><textarea id="mem-paste" rows="5" class="latin" placeholder="1. The crimes charged in both Counts…"></textarea><button class="btn small" data-act="paste-memorial">讀取</button></details>
      <input type="file" id="file-memorial" accept=".pdf,.docx,.txt,.md" hidden>
    </div>`;
    if (!mem) return upload;
    const cc = crossCheck(mem, oralOf(data, m.ourSide));
    const needle = memQuery.trim().toLowerCase();
    const paras = mem.paras.filter((p) => !needle || `${p.n} ${p.text} ${p.head}`.toLowerCase().includes(needle));
    let lastHead = '';
    const heads = [...new Set(mem.paras.map((p) => p.head).filter(Boolean))];
    return html`
      ${raw(upload)}
      <div class="prep-mem">
        <aside class="prep-toc">
          <p class="mono dim">${mem.name} · ${mem.paras.filter((p) => p.n).length} 段 · 約 ${mem.words} 字 · 註腳 ${Object.keys(mem.notes).length}</p>
          <input type="search" id="mem-q" placeholder="搜尋書狀…" value="${memQuery}">
          <ol>${heads.map((h) => raw(html`<li><a href="#" data-goto-head="${h}">${h.split(' › ').pop()}</a></li>`))}</ol>
        </aside>
        <div class="prep-paras" id="prep-paras">
          ${paras.map((p) => {
            const h = p.head !== lastHead ? raw(html`<h4>${p.head.split(' › ').map((x, i) => raw(i ? html` › <span>${x}</span>` : html`<span class="dim">${x}</span>`))}</h4>`) : '';
            lastHead = p.head;
            return raw(html`${h}<p id="para-${p.n || 'x'}" data-head="${p.head}"><b class="mono">${p.n ? `¶${p.n}` : '·'}</b> ${raw(withNotes(p.text, mem.notes))}</p>`);
          })}
        </div>
        <aside class="prep-cc">
          <h4>離線比對 <small class="dim">不需 AI</small></h4>
          <p class="dim">對方引用、我方稿件沒提到的，標為「稿未提」。</p>
          ${raw(ccList('判例', cc.cases.map((c) => [c.name, c.paras, c.inOurs])))}
          ${raw(ccList('事實段', cc.facts.map((f) => [`Facts [${f.n}]`, f.paras, f.inOurs])))}
          ${raw(ccList('條文', cc.articles.slice(0, 18).map((c) => [c.name, c.paras, c.inOurs])))}
          <h5>可能的承認（${cc.admissions.length}）</h5>
          <ul class="prep-adm">${cc.admissions.slice(0, 10).map((a, i) => raw(html`<li><a href="#" data-goto-para="${a.paras.replace('¶', '')}" class="mono">${a.paras}</a> ${a.text.slice(0, 140)}${a.text.length > 140 ? '…' : ''} ${m.reading.admissions.some((x) => x.text === a.text) ? raw('<span class="dim">✓ 已加入</span>') : raw(html`<button class="linkish" data-add-adm="${i}">加入導讀</button>`)}</li>`))}</ul>
        </aside>
      </div>`;
  }

  function ccList(title: string, rows: [string, string[], boolean][]): string {
    if (!rows.length) return '';
    return html`<h5>${title}（${rows.length}）</h5><ul class="prep-cc-list">${rows.map(([n, ps, ours]) => raw(html`<li class="${ours ? '' : 'miss'}"><span>${n}</span> ${ps.slice(0, 6).map((p) => raw(html`<a href="#" class="mono" data-goto-para="${p}">¶${p}</a>`))}${ours ? '' : raw(' <em>稿未提</em>')}</li>`))}</ul>`;
  }

  function withNotes(text: string, notes: Record<string, string>): string {
    return html`${text}`.replace(/\^(\d{1,3})/g, (_m, n) => (notes[n] != null ? `<sup class="fn" title="${html`${notes[n]}`}">${n}</sup>` : `<sup>${n}</sup>`))
      .replace(/(SAF|Facts?)\s*,?\s*(¶{1,2}\s*[\d–\-, ]+)/g, '<mark>$1 $2</mark>');
  }

  /* ---------------- 2 reading */

  function readView(m: MatchPrep): string {
    const claims = m.reading.claims;
    const walk = guided >= 0 && claims.length;
    return html`
      ${raw(aiBar(m, 'read', 'AI 導讀', '依段落整理對方架構、預測庭上說法、找出承認與漏洞'))}
      ${raw(listBlock(m, 'summary'))}
      <section class="prep-sec">
        <header><h3>對方論點 <small class="dim">${claims.filter((c) => c.read).length} / ${claims.length} 已讀</small></h3>
          <div class="seg"><button class="${walk ? 'on' : ''}" data-act="walk">導讀模式</button><button class="${walk ? '' : 'on'}" data-act="listmode">清單</button></div>
          <button class="btn ghost small" data-add="claims">＋ 新增</button>
        </header>
        ${claims.length ? (walk ? raw(walkView(m)) : raw(cards(m, 'claims'))) : raw('<p class="dim">還沒有內容。按 AI 導讀、匯入隊上的書狀分析，或自己新增。</p>')}
      </section>
      <section class="prep-sec"><header><h3>對方的承認 <small class="dim">口說可直接引用：「對方書狀第 n 段承認……」</small></h3><button class="btn ghost small" data-add="admissions">＋ 新增</button></header>${raw(cards(m, 'admissions'))}</section>
      ${raw(listBlock(m, 'gaps'))}`;
  }

  /** One argument at a time: read their ¶, write your reaction, then compare with what the team has. */
  function walkView(m: MatchPrep): string {
    const claims = m.reading.claims;
    const i = Math.min(Math.max(0, guided), claims.length - 1);
    const c = claims[i];
    const nums = paraNums(c.paras);
    const mem = m.memorial;
    const linked = (s: string) => paraNums(s).some((n) => nums.includes(n));
    const rel = {
      adm: m.reading.admissions.filter((a) => linked(a.paras) || linked(a.text)),
      pros: m.assess.pros.filter((p) => linked(`${p.basis} ${p.point}`)),
      cons: m.assess.cons.filter((p) => linked(`${p.detail} ${p.risk}`)),
      att: m.script.attacks.filter((a) => linked(`${a.claim} ${a.cite}`)),
    };
    return html`
      <div class="prep-walk">
        <div class="prep-walk-nav mono">
          <button class="btn ghost small" data-walk="-1" ${i === 0 ? raw('disabled') : ''}>← 上一段</button>
          <span>${i + 1} / ${claims.length}</span>
          <button class="btn ghost small" data-walk="1" ${i >= claims.length - 1 ? raw('disabled') : ''}>下一段 →</button>
        </div>
        <article class="prep-walk-card">
          <span class="kicker">${c.issue} · ${c.paras}${c.strength ? ` · 對方強度 ${({ strong: '強', medium: '中', weak: '弱' } as const)[c.strength]}` : ''}</span>
          <p class="prep-claim">${c.claim}</p>
          ${mem && nums.length ? raw(html`<details open><summary class="mono dim">對方原文 ${c.paras}</summary>${nums.slice(0, 6).map((n) => { const p = mem.paras.find((x) => x.n === String(n)); return p ? raw(html`<p class="latin prep-quote"><b class="mono">¶${n}</b> ${raw(withNotes(p.text, mem.notes))}</p>`) : ''; })}</details>`) : ''}
          ${c.predict ? raw(html`<div class="prep-predict"><span class="mono dim">對方律師可能這樣說</span><p class="latin">“${c.predict}”</p><button class="btn ghost small" data-say="${i}">🔊 聽一次</button></div>`) : ''}
          <label class="field"><span>先自己想：這段最弱在哪？我們用哪個事實或承認回應？</span>
            <textarea rows="3" data-mine="claims:${i}" placeholder="寫下你的第一反應，再按「對照」">${c.mine ?? ''}</textarea></label>
          <div class="prep-walk-act">
            <button class="btn small" data-act="reveal">${walkReveal ? '收起對照' : '對照隊上與 AI 的分析'}</button>
            <label class="mono"><input type="checkbox" data-read="${i}" ${c.read ? raw('checked') : ''}> 已讀懂這段</label>
          </div>
          ${walkReveal ? raw(html`<div class="prep-reveal">
            ${rel.adm.length ? raw(html`<h5>可用的承認</h5><ul>${rel.adm.map((a) => raw(html`<li>${a.paras} ${a.text}${a.use ? raw(html` — <i>${a.use}</i>`) : ''}</li>`))}</ul>`) : ''}
            ${rel.att.length ? raw(html`<h5>應對要點</h5><ul>${rel.att.map((a) => raw(html`<li>${a.response} <span class="dim">${a.cite}</span></li>`))}</ul>`) : ''}
            ${rel.pros.length ? raw(html`<h5>對我方有利</h5><ul>${rel.pros.map((p) => raw(html`<li>${p.point} — <i>${p.use}</i></li>`))}</ul>`) : ''}
            ${rel.cons.length ? raw(html`<h5>要小心</h5><ul>${rel.cons.map((p) => raw(html`<li><b>${p.level}</b> ${p.risk}：${p.response}</li>`))}</ul>`) : ''}
            ${!rel.adm.length && !rel.att.length && !rel.pros.length && !rel.cons.length ? raw('<p class="dim">其他步驟中沒有引用到這幾段的內容。完成「3 應對評估」「4 稿件調整」後這裡會出現對照。</p>') : ''}
          </div>`) : ''}
        </article>
      </div>`;
  }

  /* ---------------- 3 assess */

  function assessView(m: MatchPrep): string {
    const cons = m.assess.cons.map((c, i) => ({ c, i })).sort((a, b) => LEVELS.indexOf(a.c.level) - LEVELS.indexOf(b.c.level));
    return html`
      ${raw(aiBar(m, 'assess', 'AI 應對評估', '有利點、風險等級與應對、優先序、需核對事項'))}
      <section class="prep-sec">
        <header><h3>對我方不利的點 <small class="dim">先寫你的應對，再看建議（${m.assess.cons.filter((c) => (c.mine ?? '').trim()).length} / ${m.assess.cons.length}）</small></h3><button class="btn ghost small" data-add="cons">＋ 新增</button></header>
        ${cons.length ? raw(cons.map(({ c, i }) => editing === `cons:${i}` ? cardForm('cons', i, c) : html`
          <article class="prep-card risk l${LEVELS.indexOf(c.level)}">
            <header><b class="prep-level">${c.level}</b><b>${c.risk}</b><span class="prep-src">${SRC[c.src]}</span>${raw(cardTools('cons', i))}</header>
            <p class="dim">${c.detail}</p>
            <label class="field"><span>你的應對</span><textarea rows="2" data-mine="cons:${i}" placeholder="先寫自己的回應方式">${c.mine ?? ''}</textarea></label>
            <details ${(c.mine ?? '').trim() ? raw('open') : ''}><summary class="mono dim">對照建議應對</summary><p>${c.response || '（尚無）'}</p></details>
          </article>`).join('')) : raw('<p class="dim">還沒有內容。</p>')}
      </section>
      <section class="prep-sec"><header><h3>對我方有利的點</h3><button class="btn ghost small" data-add="pros">＋ 新增</button></header>${raw(cards(m, 'pros'))}</section>
      ${raw(listBlock(m, 'priorities', true))}
      ${raw(checkBlock(m, 'verify'))}`;
  }

  /* ---------------- 4 script */

  function scriptView(m: MatchPrep): string {
    const units = oralOf(data, m.ourSide);
    const fixes = m.script.fixes;
    const auto = fixes.map((f, i) => ({ f, i, at: f.status === 'open' && f.replacement ? locateFix(f, units) : null })).filter((x) => x.at);
    const tc = timingCheck(units);
    return html`
      ${raw(aiBar(m, 'script', 'AI 稿件健檢', `以對方書狀與事實段檢查我方${m.ourSide === 'prosecution' ? '檢方' : '辯方'}稿（${units.length} 段）`))}
      <p class="prep-word-hint dim">口說稿在 Word 改好了？到 <a href="/debate?tab=manage&sub=word">題庫與稿件 → Word 同步</a> 匯入，系統會逐段比對差異、保留法官插問點，修改過的段落會在口說教練重新練習。</p>
      ${raw(listBlock(m, 'directions'))}
      <section class="prep-sec">
        <header><h3>必須修正的錯誤 <small class="dim">${fixes.filter((f) => f.status !== 'open').length} / ${fixes.length} 已處理</small></h3>
          ${auto.length ? raw(html`<button class="btn small" data-act="apply-all">一次套用 ${auto.length} 筆可自動替換的</button>`) : ''}
          <button class="btn ghost small" data-add="fixes">＋ 新增</button></header>
        ${fixes.length ? raw(fixes.map((f, i) => editing === `fixes:${i}` ? cardForm('fixes', i, f) : fixCard(m, f, i)).join('')) : raw('<p class="dim">還沒有內容。</p>')}
      </section>
      ${raw(checkBlock(m, 'additions'))}
      <section class="prep-sec"><header><h3>預期對方的攻擊與應對</h3><button class="btn ghost small" data-add="attacks">＋ 新增</button></header>${raw(cards(m, 'attacks'))}</section>
      <section class="prep-sec">
        <header><h3>時間分配</h3><button class="btn ghost small" data-add="timing">＋ 新增</button></header>
        ${raw(cards(m, 'timing'))}
        <table class="prep-time"><caption class="mono dim">目前稿件依 125 WPM 估算</caption>
          <thead><tr><th>章節</th><th>辯士</th><th>字數</th><th>估計</th></tr></thead>
          <tbody>${tc.map((r) => raw(html`<tr><td>${r.part}</td><td>${SEAT_INFO[r.seat as 1 | 2]?.zh ?? ''}</td><td class="num">${r.words}</td><td class="num">${fmtClock(r.sec)}</td></tr>`))}
          ${([1, 2] as const).map((s) => { const sec = tc.filter((r) => r.seat === s).reduce((a, r) => a + r.sec, 0); return raw(html`<tr class="${sec > SEAT_INFO[s].minutes * 60 ? 'over' : ''}"><th colspan="3">${SEAT_INFO[s].zh} 合計（上限 ${SEAT_INFO[s].minutes}′，未含法官提問）</th><td class="num">${fmtClock(sec)}</td></tr>`); })}
          </tbody></table>
      </section>
      ${raw(listBlock(m, 'rebuttal', true))}
      ${raw(listBlock(m, 'reminders'))}`;
  }

  function fixCard(m: MatchPrep, f: Fix, i: number): string {
    const units = oralOf(data, m.ourSide);
    const at = locateFix(f, units);
    const idx = at ? units.indexOf(at.unit) + 1 : 0;
    const ctx = at ? html`${at.unit.textEn.slice(Math.max(0, at.start - 80), at.start)}<mark>${at.unit.textEn.slice(at.start, at.end)}</mark>${at.unit.textEn.slice(at.end, at.end + 80)}` : '';
    return html`
      <article class="prep-card fix ${f.status}">
        <header><b>${f.where}</b><span class="prep-status">${({ open: '待處理', applied: '已修改', skipped: '略過' } as const)[f.status]}</span><span class="prep-src">${SRC[f.src]}</span>${raw(cardTools('fixes', i))}</header>
        <p class="latin"><s>${f.current}</s></p>
        <p><span class="mono dim">問題</span> ${f.problem}</p>
        <p><span class="mono dim">建議</span> ${f.suggest}</p>
        ${at ? raw(html`<p class="prep-ctx latin"><span class="mono dim">稿件第 ${idx} 段 · ${shortSection(at.unit.section)}</span> …${raw(ctx)}…</p>`) : raw('<p class="mono dim">在目前稿件中找不到這段文字（可能已改過，或寫法不同）。</p>')}
        ${editing === `fixedit:${i}` && at ? raw(html`<div class="prep-inline-edit"><textarea rows="6" class="latin" id="fix-text">${at.unit.textEn}</textarea>
          <button class="btn small primary" data-fix-save="${i}">儲存這段稿件</button> <button class="btn small ghost" data-act="cancel-edit">取消</button></div>`) : ''}
        <div class="prep-fix-act">
          ${f.status === 'open' && at && f.replacement ? raw(html`<button class="btn small" data-fix-apply="${i}" title="把標示的文字換成：${f.replacement}">套用：“${f.replacement.slice(0, 60)}${f.replacement.length > 60 ? '…' : ''}”</button>`) : ''}
          ${at ? raw(html`<button class="btn ghost small" data-fix-edit="${i}">在這裡改稿</button>`) : ''}
          ${f.status === 'open' ? raw(html`<button class="btn ghost small" data-fix-status="${i}:applied">標為已處理</button><button class="btn ghost small" data-fix-status="${i}:skipped">略過</button>`) : raw(html`<button class="btn ghost small" data-fix-status="${i}:open">重新打開</button>`)}
        </div>
      </article>`;
  }

  /* ---------------- 5 drill */

  function drillView(m: MatchPrep): string {
    const qa = m.script.qa;
    const inBank = qa.filter((q) => q.qid).length;
    const noEn = qa.filter((q) => !q.en && /[一-鿿]/.test(q.question)).length;
    const changed = changedUnits();
    const ours = oralOf(data, m.ourSide).filter((u) => changed[u.id]);
    const targets = rebutTargets(m);
    return html`
      <section class="prep-sec">
        <header><h3>法官可能的問題 <small class="dim">${qa.length} 題 · 已加入題庫 ${inBank}</small></h3>
          <button class="btn ghost small" data-add="qa">＋ 新增</button></header>
        ${raw(aiBar(m, 'qa', noEn ? `AI 補 ${noEn} 題英文問句與參考答案` : 'AI 產生法官題', '依對方主張預測法官會問的問題，附英文問句、架構與 35 秒參考答案'))}
        ${raw(cards(m, 'qa'))}
        <div class="prep-row">
          <button class="btn primary small" data-act="to-bench" ${qa.length && inBank < qa.length ? '' : raw('disabled')}>加入單題攻防題庫（${qa.length - inBank} 題）</button>
          ${inBank ? raw(html`<a class="btn ghost small" href="/debate?tab=bench&match=${m.id}">去單題攻防練這一場 →</a>`) : ''}
          ${noEn ? raw(html`<span class="mono dim">${noEn} 題只有中文：法官語音需要英文問句，可先用 AI 補上或自行填寫。</span>`) : ''}
        </div>
      </section>

      <section class="prep-sec">
        <header><h3>反駁演練 <small class="dim">聽對方律師的說法，直接用英文回應；AI 依隊上預定的應對評分</small></h3></header>
        ${targets.length ? raw(html`
        <div class="prep-row">
          <select id="rebut-pick" aria-label="選擇要反駁的論點">
            <option value="full" ${drill.kind === 'full' ? raw('selected') : ''}>完整 ${m.ourSide === 'prosecution' ? 'Rebuttal' : 'Sur-rebuttal'}（${REBUTTAL_MIN} 分鐘，依反駁要點）</option>
            ${targets.map((t, i) => raw(html`<option value="${i}" ${drill.kind === 'claim' && drill.idx === i ? raw('selected') : ''}>${t.label.slice(0, 70)}</option>`))}
          </select>
          <button class="btn primary small" id="rebut-go">${drill.phase === 'speak' ? '結束並評分' : drill.phase === 'listen' ? '略過，直接開始' : '開始'}</button>
        </div>
        <div class="prep-rebut" id="prep-rebut"></div>`) : raw('<p class="dim">先在「2 導讀」或「4 稿件調整」建立對方論點、預期攻擊或反駁要點。</p>')}
        ${sttNote() ? raw(html`<p class="mono dim">${sttNote()}也可以直接打字作答。</p>`) : ''}
      </section>

      <section class="prep-sec">
        <header><h3>稿件變更重練</h3></header>
        ${ours.length ? raw(html`<p>${m.ourSide === 'prosecution' ? '檢方' : '辯方'}稿有 <b>${ours.length}</b> 段最近修改過（Word 同步或套用修正），熟練度已退回「讀過」，口說教練會優先排入。</p>
          <ul class="prep-changed">${ours.slice(0, 12).map((u) => raw(html`<li><span class="mono dim">${shortSection(u.section)} · ${changed[u.id].why}</span> ${u.textEn.replace(/\[→[^\]]*\]/g, '').slice(0, 110)}…</li>`))}</ul>
          <a class="btn small" href="/debate?tab=memorize&changed=1">去口說教練重練這些段落 →</a>`)
          : raw('<p class="dim">目前沒有修改過、需要重練的段落。</p>')}
      </section>`;
  }

  function rebutTargets(m: MatchPrep) {
    const out: { label: string; claim: string; predict: string; response: string }[] = [];
    m.reading.claims.forEach((c) => {
      const nums = paraNums(c.paras);
      const plan = m.script.attacks.filter((a) => paraNums(`${a.claim} ${a.cite}`).some((n) => nums.includes(n))).map((a) => a.response);
      out.push({ label: `${c.paras} ${c.issue}：${c.claim}`, claim: `${c.issue}: ${c.claim}`, predict: c.predict || c.claim, response: [c.mine, ...plan].filter(Boolean).join('；') });
    });
    m.script.attacks.forEach((a) => {
      if (out.some((o) => o.response.includes(a.response))) return;
      out.push({ label: `攻擊：${a.claim}`, claim: a.claim, predict: a.claim, response: `${a.response} ${a.cite}` });
    });
    return out;
  }

  function paintDrill() {
    const el = $('#prep-rebut', container);
    const m = match();
    if (!el || !m) return;
    const t = drill.kind === 'full' ? null : rebutTargets(m)[drill.idx];
    const limit = drill.kind === 'full' ? REBUTTAL_MIN * 60 : 75;
    const sec = drill.start ? (Date.now() - drill.start) / 1000 : 0;
    const g = drill.grade;
    el.innerHTML = html`
      ${t ? raw(html`<p class="prep-predict"><span class="mono dim">對方律師</span> <span class="latin">“${t.predict}”</span></p>`) : raw(html`<ol class="prep-rebut-plan">${m.script.rebuttal.map((r) => raw(html`<li>${r}</li>`))}</ol>`)}
      ${drill.phase === 'speak' || drill.phase === 'listen' ? raw(html`<p class="prep-clock mono ${sec > limit ? 'over' : ''}">${drill.phase === 'listen' ? '對方發言中…' : `${fmtClock(sec)} / ${fmtClock(limit)}`}</p>`) : ''}
      ${drill.phase === 'speak' || drill.phase === 'grade' || drill.phase === 'done' ? raw(html`<label class="field"><span>你的回應${hasSpeechRecognition() ? '（語音辨識，可修改）' : '（請打字）'}</span><textarea id="rebut-text" rows="4" class="latin">${drill.text}${drill.interim ? ' ' + drill.interim : ''}</textarea></label>`) : ''}
      ${drill.phase === 'grade' ? raw('<p class="mono dim">評分中…</p>') : ''}
      ${g ? raw(html`<div class="prep-grade">
        <div class="coach-score"><b>${g.score}</b><span>/ 100 · ${g.engine}</span></div>
        ${g.note ? raw(html`<p>${g.note}</p>`) : ''}
        <div class="drill-fb"><div><span class="mono">做到了</span>${g.hit.map((x) => raw(html`<p>${x}</p>`))}</div><div><span class="mono">漏掉</span>${g.missed.map((x) => raw(html`<p>${x}</p>`))}</div></div>
        ${g.better ? raw(html`<details open><summary class="mono">示範回應</summary><p class="latin">${g.better}</p><button class="btn ghost small" data-say-text="${g.better}">🔊 聽示範</button></details>`) : ''}
        ${t?.response ? raw(html`<details><summary class="mono dim">隊上預定的應對</summary><p>${t.response}</p></details>`) : ''}
      </div>`) : ''}`;
  }

  async function startRebut() {
    const m = match();
    if (!m) return;
    const t = drill.kind === 'full' ? null : rebutTargets(m)[drill.idx];
    drill = { ...drill, phase: 'listen', text: '', interim: '', start: 0, grade: null };
    render();
    const begin = async () => {
      cancelTTS = null;
      beginNow = null;
      if (signal.aborted || drill.phase !== 'listen') return;
      drill.phase = 'speak';
      drill.start = Date.now();
      if (hasSpeechRecognition()) {
        try {
          mic = await startLiveMic({
            onFinal: (x) => { drill.text = (drill.text + ' ' + x).trim(); drill.interim = ''; syncText(); },
            onInterim: (x) => { drill.interim = x; syncText(); },
          });
        } catch (e: any) { note(`無法使用麥克風：${e?.message ?? e}`, true); }
      }
      render();
      tick = window.setInterval(() => {
        const limit = drill.kind === 'full' ? REBUTTAL_MIN * 60 : 75;
        const c = $('.prep-clock', container);
        const sec = (Date.now() - drill.start) / 1000;
        if (c) { c.textContent = `${fmtClock(sec)} / ${fmtClock(limit)}`; c.classList.toggle('over', sec > limit); }
        if (sec > limit + 15) finishRebut();
      }, 500);
    };
    beginNow = () => void begin();
    if (t) cancelTTS = speakAs(t.predict, 1, begin, 1);
    else void begin();
  }
  function syncText() {
    const ta = $<HTMLTextAreaElement>('#rebut-text', container);
    if (ta && document.activeElement !== ta) ta.value = `${drill.text}${drill.interim ? ' ' + drill.interim : ''}`;
  }
  async function finishRebut() {
    const m = match();
    if (!m || drill.phase !== 'speak') return;
    clearInterval(tick);
    mic?.stop();
    mic = null;
    const ta = $<HTMLTextAreaElement>('#rebut-text', container);
    if (ta) drill.text = ta.value.trim();
    drill.interim = '';
    const sec = (Date.now() - drill.start) / 1000;
    drill.phase = 'grade';
    paintDrill();
    const t = drill.kind === 'full'
      ? { claim: `Full ${m.ourSide === 'prosecution' ? 'rebuttal' : 'sur-rebuttal'} against ${m.oppTeam}`, predict: '', response: m.script.rebuttal.join('；') }
      : rebutTargets(m)[drill.idx];
    try {
      drill.grade = await gradeRebuttal(m, t, drill.text, sec, signal);
    } catch (e: any) {
      note(e?.message ?? '評分失敗', true);
    }
    drill.phase = 'done';
    render();
  }
  function stopDrill() {
    clearInterval(tick);
    beginNow = null;
    cancelTTS?.();
    cancelTTS = null;
    mic?.stop();
    mic = null;
  }

  /* ---------------- generic blocks */

  function cardTools(key: string, i: number): string {
    return html`<span class="prep-tools"><button class="linkish" data-edit="${key}:${i}" title="編輯">✎</button><button class="linkish danger" data-del="${key}:${i}" title="刪除">✕</button></span>`;
  }

  function cards(m: MatchPrep, key: string): string {
    const spec = SPECS[key];
    const arr = spec.path(m);
    if (!arr.length) return html`<p class="dim">還沒有內容。</p>`;
    return arr.map((x, i) => {
      if (editing === `${key}:${i}`) return cardForm(key, i, x);
      const [first, ...rest] = spec.fields;
      return html`<article class="prep-card">
        <header><b class="${first[2] === 'en' ? 'latin' : ''}">${String(x[first[0]] ?? '')}</b>
          ${x.level ? raw(html`<b class="prep-level">${x.level}</b>`) : ''}${x.qid ? raw(html`<span class="chip">${x.qid}</span>`) : ''}
          <span class="prep-src">${SRC[x.src as Source] ?? ''}</span>${raw(cardTools(key, i))}</header>
        <dl>${rest.filter(([k]) => x[k] != null && String(x[k]).trim() !== '' && k !== 'level').map(([k, label, kind]) => raw(html`<dt>${label}</dt><dd class="${kind === 'en' ? 'latin' : ''}">${String(x[k])}${k === 'predict' || k === 'en' ? raw(html` <button class="linkish" data-say-text="${String(x[k])}" title="朗讀">🔊</button>`) : ''}</dd>`))}</dl>
      </article>`;
    }).join('');
  }

  function cardForm(key: string, i: number, x: any): string {
    const spec = SPECS[key];
    return html`<form class="prep-card editing" data-form="${key}:${i}" autocomplete="off">
      ${spec.fields.map(([k, label, kind]) => raw(html`<label class="field"><span>${label}</span>${raw(
        kind === 'level' ? html`<select name="${k}">${LEVELS.map((l) => raw(html`<option ${x[k] === l ? raw('selected') : ''}>${l}</option>`))}</select>`
        : kind === 'strength' ? html`<select name="${k}"><option value="">—</option>${(['strong', 'medium', 'weak'] as const).map((l) => raw(html`<option value="${l}" ${x[k] === l ? raw('selected') : ''}>${({ strong: '強', medium: '中', weak: '弱' })[l]}</option>`))}</select>`
        : kind === 'num' ? html`<input type="number" step="0.5" min="0" name="${k}" value="${x[k] ?? ''}">`
        : kind === 'line' ? html`<input name="${k}" value="${x[k] ?? ''}">`
        : html`<textarea name="${k}" rows="${kind === 'en' ? 3 : 2}" class="${kind === 'en' ? 'latin' : ''}">${x[k] ?? ''}</textarea>`)}</label>`))}
      <footer><button class="btn small primary" type="submit">完成</button> <button class="btn small ghost" type="button" data-act="cancel-edit">取消</button></footer>
    </form>`;
  }

  function listBlock(m: MatchPrep, key: string, ordered = false): string {
    const [title, get] = LISTS[key];
    const arr = get(m);
    if (editing === `list:${key}`)
      return html`<section class="prep-sec"><header><h3>${title}</h3></header>
        <form data-listform="${key}"><textarea name="v" rows="${Math.max(4, arr.length + 2)}" placeholder="一行一項">${arr.join('\n')}</textarea>
        <footer><button class="btn small primary" type="submit">完成</button> <button class="btn small ghost" type="button" data-act="cancel-edit">取消</button></footer></form></section>`;
    const tag = ordered ? 'ol' : 'ul';
    return html`<section class="prep-sec"><header><h3>${title}</h3><button class="btn ghost small" data-edit="list:${key}">${arr.length ? '✎ 編輯' : '＋ 新增'}</button></header>
      ${arr.length ? raw(`<${tag} class="prep-list">${arr.map((x) => html`<li>${x}</li>`).join('')}</${tag}>`) : raw('<p class="dim">還沒有內容。</p>')}</section>`;
  }

  function checkBlock(m: MatchPrep, key: string): string {
    const [title, get] = CHECKS[key];
    const arr = get(m);
    if (editing === `check:${key}`)
      return html`<section class="prep-sec"><header><h3>${title}</h3></header>
        <form data-checkform="${key}"><textarea name="v" rows="${Math.max(4, arr.length + 2)}" placeholder="一行一項">${arr.map((x) => x.text).join('\n')}</textarea>
        <footer><button class="btn small primary" type="submit">完成</button> <button class="btn small ghost" type="button" data-act="cancel-edit">取消</button></footer></form></section>`;
    return html`<section class="prep-sec"><header><h3>${title} <small class="dim">${arr.filter((x) => x.done).length} / ${arr.length}</small></h3><button class="btn ghost small" data-edit="check:${key}">${arr.length ? '✎ 編輯' : '＋ 新增'}</button></header>
      ${arr.length ? raw(html`<ul class="prep-checks">${arr.map((x, i) => raw(html`<li><label><input type="checkbox" data-check="${key}:${i}" ${x.done ? raw('checked') : ''}> <span>${x.text}</span></label></li>`))}</ul>`) : raw('<p class="dim">還沒有內容。</p>')}</section>`;
  }

  /* ------------------------------------------------------------ actions */

  async function importSchedule(file: File) {
    const team = prepMeta(data).team.trim();
    if (!team) { note('先填我方隊號（例：04）。', true); $<HTMLInputElement>('#team', container)?.focus(); return; }
    note('讀取賽程表…');
    try {
      const blocks = file.name.toLowerCase().endsWith('.pdf') ? await pdfLines(file) : await fileToBlocks(file);
      const lines = blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.rows.map((r) => r.join(' '))));
      const fx = fixturesFor(team, parseSchedule(lines));
      if (!fx.length) return note(`賽程表中找不到第 ${team} 隊的場次（格式需為「P04 v. D01」）。可改用「新增場次」手動建立。`, true);
      let added = 0;
      let updated = 0;
      for (const f of fx) {
        const ex = matchesOf(data).find((x) => x.ourTeam === f.ourTeam && x.oppTeam === f.oppTeam);
        if (ex) { Object.assign(ex, { round: f.round || ex.round, date: f.date || ex.date, time: f.time || ex.time, room: f.room || ex.room }); updated++; }
        else { const m = blankMatch(f); m.sources.push({ name: file.name, kind: '賽程表', at: Date.now() }); matchesOf(data).push(m); added++; if (!activeId) activeId = m.id; }
      }
      persist();
      msg = `賽程表：新增 ${added} 場${updated ? `、更新 ${updated} 場` : ''}（只列出第 ${team} 隊）。準決賽與決賽對手公布後，再匯入一次新的賽程表即可。`;
      msgWarn = false;
      render();
    } catch (e: any) { note(`讀取失敗：${e?.message ?? e}`, true); }
  }

  async function importFacts(file: File) {
    note('讀取事實段…');
    try {
      const t = blocksText(await fileToBlocks(file));
      const meta = prepMeta(data);
      meta.facts = t.slice(0, 120_000);
      meta.factsName = file.name;
      persist();
      msg = `事實段已匯入（${Math.round(t.length / 1000)}k 字元），所有場次的 AI 分析都會參考。`;
      msgWarn = false;
      render();
    } catch (e: any) { note(`讀取失敗：${e?.message ?? e}`, true); }
  }

  async function importMemorial(m: MatchPrep, file: File | null, text = '') {
    note('讀取書狀…');
    try {
      const blocks = file ? await fileToBlocks(file) : textToBlocks(text);
      const mem = splitMemorial(blocks, file?.name ?? '貼上的文字');
      if (!mem.paras.length) return note('讀不到段落，請確認檔案內容。', true);
      if (m.memorial && !confirm(`取代目前的書狀「${m.memorial.name}」？導讀與評估內容會保留。`)) return note('');
      m.memorial = mem;
      m.sources.push({ name: mem.name, kind: '對方書狀', at: Date.now() });
      touch(m);
      persist();
      const numbered = mem.paras.filter((p) => p.n).length;
      msg = `已匯入 ${mem.name}：${numbered} 個編號段落、${Object.keys(mem.notes).length} 個註腳。${numbered < 5 ? '編號段落很少，可能是掃描檔或格式特殊，搜尋與 AI 仍可使用全文。' : ''}`;
      msgWarn = false;
      render();
    } catch (e: any) { note(`讀取失敗：${e?.message ?? e}`, true); }
  }

  async function importAnalyses(m: MatchPrep, files: File[]) {
    const parts: string[] = [];
    for (const f of files) {
      try {
        const r = importAnalysis(m, await fileToBlocks(f), f.name);
        const n = Object.values(r.added).reduce((a, b) => a + b, 0);
        parts.push(`${f.name}：${n ? Object.entries(r.added).map(([k, v]) => `${SPECS[k]?.title ?? LISTS[k]?.[0] ?? CHECKS[k]?.[0] ?? k} ${v}`).join('、') : '沒有可辨識的表格或清單'}`);
      } catch (e: any) { parts.push(`${f.name}：讀取失敗（${e?.message ?? e}）`); }
    }
    touch(m);
    persist();
    msg = `匯入完成。${parts.join('；')}`;
    msgWarn = false;
    render();
  }

  async function runAI(m: MatchPrep, s: PrepStep) {
    busy = s;
    render();
    const ac = new AbortController();
    signal.addEventListener('abort', () => ac.abort(), { once: true });
    try {
      const r = await runPrepAI(data, m, s, ac.signal);
      const n = mergeAI(data, m, s, r.data);
      touch(m);
      persist();
      msg = `AI 已加入 ${n} 項（${r.engine}${r.cost ? ` · 約 US$${r.cost.toFixed(3)}` : ''}）。AI 內容請先核對事實段號再用於庭上。`;
      msgWarn = false;
    } catch (e: any) {
      msg = e?.message ?? 'AI 分析失敗';
      msgWarn = true;
    }
    busy = '';
    render();
  }

  function applyFix(m: MatchPrep, i: number): boolean {
    const f = m.script.fixes[i];
    const at = locateFix(f, oralOf(data, m.ourSide));
    if (!at || !f.replacement) return false;
    at.unit.textEn = at.unit.textEn.slice(0, at.start) + f.replacement + at.unit.textEn.slice(at.end);
    f.status = 'applied';
    f.unit = at.unit.id;
    markChanged([at.unit.id], `對戰修正 ${matchTitle(m)}`);
    return true;
  }

  function exportPrep(m: MatchPrep) {
    const b: OutBlock[] = [{ kind: 'h', level: 1, text: `${matchTitle(m)} 對戰準備` }];
    b.push({ kind: 'table', rows: [['項目', '內容'], ['場次', `${m.round} ${m.date} ${m.time} ${m.room ? m.room + ' 教室' : ''}`], ['我方', `${m.ourTeam}（${m.ourSide === 'prosecution' ? '檢方' : '辯方'}）`], ['對方', `${m.oppTeam}${m.memorial ? `　書狀：${m.memorial.name}（約 ${m.memorial.words} 字）` : ''}`]] });
    const list = (key: string) => { const [t, g] = LISTS[key]; const a = g(m); if (a.length) { b.push({ kind: 'h', level: 2, text: t }); a.forEach((x, i) => b.push({ kind: 'p', text: `${i + 1}. ${x}` })); } };
    const table = (key: string, cols: [string, string][]) => { const a = SPECS[key].path(m); if (a.length) { b.push({ kind: 'h', level: 2, text: SPECS[key].title }); b.push({ kind: 'table', rows: [cols.map((c) => c[1]), ...a.map((x: any) => cols.map(([k]) => String(x[k] ?? '')))] }); } };
    const checks = (key: string) => { const [t, g] = CHECKS[key]; const a = g(m); if (a.length) { b.push({ kind: 'h', level: 2, text: t }); a.forEach((x) => b.push({ kind: 'p', text: `${x.done ? '☑' : '☐'} ${x.text}` })); } };
    list('summary');
    table('claims', [['issue', '爭點'], ['claim', '對方主張'], ['paras', '書狀段落'], ['predict', '預測庭上說法'], ['mine', '我的反應']]);
    table('admissions', [['text', '承認'], ['paras', '段落'], ['use', '口說運用']]);
    list('gaps');
    table('pros', [['point', '有利點'], ['basis', '依據'], ['use', '口說運用']]);
    table('cons', [['risk', '風險'], ['detail', '說明'], ['level', '等級'], ['response', '應對'], ['mine', '我的應對']]);
    list('priorities');
    checks('verify');
    list('directions');
    table('fixes', [['where', '位置'], ['current', '現稿寫法'], ['problem', '問題'], ['suggest', '建議修改'], ['status', '狀態']]);
    checks('additions');
    table('attacks', [['claim', '對方論點'], ['response', '我方應對要點'], ['cite', '引用']]);
    table('timing', [['part', '段落'], ['minutes', '建議時間（分）'], ['focus', '重點']]);
    list('rebuttal');
    table('qa', [['question', '可能的法官問題'], ['answer', '建議回答重點'], ['avoid', '避免的說法']]);
    list('reminders');
    download(buildDocx(b), `對戰準備_${matchTitle(m).replace(/\W+/g, '_')}.docx`);
  }

  /* ------------------------------------------------------------ events */

  function pickFile(sel: string) {
    $<HTMLInputElement>(sel, container)?.click();
  }

  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const m = match();
    const btn = t.closest<HTMLElement>('[data-act],[data-match],[data-step],[data-ai],[data-add],[data-edit],[data-del],[data-walk],[data-say],[data-say-text],[data-goto-para],[data-goto-head],[data-add-adm],[data-fix-apply],[data-fix-edit],[data-fix-save],[data-fix-status],#rebut-go');
    if (!btn) return;
    const d = btn.dataset;
    if (btn.tagName === 'A' && !d.gotoPara && !d.gotoHead) return;
    if (d.gotoPara || d.gotoHead) {
      e.preventDefault();
      if (step !== 'memorial') { step = 'memorial'; render(); }
      const el = d.gotoPara ? $(`#para-${CSS.escape(d.gotoPara)}`, container) : $$('[data-head]', container).find((x) => x.dataset.head === d.gotoHead);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1600);
      return;
    }
    if (d.match) { stopDrill(); activeId = d.match; editing = ''; guided = 0; walkReveal = false; msg = ''; render(); return; }
    if (d.step) { stopDrill(); step = d.step as Step; editing = ''; try { localStorage.setItem(STEP_KEY, step); } catch {} render(); return; }
    if (d.sayText) { speakAs(d.sayText, 1, undefined, 0.95); return; }
    switch (d.act) {
      case 'pick-schedule': return pickFile('#file-schedule');
      case 'pick-facts': return pickFile('#file-facts');
      case 'pick-memorial': return pickFile('#file-memorial');
      case 'pick-analysis': return pickFile('#file-analysis');
      case 'add-match': {
        const meta = prepMeta(data);
        const n = meta.team.replace(/\D/g, '').padStart(2, '0');
        const x = blankMatch({ ourTeam: meta.team ? `P${n}` : '', round: '' });
        matchesOf(data).push(x);
        activeId = x.id;
        persist();
        render();
        $<HTMLDetailsElement>('.prep-meta', container)!.open = true;
        return;
      }
    }
    if (!m) return;
    switch (d.act) {
      case 'del-match':
        if (!confirm(`刪除場次 ${matchTitle(m)}？這一場的書狀與準備內容都會刪除（已加入題庫的題目保留）。`)) return;
        data.matches = matchesOf(data).filter((x) => x.id !== m.id);
        activeId = matchesOf(data)[0]?.id ?? '';
        persist();
        render();
        return;
      case 'export-prep': return exportPrep(m);
      case 'focus':
        setActiveMatch(m.id === activeMatchId() ? '' : m.id);
        note(m.id === activeMatchId() ? `單題攻防與模擬庭會優先出 ${matchTitle(m)} 的題目（${m.ourSide === 'prosecution' ? '檢方' : '辯方'}）。` : '已取消演練焦點。');
        render();
        return;
      case 'paste-memorial': {
        const v = $<HTMLTextAreaElement>('#mem-paste', container)?.value.trim();
        if (v) void importMemorial(m, null, v);
        return;
      }
      case 'walk': guided = Math.max(0, guided); render(); return;
      case 'listmode': guided = -1; render(); return;
      case 'reveal': walkReveal = !walkReveal; render(); return;
      case 'cancel-edit': editing = ''; render(); return;
      case 'apply-all': {
        let n = 0;
        m.script.fixes.forEach((f, i) => { if (f.status === 'open' && f.replacement && applyFix(m, i)) n++; });
        touch(m);
        persist();
        msg = `已套用 ${n} 筆修正。修改過的段落會在口說教練重新練習。`;
        msgWarn = false;
        render();
        return;
      }
      case 'to-bench': {
        const n = qaToBench(data, m);
        touch(m);
        persist();
        msg = `已加入 ${n} 題到${m.ourSide === 'prosecution' ? '檢方' : '辯方'}題庫（分類「對戰 ${matchTitle(m)}」），可到單題攻防或題庫與稿件中調整。`;
        msgWarn = false;
        render();
        return;
      }
    }
    if (d.ai) return void runAI(m, d.ai as PrepStep);
    if (d.add) {
      const arr = SPECS[d.add].path(m);
      arr.push(SPECS[d.add].blank());
      editing = `${d.add}:${arr.length - 1}`;
      render();
      $('[data-form] input, [data-form] textarea', container)?.focus();
      return;
    }
    if (d.edit) { editing = d.edit; render(); $('[data-form] input, [data-form] textarea, [data-listform] textarea, [data-checkform] textarea', container)?.focus(); return; }
    if (d.del) {
      const [k, i] = d.del.split(':');
      if (!confirm('刪除這一項？')) return;
      SPECS[k].path(m).splice(Number(i), 1);
      editing = '';
      touch(m);
      render();
      return;
    }
    if (d.walk) { guided = Math.max(0, guided) + Number(d.walk); walkReveal = false; render(); return; }
    if (d.say) { const c = m.reading.claims[Number(d.say)]; if (c?.predict) speakAs(c.predict, 1, undefined, 0.95); return; }
    if (d.addAdm) {
      const cc = crossCheck(m.memorial!, oralOf(data, m.ourSide));
      const a = cc.admissions[Number(d.addAdm)];
      if (a) { m.reading.admissions.push({ ...a }); touch(m); render(); }
      return;
    }
    if (d.fixApply) {
      if (applyFix(m, Number(d.fixApply))) { touch(m); persist(); note('已套用，這段稿件會在口說教練重新練習。'); render(); }
      else note('在稿件中找不到要替換的文字。', true);
      return;
    }
    if (d.fixEdit) { editing = `fixedit:${d.fixEdit}`; render(); return; }
    if (d.fixSave) {
      const i = Number(d.fixSave);
      const f = m.script.fixes[i];
      const at = locateFix(f, oralOf(data, m.ourSide));
      const v = $<HTMLTextAreaElement>('#fix-text', container)?.value;
      if (at && v != null && v !== at.unit.textEn) {
        at.unit.textEn = v;
        f.status = 'applied';
        f.unit = at.unit.id;
        markChanged([at.unit.id], `對戰修正 ${matchTitle(m)}`);
      } else if (at) f.status = 'applied';
      editing = '';
      touch(m);
      persist();
      render();
      return;
    }
    if (d.fixStatus) {
      const [i, s] = d.fixStatus.split(':');
      m.script.fixes[Number(i)].status = s as Fix['status'];
      touch(m);
      render();
      return;
    }
    if (btn.id === 'rebut-go') {
      if (drill.phase === 'speak') return void finishRebut();
      if (drill.phase === 'listen' && beginNow) {
        // skip the rest of the opponent's line
        cancelTTS?.();
        cancelTTS = null;
        beginNow();
        return;
      }
      stopDrill();
      const v = $<HTMLSelectElement>('#rebut-pick', container)?.value ?? 'full';
      drill.kind = v === 'full' ? 'full' : 'claim';
      drill.idx = v === 'full' ? 0 : Number(v);
      void startRebut();
    }
  }

  function onSubmit(e: Event) {
    const f = e.target as HTMLFormElement;
    const m = match();
    if (!m) return;
    e.preventDefault();
    const fd = new FormData(f);
    if (f.dataset.form) {
      const [k, i] = f.dataset.form.split(':');
      const x = SPECS[k].path(m)[Number(i)];
      for (const [key, , kind] of SPECS[k].fields) {
        const v = String(fd.get(key) ?? '').trim();
        if (kind === 'num') x[key] = Number(v) || 0;
        else if (kind === 'strength') { if (v) x[key] = v; else delete x[key]; }
        else x[key] = v;
      }
      if (x.src === 'auto') x.src = 'me';
      // an emptied new card is dropped
      if (SPECS[k].fields.every(([key]) => !String(x[key] ?? '').trim() || key === 'level' || key === 'minutes')) SPECS[k].path(m).splice(Number(i), 1);
    } else if (f.dataset.listform) {
      const arr = LISTS[f.dataset.listform][1](m);
      arr.splice(0, arr.length, ...String(fd.get('v') ?? '').split('\n').map((s) => s.replace(/^\s*([-•●]|\d+[.)、])\s*/, '').trim()).filter(Boolean));
    } else if (f.dataset.checkform) {
      const arr = CHECKS[f.dataset.checkform][1](m);
      const lines = String(fd.get('v') ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const old = new Map(arr.map((x) => [x.text, x]));
      arr.splice(0, arr.length, ...lines.map((t) => old.get(t) ?? { text: t, done: false, src: 'me' as Source }));
    } else return;
    editing = '';
    touch(m);
    render();
  }

  function onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const m = match();
    if (t.id === 'team') { prepMeta(data).team = t.value.trim(); touch(); return; }
    if (t.id === 'mem-q') {
      memQuery = t.value;
      clearTimeout((onInput as any).tm);
      (onInput as any).tm = setTimeout(() => { render(); const s = $<HTMLInputElement>('#mem-q', container); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }, 250);
      return;
    }
    if (!m) return;
    if (t.dataset.mine) {
      const [k, i] = t.dataset.mine.split(':');
      (SPECS[k].path(m)[Number(i)] as any).mine = t.value;
      touch(m);
      return;
    }
    const mf = t.closest('#meta-form');
    if (mf && t.name) {
      (m as any)[t.name] = t.value;
      touch(m);
    }
  }

  function onChange(e: Event) {
    const t = e.target as HTMLInputElement;
    const m = match();
    if (t.id === 'file-schedule' && t.files?.[0]) return void importSchedule(t.files[0]);
    if (t.id === 'file-facts' && t.files?.[0]) return void importFacts(t.files[0]);
    if (!m) return;
    if (t.id === 'file-memorial' && t.files?.[0]) return void importMemorial(m, t.files[0]);
    if (t.id === 'file-analysis' && t.files?.length) return void importAnalyses(m, [...t.files]);
    if (t.dataset.read) { m.reading.claims[Number(t.dataset.read)].read = t.checked; touch(m); return; }
    if (t.dataset.check) { const [k, i] = t.dataset.check.split(':'); CHECKS[k][1](m)[Number(i)].done = t.checked; touch(m); return; }
    if (t.closest('#meta-form')) { render(); return; } // header shows the new title
    if (t.id === 'rebut-pick') { stopDrill(); drill = { kind: t.value === 'full' ? 'full' : 'claim', idx: t.value === 'full' ? 0 : Number(t.value), phase: 'idle', text: '', interim: '', start: 0, grade: null }; paintDrill(); }
  }

  // drag & drop a memorial / analysis file anywhere on the tab
  function onDrop(e: DragEvent) {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const m = match();
    if (!m) return void (files[0] && importSchedule(files[0]));
    const memorialLike = step === 'memorial' || files.some((f) => /\.pdf$/i.test(f.name));
    if (memorialLike && files.length === 1 && step === 'memorial') return void importMemorial(m, files[0]);
    void importAnalyses(m, files.filter((f) => /\.(docx|txt|md)$/i.test(f.name)));
  }
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };

  container.addEventListener('click', onClick);
  container.addEventListener('submit', onSubmit);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onChange);
  container.addEventListener('drop', onDrop);
  container.addEventListener('dragover', onDragOver);
  render();

  return () => {
    stopDrill();
    if (saveTimer) { clearTimeout(saveTimer); persist(); }
    container.removeEventListener('click', onClick);
    container.removeEventListener('submit', onSubmit);
    container.removeEventListener('input', onInput);
    container.removeEventListener('change', onChange);
    container.removeEventListener('drop', onDrop);
    container.removeEventListener('dragover', onDragOver);
  };
}
