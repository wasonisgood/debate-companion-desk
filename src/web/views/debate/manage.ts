/**
 * 題庫與稿件 Script & question-bank editor
 *
 *  - Identity fields are dropdowns (seat / speaker, section, category); the seat chosen
 *    here is what the coach, drill and hearing use.
 *  - Edits save automatically (debounced); no separate save button to forget.
 *  - Items are selected by id, so filters and search never point at the wrong record.
 *  - Script ↔ question links ([→法官題 P-01] markers) are shown both ways and are
 *    renamed automatically when a question id changes.
 */

import { html, raw, $, $$ } from '../../lib/dom';
import { loadDebateData, saveDebateData, onSyncStatus, syncDebateDataNow, debateBank, type DebateData } from '../../lib/debateStorage';
import type { BenchQuestion, OralUnit } from '../../lib/debateData';
import {
  SEAT_INFO,
  SPEAKERS,
  type Seat,
  type Side,
  anchorsOf,
  cleanScript,
  derivedQuestionSeat,
  questionSeat,
  estimateSec,
  fmtClock,
  refsOf,
  seatOf,
  shortSection,
  wordsCount,
  QID_RE,
} from '../../lib/mootCourt';
import { changedUnits, markChanged } from '../../lib/matchPrep';
import { createWordSync } from './wordSync';

type Sub = 'oral' | 'bench' | 'word' | 'io';
const NEW = '__new__';

