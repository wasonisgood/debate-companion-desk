/**
 * 題庫與稿件 → Word 同步
 *
 * Export our script to Word, edit it there, bring it back:
 *   - drop / choose the .docx (or paste text copied from Word)
 *   - or link the file once (Chrome / Edge): every Word save is picked up
 *     automatically while this page is open
 * Changes are shown paragraph by paragraph (word-level diff) and applied only
 * where ticked. Unit ids, seats, ⚖ bench markers and notes survive; changed
 * paragraphs drop back in the oral coach so they are re-memorised.
 */
import { html, raw, $ } from '../../lib/dom';
import type { DebateData } from '../../lib/debateStorage';
import { fileToBlocks, textToBlocks, download } from '../../lib/docx';
import {
  exportScript, parseScript, diffScript, wordDiff, applyDiff, canLink, pickLink, savedLink, forgetLink, linkPermission,
  readIfChanged, rememberSeen, type Op, type Link,
} from '../../lib/scriptSync';
import { oralOf, seatOf, shortSection, SEAT_INFO, type Side, type Seat } from '../../lib/mootCourt';

interface Ctx {
  data: () => DebateData;
  side: () => Side;
  saved: (note: string) => void;
  status: (msg: string, warn?: boolean) => void;
}

export function createWordSync(ctx: Ctx) {
  let el: HTMLElement | null = null;
  let ops: Op[] | null = null;
  let from = '';
  let accept = new Set<number>();
  let keepMarkers = true;
  let notes = true;
  let seatOnly: Seat | 0 = 0;
  let link: Link | null = null;
  let perm = '';
  let poll: number | undefined;
  let lastCheck = 0;
  let linkSide: Side | null = null;

  async function refreshLink() {
    const side = ctx.side();
    if (linkSide === side && link) return;
    linkSide = side;
    link = canLink() ? await savedLink(side) : null;
    perm = link ? await linkPermission(link, false).catch(() => 'prompt') : '';
    paint();
  }

  function mount(target: HTMLElement) {
    el = target;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragover', onDragOver);
    linkSide = null;
    paint();
    void refreshLink();
    clearInterval(poll);
    poll = window.setInterval(checkLinked, 3000);
  }

  function dispose() {
    clearInterval(poll);
    if (!el) return;
    el.removeEventListener('click', onClick);
    el.removeEventListener('change', onChange);
    el.removeEventListener('drop', onDrop);
    el.removeEventListener('dragover', onDragOver);
    el = null;
  }

  async function checkLinked() {
    if (!el || !link || perm !== 'granted' || document.hidden || ops) return;
    try {
      const f = await readIfChanged(link);
      lastCheck = Date.now();
      if (!f) return paintLinkState();
      await rememberSeen(link, f.lastModified);
      await load(f, `${f.name}（Word 存檔於 ${new Date(f.lastModified).toLocaleTimeString('zh-TW', { hour12: false })}）`);
    } catch (e: any) {
      perm = 'prompt';
      paint();
    }
  }

  async function load(file: File | null, label: string, text = '') {
    try {
      const blocks = file ? await fileToBlocks(file) : textToBlocks(text);
      const paras = parseScript(blocks);
      if (!paras.length) return ctx.status('Word 檔裡沒有可辨識的英文段落。', true);
      const units = oralOf(ctx.data(), ctx.side());
      const scope = seatOnly ? units.filter((u) => seatOf(u) === seatOnly) : units;
      const d = diffScript(scope, paras.map((p) => ({ ...p, seat: p.seat || seatOnly })));
      ops = d;
      from = label;
      accept = new Set(d.map((o, i) => (o.op === 'same' && !o.meta ? -1 : i)).filter((i) => i >= 0));
      const c = counts();
      if (!c.edit && !c.add && !c.del && !c.meta) {
        ops = null;
        ctx.status(`${label}：與系統中的稿件相同，沒有需要更新的地方。`);
      }
      paint();
    } catch (e: any) {
      ctx.status(`讀取失敗：${e?.message ?? e}`, true);
    }
  }

  function counts() {
    const o = ops ?? [];
    return {
      edit: o.filter((x) => x.op === 'edit').length,
      add: o.filter((x) => x.op === 'add').length,
      del: o.filter((x) => x.op === 'del').length,
      meta: o.filter((x) => x.op === 'same' && x.meta).length,
      same: o.filter((x) => x.op === 'same' && !x.meta).length,
    };
  }

  function paintLinkState() {
    const s = el && $('#ws-link-state', el);
    if (s && link) s.textContent = perm === 'granted' ? `已連結 ${link.name} · 每 3 秒檢查一次${lastCheck ? `（最後檢查 ${new Date(lastCheck).toLocaleTimeString('zh-TW', { hour12: false })}）` : ''}` : `已連結 ${link.name}，需要重新授權讀取`;
  }

  function paint() {
    if (!el) return;
    const side = ctx.side();
    const units = oralOf(ctx.data(), side);
    const sideZh = side === 'prosecution' ? '檢方' : '辯方';
    el.innerHTML = html`
      <div class="ws">
        <section class="hear-card">
          <h3>1 匯出到 Word</h3>
          <p class="dim">${sideZh}稿 ${units.length} 段。每個系統段落是一個 Word 段落，章節是「標題 2」、辯士是「標題 3」；[→法官題 P-01] 是法官插問點，可以移動或刪除。</p>
          <div class="mg-row-inline">
            <label class="mono"><input type="checkbox" id="ws-notes" ${notes ? raw('checked') : ''}> 附中文提示（灰色小字）</label>
            <select id="ws-seat" aria-label="辯士">
              <option value="0">兩位辯士</option>
              ${([1, 2] as Seat[]).map((s) => raw(html`<option value="${s}" ${seatOnly === s ? raw('selected') : ''}>只有${SEAT_INFO[s].zh}</option>`))}
            </select>
            <button class="btn primary small" data-ws="export">下載 ${sideZh}稿 .docx</button>
          </div>
        </section>
        <section class="hear-card ws-drop" data-drop>
          <h3>2 從 Word 更新</h3>
          <p class="dim">在 Word 改好後，把 .docx 拖到這裡、選擇檔案，或直接貼上從 Word 複製的文字。系統會逐段比對，你勾選要套用的修改。${seatOnly ? `只比對${SEAT_INFO[seatOnly].zh}的段落。` : ''}</p>
          <div class="mg-row-inline">
            <input type="file" id="ws-file" accept=".docx,.txt,.md" hidden>
            <button class="btn ghost small" data-ws="pick">選擇 Word 檔…</button>
            ${canLink() ? raw(html`<button class="btn ghost small" data-ws="link" title="Chrome／Edge：連結一次，之後在 Word 存檔就會自動顯示變更">${link ? '改連結其他檔案' : '連結 Word 檔（存檔自動更新）'}</button>`) : raw('<span class="mono dim">自動偵測存檔需要 Chrome 或 Edge；其他瀏覽器請每次重新選檔。</span>')}
          </div>
          ${link ? raw(html`<p class="ws-link mono"><span id="ws-link-state"></span>
            ${perm !== 'granted' ? raw('<button class="btn small" data-ws="grant">授權讀取</button>') : raw('<button class="btn ghost small" data-ws="check">立即檢查</button>')}
            <button class="linkish danger" data-ws="unlink">取消連結</button></p>`) : ''}
          <details><summary class="mono dim">貼上文字</summary>
            <textarea id="ws-paste" rows="6" class="latin" placeholder="Count 1: Jaku …&#10;May it please the Court…"></textarea>
            <button class="btn small" data-ws="paste">比對</button></details>
        </section>
        ${ops ? raw(reviewHtml()) : ''}
      </div>`;
    paintLinkState();
  }

  function reviewHtml(): string {
    const c = counts();
    const list = ops!;
    return html`
      <section class="hear-card ws-review">
        <h3>3 檢查變更 <small class="dim">${from}</small></h3>
        <p>修改 <b>${c.edit}</b> 段 · 新增 <b>${c.add}</b> 段 · 刪除 <b>${c.del}</b> 段${c.meta ? ` · 章節／辯士／提示變更 ${c.meta} 段` : ''} · 未變 ${c.same} 段</p>
        ${c.del > Math.max(3, (c.same + c.edit) * 0.3) ? raw('<p class="warn mono">刪除的段落很多：可能匯入的不是完整稿件（例如只有一位辯士的部分），請確認刪除項目，或在上方選擇只比對某一位辯士。</p>') : ''}
        <div class="mg-row-inline">
          <label class="mono"><input type="checkbox" id="ws-keep" ${keepMarkers ? raw('checked') : ''}> Word 裡沒有插問點的段落，保留原本的插問點</label>
          <button class="btn ghost small" data-ws="all">全選</button><button class="btn ghost small" data-ws="none">全不選</button>
        </div>
        <ol class="ws-ops">
          ${list.map((o, i) => {
            if (o.op === 'same' && !o.meta) return '';
            const on = accept.has(i);
            const head = o.op === 'add' ? '新增' : o.op === 'del' ? '刪除' : o.op === 'edit' ? '修改' : '章節／辯士／提示';
            const sec = o.op === 'del' ? o.unit.section : o.op === 'add' ? o.para.section : o.para.section || o.unit.section;
            return raw(html`<li class="ws-op ${o.op}">
              <label><input type="checkbox" data-op="${i}" ${on ? raw('checked') : ''}> <b>${head}</b> <span class="mono dim">${shortSection(sec || '')}${o.op !== 'add' ? ` · ${o.unit.id.replace(/^(prosecution|defense)-(unit|custom|word)-/, '#')}` : ''}</span></label>
              <p class="latin">${raw(
                o.op === 'edit' ? wordDiff(o.unit.textEn, o.para.text).map(([k, t]) => (k === '=' ? html`${t} ` : k === '+' ? html`<ins>${t}</ins> ` : html`<del>${t}</del> `)).join('')
                : o.op === 'add' ? html`<ins>${o.para.text}</ins>`
                : o.op === 'del' ? html`<del>${o.unit.textEn}</del>`
                : html`${o.unit.textEn.slice(0, 160)}…`)}</p>
              ${o.op !== 'del' && o.para.notes && o.para.notes.trim() !== (o.op === 'add' ? '' : o.unit.notesZh.trim()) ? raw(html`<p class="dim ws-note">提示：${o.para.notes}</p>`) : ''}
            </li>`);
          })}
        </ol>
        <div class="mg-row-inline">
          <label class="mono"><input type="checkbox" id="ws-notes-in" ${notes ? raw('checked') : ''}> 一併更新中文提示</label>
          <button class="btn primary" data-ws="apply">套用 ${accept.size} 項變更</button>
          <button class="btn ghost" data-ws="discard">放棄</button>
        </div>
      </section>`;
  }

  async function onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ws]');
    if (!b || !el) return;
    const side = ctx.side();
    switch (b.dataset.ws) {
      case 'export': {
        download(exportScript(ctx.data(), side, { notes, seat: seatOnly || undefined }), `口說稿_${side === 'prosecution' ? '檢方' : '辯方'}${seatOnly ? `_${SEAT_INFO[seatOnly].zh}` : ''}_${new Date().toISOString().slice(0, 10)}.docx`);
        return;
      }
      case 'pick': return $<HTMLInputElement>('#ws-file', el)?.click();
      case 'paste': {
        const t = $<HTMLTextAreaElement>('#ws-paste', el)?.value.trim();
        if (t) await load(null, '貼上的文字', t);
        return;
      }
      case 'link': {
        try {
          link = await pickLink(side);
          if (!link) return;
          perm = 'granted';
          const f = await link.handle.getFile();
          await rememberSeen(link, f.lastModified);
          await load(f, f.name);
          paint();
        } catch (err: any) {
          if (err?.name !== 'AbortError') ctx.status(`無法連結：${err?.message ?? err}`, true);
        }
        return;
      }
      case 'grant':
        if (link) perm = await linkPermission(link, true).catch(() => 'denied');
        paint();
        void checkLinked();
        return;
      case 'check':
        if (link) { link.last = 0; await checkLinked(); }
        return;
      case 'unlink':
        await forgetLink(side);
        link = null;
        paint();
        return;
      case 'all': accept = new Set(ops!.map((o, i) => (o.op === 'same' && !o.meta ? -1 : i)).filter((i) => i >= 0)); paint(); return;
      case 'none': accept.clear(); paint(); return;
      case 'discard': ops = null; paint(); return;
      case 'apply': {
        if (!ops) return;
        const dels = ops.filter((o, i) => o.op === 'del' && accept.has(i)).length;
        if (dels && !confirm(`確定刪除 ${dels} 個段落？連到這些段落的練習紀錄不受影響。`)) return;
        const r = applyDiff(ctx.data(), side, ops, { keepMarkers, notes, accept, seat: seatOnly || undefined });
        ops = null;
        ctx.saved(`Word 同步：修改 ${r.changed.length - r.added} 段、新增 ${r.added} 段、刪除 ${r.removed} 段。修改過的段落已排入口說教練重練。`);
        return;
      }
    }
  }

  function onChange(e: Event) {
    const t = e.target as HTMLInputElement;
    if (!el) return;
    if (t.id === 'ws-file' && t.files?.[0]) return void load(t.files[0], t.files[0].name);
    if (t.id === 'ws-notes' || t.id === 'ws-notes-in') { notes = t.checked; return; }
    if (t.id === 'ws-keep') { keepMarkers = t.checked; return; }
    if (t.id === 'ws-seat') { seatOnly = Number(t.value) as Seat | 0; ops = null; paint(); return; }
    if (t.dataset.op) {
      const i = Number(t.dataset.op);
      if (t.checked) accept.add(i); else accept.delete(i);
      const btn = $('[data-ws="apply"]', el);
      if (btn) btn.textContent = `套用 ${accept.size} 項變更`;
    }
  }

  function onDrop(e: DragEvent) {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    void load(f, f.name);
  }
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };

  return { mount, dispose, refreshLink, hasPending: () => !!ops, paint };
}