export default function renderManage(container: HTMLElement, signal: AbortSignal) {
  let data: DebateData = loadDebateData();
  const wanted = new URL(location.href).searchParams.get('sub');
  let sub: Sub = wanted === 'bench' || wanted === 'word' || wanted === 'io' ? wanted : 'oral';
  let side: Side = 'prosecution';
  let activeOral = '';
  let activeQ = '';
  const f = { section: '', seat: '' as '' | '1' | '2', q: '', cat: '' };
  let saveTimer: number | undefined;
  let statusTimer: number | undefined;

  const oral = () => (side === 'prosecution' ? data.prosecutionOral : data.defenseOral);
  const questions = () => (side === 'prosecution' ? data.prosecutionQuestions : data.defenseQuestions);
  const allOral = () => [...data.prosecutionOral, ...data.defenseOral];
  const sections = () => [...new Set(oral().map((u) => u.section))];
  const categories = () => [...new Set(questions().map((q) => q.category).filter(Boolean))];

  const ws = createWordSync({
    data: () => data,
    side: () => side,
    saved: (msg) => {
      persist();
      render();
      status(msg);
    },
    status: (msg, warn) => status(msg, warn),
  });

  const unsubSync = onSyncStatus((st, info) => {
    if (signal.aborted) return;
    if (st === 'saving') {
      status('正在自動同步至雲端…');
    } else if (st === 'synced') {
      status(`✓ 已自動同步至雲端 ${info || ''}`);
    } else if (st === 'error') {
      status(`⚠ ${info || '雲端同步失敗'}（本機已暫存）`, true);
    }
  });
  signal.addEventListener('abort', unsubSync, { once: true });

  /* ------------------------------------------------------------ filtering */

  function filteredOral(): OralUnit[] {
    const needle = f.q.trim().toLowerCase();
    return oral().filter(
      (u) =>
        (!f.section || u.section === f.section) &&
        (!f.seat || String(seatOf(u)) === f.seat) &&
        (!needle || `${u.id} ${u.textEn} ${u.notesZh}`.toLowerCase().includes(needle)),
    );
  }

  function filteredQ(): BenchQuestion[] {
    const needle = f.q.trim().toLowerCase();
    return questions().filter(
      (q) =>
        (!f.cat || q.category === f.cat) &&
        (!f.seat || String(qSeat(q)) === f.seat) &&
        (!needle || `${q.id} ${q.title} ${q.questionEn} ${q.questionZh} ${q.issue}`.toLowerCase().includes(needle)),
    );
  }

  function qSeat(q: BenchQuestion): Seat | 0 {
    return q.seat ?? derivedQuestionSeat(q, oral());
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (signal.aborted) return;
    container.innerHTML = html`
      <div class="mg">
        <div class="mg-top">
          <div class="seg">
            <button class="${sub === 'oral' ? 'on' : ''}" data-sub="oral">口說稿件</button>
            <button class="${sub === 'bench' ? 'on' : ''}" data-sub="bench">法官題庫</button>
            <button class="${sub === 'word' ? 'on' : ''}" data-sub="word" title="匯出到 Word 編輯，再把修改匯回系統">Word 同步</button>
            <button class="${sub === 'io' ? 'on' : ''}" data-sub="io">備份與還原</button>
          </div>
          ${sub !== 'io'
            ? raw(html`<div class="seg">
                <button class="${side === 'prosecution' ? 'on' : ''}" data-side="prosecution">控方</button>
                <button class="${side === 'defense' ? 'on' : ''}" data-side="defense">辯方</button>
              </div>`)
            : ''}
          <span class="mg-status mono" id="mg-status" aria-live="polite">已自動同步至雲端</span>
        </div>
        ${raw(sub === 'oral' ? oralView() : sub === 'bench' ? benchView() : sub === 'word' ? '<div id="mg-word"></div>' : ioView())}
      </div>
    `;
    bind();
    ws.dispose();
    const wel = $('#mg-word', container);
    if (wel) ws.mount(wel);
  }

  function seatOptions(selected: Seat | 0, withAuto?: { derived: Seat | 0 }): string {
    const opts: string[] = [];
    if (withAuto)
      opts.push(
        html`<option value="" ${selected === 0 ? raw('selected') : ''}>自動判斷（目前：${withAuto.derived ? SEAT_INFO[withAuto.derived].zh : '不限'}）</option>`,
      );
    for (const s of [1, 2] as Seat[])
      opts.push(
        html`<option value="${s}" ${selected === s ? raw('selected') : ''}>${SEAT_INFO[s].zh} · ${SPEAKERS[s].zh}（${SEAT_INFO[s].minutes}′）</option>`,
      );
    return opts.join('');
  }

  function filterBar(kind: 'oral' | 'bench', count: number, total: number): string {
    return html`
      <div class="mg-filters">
        ${kind === 'oral'
          ? raw(html`<select id="f-section" aria-label="章節">
              <option value="">全部章節</option>
              ${sections().map((s) => raw(html`<option value="${s}" ${f.section === s ? raw('selected') : ''}>${shortSection(s)}</option>`))}
            </select>`)
          : raw(html`<select id="f-cat" aria-label="分類">
              <option value="">全部分類</option>
              ${categories().map((c) => raw(html`<option value="${c}" ${f.cat === c ? raw('selected') : ''}>${c}</option>`))}
            </select>`)}
        <select id="f-seat" aria-label="辯士">
          <option value="">兩位辯士</option>
          ${([1, 2] as Seat[]).map((s) => raw(html`<option value="${s}" ${f.seat === String(s) ? raw('selected') : ''}>${SEAT_INFO[s].zh} · ${SPEAKERS[s].zh}</option>`))}
        </select>
        <input type="search" id="f-q" placeholder="搜尋編號、內容…" value="${f.q}">
        <span class="mono dim">${count} / ${total}</span>
        <button class="btn ghost small" id="btn-add">＋ ${kind === 'oral' ? '在目前段落後插入' : '新增題目'}</button>
      </div>`;
  }

  /* ---------------- oral */

  function oralView(): string {
    const list = filteredOral();
    if (!list.some((u) => u.id === activeOral)) activeOral = list[0]?.id ?? '';
    const u = oral().find((x) => x.id === activeOral);
    const changed = changedUnits();
    let lastSec = '';
    return html`
      ${raw(filterBar('oral', list.length, oral().length))}
      <div class="mg-body">
        <ul class="mg-list" id="mg-list">
          ${list.map((x) => {
            const head = x.section !== lastSec ? raw(html`<li class="mg-group">${shortSection(x.section)}</li>`) : '';
            lastSec = x.section;
            return raw(html`${head}<li><button class="mg-item ${x.id === activeOral ? 'on' : ''}" data-id="${x.id}">
              <span class="mono"><b class="seat s${seatOf(x)}">${SEAT_INFO[seatOf(x)].zh}</b> ${x.id.replace(/^(prosecution|defense)-unit-/, '#')}${changed[x.id] ? raw(html` <i class="mg-changed" title="${changed[x.id].why}">已修改</i>`) : ''}</span>
              <span class="mg-snip" data-snip="${x.id}">${cleanScript(x.textEn).slice(0, 70) || '（空白）'}</span>
            </button></li>`);
          })}
          ${list.length ? '' : raw('<li class="mg-empty dim">沒有符合條件的段落</li>')}
        </ul>
        ${u ? raw(oralForm(u)) : raw('<p class="dim">請從左側選擇段落。</p>')}
      </div>`;
  }

  function oralForm(u: OralUnit): string {
    const seat = seatOf(u);
    const w = wordsCount(u.textEn);
    const idx = oral().indexOf(u);
    return html`
      <form class="mg-form" id="oral-form" autocomplete="off">
        <header><b>${u.id}</b><span class="mono dim">全稿第 ${idx + 1} / ${oral().length} 段</span></header>
        <div class="mg-row">
          <label class="field"><span>負責辯士</span>
            <select name="seat">${raw(seatOptions(seat))}</select>
          </label>
          <label class="field"><span>章節</span>
            <select name="section">
              ${sections().map((s) => raw(html`<option value="${s}" ${s === u.section ? raw('selected') : ''}>${s}</option>`))}
              <option value="${NEW}">＋ 新增章節…</option>
            </select>
          </label>
        </div>
        <label class="field" id="new-section-wrap" hidden><span>新章節名稱（例：Count 2: 比例原則）</span>
          <input type="text" name="newSection" placeholder="Count 2: …">
        </label>
        <label class="field"><span>英文口說稿 <em class="mono dim" id="oral-stats">${w} 字 ≈ ${fmtClock(estimateSec(w))}（不含插問標記）</em></span>
          <textarea name="textEn" rows="8" class="latin">${u.textEn}</textarea>
        </label>
        <section class="mg-anchors">
          <header>
            <b>⚖ 法官插問點</b>
            <small class="dim">標記不是講稿內容，不會被背誦、計字或評分；它告訴模擬法官「講到這裡可以插問哪一題」。</small>
          </header>
          <ol id="oral-anchors">${raw(anchorList(u))}</ol>
          <div class="mg-anchor-add">
            <select name="anchorQ" aria-label="要插問的題目">${raw(anchorOptions(u))}</select>
            <button type="button" class="btn ghost small" data-anchor-add="cursor" title="在稿件游標所在的句子結尾插入">插在游標處</button>
            <button type="button" class="btn ghost small" data-anchor-add="end">插在段末</button>
          </div>
        </section>
        <label class="field"><span>中文重點與提示</span>
          <textarea name="notesZh" rows="4">${u.notesZh}</textarea>
        </label>
        <footer class="mg-actions">
          <button type="button" class="btn ghost small" data-move="-1" ${idx <= 0 ? raw('disabled') : ''}>↑ 上移</button>
          <button type="button" class="btn ghost small" data-move="1" ${idx >= oral().length - 1 ? raw('disabled') : ''}>↓ 下移</button>
          <button type="button" class="btn ghost small danger" id="btn-del">刪除此段落</button>
        </footer>
      </form>`;
  }

  /** Each ⚖ marker in the segment, with the words it follows. */
  function anchorList(u: OralUnit): string {
    const list = anchorsOf(u.textEn);
    if (!list.length) return html`<li class="dim">這段沒有插問點。法官只會在空檔隨機提問。</li>`;
    const words = cleanScript(u.textEn).split(/\s+/).filter(Boolean);
    const qs = questions();
    return list
      .map((a, i) => {
        const q = qs.find((x) => x.id === a.qid);
        const before = words.slice(Math.max(0, a.at - 6), a.at).join(' ');
        const where = a.at === 0 ? '段首' : a.at >= words.length ? '段末' : '句中';
        return html`<li class="${q ? '' : 'broken'}">
          <span class="mg-anchor-where mono">${where}</span>
          <span class="mg-anchor-ctx latin">${a.at ? `…${before}` : '（開口前）'} <i>⚖</i></span>
          ${q
            ? raw(html`<button type="button" class="chip" data-goto-q="${a.qid}" title="${q.questionEn}">${a.qid}</button><span class="mg-anchor-t">${q.title || q.questionEn}</span>`)
            : raw(html`<span class="chip missing" title="題庫中找不到這個題號">${a.qid}?</span><span class="mg-anchor-t dim">題庫中找不到此題</span>`)}
          <button type="button" class="linkish danger" data-anchor-del="${i}">移除</button>
        </li>`;
      })
      .join('');
  }

  /** Question dropdown: this speaker's questions first, already-placed ones marked. */
  function anchorOptions(u: OralUnit): string {
    const seat = seatOf(u);
    const all = oral();
    const placed = new Set(all.flatMap((x) => refsOf(x.textEn)));
    const here = new Set(refsOf(u.textEn));
    const opt = (q: BenchQuestion) =>
      html`<option value="${q.id}">${q.id}${here.has(q.id) ? ' ✓本段' : placed.has(q.id) ? ' · 已在他段' : ''}｜${(q.title || q.questionEn).slice(0, 48)}</option>`;
    const mine = questions().filter((q) => questionSeat(q, all) === seat);
    const other = questions().filter((q) => questionSeat(q, all) !== seat);
    return html`<option value="">選擇題目…</option>
      <optgroup label="${SEAT_INFO[seat].zh}的題目">${raw(mine.map(opt).join(''))}</optgroup>
      ${other.length ? raw(html`<optgroup label="其他題目">${raw(other.map(opt).join(''))}</optgroup>`) : ''}`;
  }

  function onAnchorClick(e: Event) {
    const form = e.currentTarget as HTMLFormElement;
    const t = e.target as HTMLElement;
    const ta = $<HTMLTextAreaElement>('[name=textEn]', form);
    const u = oral().find((x) => x.id === activeOral);
    if (!ta || !u) return;
    const del = t.closest<HTMLElement>('[data-anchor-del]');
    const add = t.closest<HTMLElement>('[data-anchor-add]');
    if (del) {
      const n = Number(del.dataset.anchorDel);
      let k = -1;
      ta.value = ta.value
        .replace(/\s*\[→[^\]\s]*\s*[A-Za-z]+-[A-Za-z0-9_-]+\s*\]/g, (m) => (++k === n ? '' : m))
        .trim();
    } else if (add) {
      const sel = $<HTMLSelectElement>('[name=anchorQ]', form);
      const id = sel?.value;
      if (!id) return void sel?.focus();
      const tag = `[→${id.startsWith('T') ? '老師題' : '法官題'} ${id}]`;
      const v = ta.value;
      let at = v.length;
      if (add.dataset.anchorAdd === 'cursor') {
        // snap to the end of the sentence the cursor is in (after any markers already there)
        const m = /[.?!;:]["”’)]*(\s*\[→[^\]]*\])*/g;
        m.lastIndex = Math.max(0, ta.selectionStart - 1);
        const hit = m.exec(v);
        at = hit ? hit.index + hit[0].length : v.length;
      }
      const left = v.slice(0, at).replace(/\s+$/, '');
      const right = v.slice(at).replace(/^\s+/, '');
      ta.value = `${left} ${tag}${right ? ' ' + right : ''}`;
      if (sel) sel.value = '';
    } else return;
    applyOral(form, 'textEn');
  }

  /* ---------------- bench */

  function benchView(): string {
    const list = filteredQ();
    if (!list.some((q) => q.id === activeQ)) activeQ = list[0]?.id ?? '';
    const q = questions().find((x) => x.id === activeQ);
    return html`
      ${raw(filterBar('bench', list.length, questions().length))}
      <div class="mg-body">
        <ul class="mg-list" id="mg-list">
          ${list.map((x) => {
            const s = qSeat(x);
            return raw(html`<li><button class="mg-item ${x.id === activeQ ? 'on' : ''}" data-id="${x.id}">
              <span class="mono">${s ? raw(html`<b class="seat s${s}">${SEAT_INFO[s].zh}</b> `) : ''}${x.id} · ${x.category}</span>
              <span class="mg-snip" data-snip="${x.id}">${stripTitle(x)}</span>
            </button></li>`);
          })}
          ${list.length ? '' : raw('<li class="mg-empty dim">沒有符合條件的題目</li>')}
        </ul>
        ${q ? raw(benchForm(q)) : raw('<p class="dim">請從左側選擇題目。</p>')}
      </div>`;
  }

  function stripTitle(q: BenchQuestion): string {
    return q.title.replace(new RegExp(`^(${q.id}\\s*)+`), '').trim() || q.questionEn.slice(0, 60);
  }

  function benchForm(q: BenchQuestion): string {
    const derived = derivedQuestionSeat(q, oral());
    const usedIn = oral().filter((u) => refsOf(u.textEn).includes(q.id));
    return html`
      <form class="mg-form" id="q-form" autocomplete="off">
        <div class="mg-row three">
          <label class="field"><span>題號</span>
            <input type="text" name="id" value="${q.id}" spellcheck="false">
          </label>
          <label class="field"><span>分類</span>
            <select name="category">
              ${categories().map((c) => raw(html`<option value="${c}" ${c === q.category ? raw('selected') : ''}>${c}</option>`))}
              <option value="${NEW}">＋ 新增分類…</option>
            </select>
          </label>
          <label class="field"><span>由誰回答</span>
            <select name="seat">${raw(seatOptions(q.seat ?? 0, { derived }))}</select>
          </label>
        </div>
        <label class="field" id="new-cat-wrap" hidden><span>新分類名稱</span><input type="text" name="newCategory"></label>
        <label class="field"><span>標題</span><input type="text" name="title" value="${q.title}"></label>
        <label class="field"><span>考點</span><textarea name="issue" rows="2">${q.issue}</textarea></label>

        <fieldset class="mg-set"><legend>法官怎麼問</legend>
          <label class="field"><span>英文提問</span><textarea name="questionEn" rows="3" class="latin">${q.questionEn}</textarea></label>
          <label class="field"><span>口語簡化版（法官語音有時改用這句）</span><textarea name="simplified" rows="2" class="latin">${q.simplified ?? ''}</textarea></label>
          <label class="field"><span>中文翻譯（提示時顯示）</span><textarea name="questionZh" rows="2">${q.questionZh}</textarea></label>
          <div class="mg-row">
            <label class="field"><span>追問（英文）</span><textarea name="followUp" rows="2" class="latin">${q.followUp ?? ''}</textarea></label>
            <label class="field"><span>追問（中文）</span><textarea name="followUpZh" rows="2">${q.followUpZh ?? ''}</textarea></label>
          </div>
        </fieldset>

        <fieldset class="mg-set"><legend>怎麼答</legend>
          <label class="field"><span>回答架構（一行一點；提示時顯示英文行）</span>
            <textarea name="structure" rows="5">${q.structure.join('\n')}</textarea>
          </label>
          <label class="field"><span>參考答案（英文）</span><textarea name="sampleEn" rows="4" class="latin">${q.sampleEn}</textarea></label>
          <label class="field"><span>參考答案（中文）</span><textarea name="sampleZh" rows="3">${q.sampleZh}</textarea></label>
        </fieldset>

        <div class="mg-links">
          <span class="mono dim">稿件中出現於</span>
          ${usedIn.length
            ? usedIn.map((u) => raw(html`<button type="button" class="chip" data-goto-oral="${u.id}" title="${shortSection(u.section)}">${u.id.replace(/^(prosecution|defense)-unit-/, '#')}</button>`))
            : raw(html`<i class="dim">沒有段落連結此題，模擬庭只會依分類與辯士隨機抽到</i>`)}
        </div>
        <footer class="mg-actions">
          <button type="button" class="btn ghost small danger" id="btn-del">刪除此題</button>
        </footer>
      </form>`;
  }

  /* ---------------- io */

  function ioView(): string {
    const counts = `控方稿 ${data.prosecutionOral.length} 段 · 辯方稿 ${data.defenseOral.length} 段 · 控方題 ${data.prosecutionQuestions.length} · 辯方題 ${data.defenseQuestions.length}`;
    const bank = debateBank();
    const cloud = bank?.data
      ? `第 ${bank.version} 版 · ${bank.updated_at ? new Date(bank.updated_at).toLocaleString('zh-TW', { hour12: false }) : ''}`
      : '已自動同步';
    return html`
      <div class="mg-io">
        <section class="hear-card">
          <h3>雲端全自動同步</h3>
          <p class="dim">全隊共用的稿件與題庫隨時在雲端自動同步（目前：${cloud}）。在「口說稿件」或「法官題庫」編輯、新增、刪除或移動項目，皆會直接自動保存並同步至雲端，跨裝置開啟立即為最新內容，無須手動按鈕發布。</p>
        </section>
        <section class="hear-card">
          <h3>匯出備份</h3>
          <p class="dim">目前資料：${counts}。匯出成一個 JSON 檔，可作為歷史存檔或供隊友備份。</p>
          <div><button class="btn primary" id="btn-export">下載 JSON</button></div>
        </section>
        <section class="hear-card">
          <h3>匯入</h3>
          <p class="dim">會整份取代目前的稿件與題庫，並自動同步至雲端。檔案必須同時包含控辯雙方的稿件與題庫。</p>
          <div class="mg-row-inline">
            <input type="file" id="file-import" accept=".json,application/json" hidden>
            <button class="btn ghost" id="btn-pick">選擇 JSON 檔…</button>
            <span class="mono dim" id="import-name">未選擇檔案</span>
          </div>
          <details><summary class="mono dim">或貼上 JSON</summary>
            <textarea id="paste-json" rows="6" class="mono-area" placeholder='{"prosecutionOral": [...], ...}'></textarea>
            <button class="btn small" id="btn-apply-paste">解析並取代</button>
          </details>
        </section>
      </div>`;
  }

  /* ------------------------------------------------------------ saving */

  function status(msg: string, warn = false) {
    const el = $('#mg-status', container);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('warn', warn);
    if (statusTimer) clearTimeout(statusTimer);
    if (!warn) statusTimer = window.setTimeout(() => el && (el.textContent = '已自動同步至雲端'), 4000);
  }

  function persist() {
    try {
      saveDebateData(data);
    } catch (e: any) {
      status(e?.message || '儲存失敗', true);
    }
  }

  function schedule() {
    status('正在自動同步至雲端…');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 400);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      persist();
    }
  }

  function applyOral(form: HTMLFormElement, field: string) {
    const u = oral().find((x) => x.id === activeOral);
    if (!u) return;
    const fd = new FormData(form);
    if (field === 'seat') {
      const s = Number(fd.get('seat')) as Seat;
      u.seat = s;
      u.speakerId = SPEAKERS[s].id;
      u.speaker = SPEAKERS[s].label;
      refreshItem(u.id, s);
    } else if (field === 'section') {
      const v = String(fd.get('section'));
      const wrap = $('#new-section-wrap', form)!;
      wrap.hidden = v !== NEW;
      if (v === NEW) return void $<HTMLInputElement>('[name=newSection]', form)?.focus();
      u.section = v;
    } else if (field === 'newSection') {
      const v = String(fd.get('newSection')).trim();
      if (!v) return;
      u.section = v;
    } else if (field === 'textEn') {
      u.textEn = String(fd.get('textEn'));
      markChanged([u.id], '手動編輯');
      const w = wordsCount(u.textEn);
      const st = $('#oral-stats', form);
      if (st) st.textContent = `${w} 字 ≈ ${fmtClock(estimateSec(w))}（不含插問標記）`;
      const r = $('#oral-anchors', form);
      if (r) r.innerHTML = anchorList(u);
      const o = $<HTMLSelectElement>('[name=anchorQ]', form);
      if (o) o.innerHTML = anchorOptions(u);
      const sn = $(`[data-snip="${CSS.escape(u.id)}"]`, container);
      if (sn) sn.textContent = cleanScript(u.textEn).slice(0, 70) || '（空白）';
    } else if (field === 'notesZh') {
      u.notesZh = String(fd.get('notesZh'));
    }
    schedule();
  }

  function refreshItem(id: string, seat: Seat | 0) {
    const b = $(`.mg-item[data-id="${CSS.escape(id)}"] .seat`, container);
    if (b && seat) {
      b.className = `seat s${seat}`;
      b.textContent = SEAT_INFO[seat].zh;
    }
  }

  function applyQ(form: HTMLFormElement, field: string, committed: boolean) {
    const q = questions().find((x) => x.id === activeQ);
    if (!q) return;
    const fd = new FormData(form);
    const val = (k: string) => String(fd.get(k) ?? '');
    switch (field) {
      case 'id': {
        if (!committed) return; // rename only when the field is left
        const next = val('id').trim();
        if (!next || next === q.id) return;
        if (!QID_RE.test(next)) {
          status('題號格式需為「英文字母-英數字」，例如 P-12、TP-03、CP-001', true);
          $<HTMLInputElement>('[name=id]', form)!.value = q.id;
          return;
        }
        if (questions().some((x) => x.id === next)) {
          status(`題號 ${next} 已存在，未變更`, true);
          $<HTMLInputElement>('[name=id]', form)!.value = q.id;
          return;
        }
        const old = q.id;
        q.id = next;
        let n = 0;
        for (const u of allOral()) {
          const re = new RegExp(`(\\[→[^\\]]*?)\\b${old.replace(/[-]/g, '\\-')}(\\s*\\])`, 'g');
          const t = u.textEn.replace(re, (_m, a, b) => (n++, `${a}${next}${b}`));
          u.textEn = t;
        }
        activeQ = next;
        persist();
        render();
        status(`題號改為 ${next}${n ? `，並更新稿件中 ${n} 處連結` : ''}`);
        return;
      }
      case 'category': {
        const v = val('category');
        $('#new-cat-wrap', form)!.hidden = v !== NEW;
        if (v === NEW) return void $<HTMLInputElement>('[name=newCategory]', form)?.focus();
        q.category = v;
        break;
      }
      case 'newCategory':
        if (val('newCategory').trim()) q.category = val('newCategory').trim();
        break;
      case 'seat': {
        const v = val('seat');
        if (v) q.seat = Number(v) as Seat;
        else delete q.seat;
        refreshItem(q.id, qSeat(q));
        break;
      }
      case 'structure':
        q.structure = val('structure').split('\n').map((s) => s.trim()).filter(Boolean);
        break;
      case 'simplified':
        q.simplified = val('simplified') || undefined;
        break;
      case 'title': {
        q.title = val('title');
        const sn = $(`[data-snip="${CSS.escape(q.id)}"]`, container);
        if (sn) sn.textContent = stripTitle(q);
        break;
      }
      case 'issue':
      case 'questionEn':
      case 'questionZh':
      case 'followUp':
      case 'followUpZh':
      case 'sampleEn':
      case 'sampleZh':
        (q as any)[field] = val(field);
        break;
      default:
        return;
    }
    schedule();
  }

  /* ------------------------------------------------------------ actions */

  function uniqueId(base: string, taken: Set<string>): string {
    let n = taken.size + 1;
    while (taken.has(`${base}${String(n).padStart(3, '0')}`)) n++;
    return `${base}${String(n).padStart(3, '0')}`;
  }

  function addOral() {
    flush();
    const list = oral();
    const cur = list.find((x) => x.id === activeOral);
    const at = cur ? list.indexOf(cur) + 1 : list.length;
    const seat = cur ? seatOf(cur) : 1;
    const unit: OralUnit = {
      id: uniqueId(`${side}-custom-`, new Set(list.map((x) => x.id))),
      side,
      speaker: SPEAKERS[seat].label,
      speakerId: SPEAKERS[seat].id,
      seat,
      section: cur?.section ?? sections()[0] ?? 'Custom',
      textEn: '',
      notesZh: '',
      qa: [],
    };
    list.splice(at, 0, unit);
    activeOral = unit.id;
    f.q = '';
    persist();
    render();
    $<HTMLTextAreaElement>('[name=textEn]', container)?.focus();
    status('已插入新段落');
  }

  function addQ() {
    flush();
    const list = questions();
    const prefix = side === 'prosecution' ? 'CP-' : 'CD-';
    const q: BenchQuestion = {
      id: uniqueId(prefix, new Set(list.map((x) => x.id))),
      title: '',
      side,
      category: f.cat || 'General',
      where: '',
      whereZh: '',
      issue: '',
      questionEn: '',
      questionZh: '',
      followUp: '',
      followUpZh: '',
      structure: [],
      sampleEn: '',
      sampleZh: '',
    };
    if (f.seat) q.seat = Number(f.seat) as Seat;
    list.push(q);
    activeQ = q.id;
    f.q = '';
    persist();
    render();
    $<HTMLInputElement>('[name=title]', container)?.focus();
    status(`已新增 ${q.id}`);
  }

  function del() {
    flush();
    if (sub === 'oral') {
      const list = oral();
      const i = list.findIndex((x) => x.id === activeOral);
      if (i < 0 || !confirm('確定刪除這個段落？')) return;
      list.splice(i, 1);
      activeOral = list[Math.min(i, list.length - 1)]?.id ?? '';
    } else {
      const list = questions();
      const i = list.findIndex((x) => x.id === activeQ);
      if (i < 0) return;
      const linked = oral().filter((u) => refsOf(u.textEn).includes(list[i].id)).length;
      if (!confirm(`確定刪除 ${list[i].id}？${linked ? `\n有 ${linked} 個稿件段落連結到這題，連結會失效。` : ''}`)) return;
      list.splice(i, 1);
      activeQ = list[Math.min(i, list.length - 1)]?.id ?? '';
    }
    persist();
    render();
    status('已刪除');
  }

  function move(dir: number) {
    flush();
    const list = oral();
    const i = list.findIndex((x) => x.id === activeOral);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    persist();
    render();
  }

  function validImport(p: any): p is DebateData {
    return ['prosecutionOral', 'defenseOral', 'prosecutionQuestions', 'defenseQuestions'].every((k) => Array.isArray(p?.[k]));
  }

  function importData(p: any, label: string) {
    if (!validImport(p)) {
      alert('格式不符：檔案必須同時包含 prosecutionOral、defenseOral、prosecutionQuestions、defenseQuestions 四個陣列。');
      return;
    }
    if (!confirm(`用「${label}」取代目前全部的稿件與題庫？`)) return;
    data = { ...p, followUpExamples: Array.isArray(p.followUpExamples) ? p.followUpExamples : [] };
    persist();
    render();
    status(`已匯入 ${label}，並自動同步至雲端`);
  }

  /* ------------------------------------------------------------ events */

  function bind() {
    $$<HTMLButtonElement>('[data-sub]', container).forEach((b) =>
      b.addEventListener('click', () => {
        flush();
        sub = b.dataset.sub as Sub;
        f.q = '';
        f.seat = '';
        render();
      }),
    );
    $$<HTMLButtonElement>('[data-side]', container).forEach((b) =>
      b.addEventListener('click', () => {
        flush();
        side = b.dataset.side as Side;
        f.section = f.cat = '';
        activeOral = activeQ = '';
        render();
      }),
    );
    $('#f-section', container)?.addEventListener('change', (e) => ((f.section = (e.target as HTMLSelectElement).value), flush(), render()));
    $('#f-cat', container)?.addEventListener('change', (e) => ((f.cat = (e.target as HTMLSelectElement).value), flush(), render()));
    $('#f-seat', container)?.addEventListener('change', (e) => ((f.seat = (e.target as HTMLSelectElement).value as any), flush(), render()));
    const search = $<HTMLInputElement>('#f-q', container);
    let st: number | undefined;
    search?.addEventListener('input', () => {
      clearTimeout(st);
      st = window.setTimeout(() => {
        f.q = search.value;
        flush();
        render();
        const s2 = $<HTMLInputElement>('#f-q', container);
        s2?.focus();
        s2?.setSelectionRange(s2.value.length, s2.value.length);
      }, 250);
    });

    $$<HTMLButtonElement>('.mg-item', container).forEach((b) =>
      b.addEventListener('click', () => {
        flush();
        if (sub === 'oral') activeOral = b.dataset.id!;
        else activeQ = b.dataset.id!;
        render();
      }),
    );
    $('.mg-item.on', container)?.scrollIntoView({ block: 'nearest' });

    $('#btn-add', container)?.addEventListener('click', () => (sub === 'oral' ? addOral() : addQ()));
    $('#btn-del', container)?.addEventListener('click', del);
    $$<HTMLButtonElement>('[data-move]', container).forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.move))));

    const of = $<HTMLFormElement>('#oral-form', container);
    if (of) {
      of.addEventListener('submit', (e) => e.preventDefault());
      of.addEventListener('input', (e) => {
        const n = (e.target as HTMLInputElement).name;
        if (n !== 'anchorQ') applyOral(of, n);
      });
      of.addEventListener('click', onAnchorClick);
    }
    const qf = $<HTMLFormElement>('#q-form', container);
    if (qf) {
      qf.addEventListener('submit', (e) => e.preventDefault());
      qf.addEventListener('input', (e) => applyQ(qf, (e.target as HTMLInputElement).name, false));
      qf.addEventListener('change', (e) => {
        const n = (e.target as HTMLInputElement).name;
        if (n === 'id') applyQ(qf, n, true);
      });
    }

    // io
    $('#btn-export', container)?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `moot_court_debate_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const fi = $<HTMLInputElement>('#file-import', container);
    $('#btn-pick', container)?.addEventListener('click', () => fi?.click());
    fi?.addEventListener('change', async () => {
      const file = fi.files?.[0];
      if (!file) return;
      $('#import-name', container)!.textContent = file.name;
      try {
        importData(JSON.parse(await file.text()), file.name);
      } catch (err: any) {
        alert('JSON 解析失敗：' + (err?.message ?? ''));
      }
    });
    $('#btn-apply-paste', container)?.addEventListener('click', () => {
      const t = $<HTMLTextAreaElement>('#paste-json', container)?.value.trim();
      if (!t) return;
      try {
        importData(JSON.parse(t), '貼上的 JSON');
      } catch (err: any) {
        alert('JSON 解析失敗：' + (err?.message ?? ''));
      }
    });
  }

  function onCrossLink(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto-q],[data-goto-oral]');
    if (!t) return;
    flush();
    f.q = '';
    f.seat = '';
    if (t.dataset.gotoQ) {
      sub = 'bench';
      f.cat = '';
      activeQ = t.dataset.gotoQ;
    } else {
      sub = 'oral';
      f.section = '';
      activeOral = t.dataset.gotoOral!;
    }
    render();
  }

  container.addEventListener('click', onCrossLink);
  render();

  return () => {
    flush();
    ws.dispose();
    container.removeEventListener('click', onCrossLink);
    void syncDebateDataNow();
  };
}
