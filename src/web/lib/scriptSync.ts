/**
 * Oral script ⇄ Word.
 *
 * The team edits the script in Word. This brings the edits back in without
 * losing what only the system knows (unit ids, the counsel seat, ⚖ bench
 * insertion points, Chinese notes, practice history):
 *
 *   exportScript()   our side's script as .docx: one Heading 1 per section, one
 *                    paragraph per unit, Chinese notes in a grey "Note" style
 *                    under their paragraph (optional), ⚖ markers kept inline
 *   parseScript()    a .docx / pasted text back into sections + paragraphs.
 *                    Headings (or lines that look like "Count 1: …") start a
 *                    section; mostly-Chinese paragraphs are notes of the
 *                    paragraph above; speaker lines set the seat
 *   diffScript()     aligns old units with new paragraphs (order-preserving,
 *                    similarity-based), so a reworded paragraph keeps its id
 *   applyDiff()      writes the accepted changes; changed units drop back in
 *                    the coach so they are re-memorised
 *
 * A linked file (File System Access API, Chrome / Edge) is checked every few
 * seconds while the page is open: save in Word, and the changes appear here.
 */
import type { OralUnit } from './debateData';
import type { DebateData } from './debateStorage';
import { buildDocx, type Block, type OutBlock } from './docx';
import { anchorsOf, cleanScript, oralOf, seatOf, SPEAKERS, type Seat, type Side } from './mootCourt';
import { markChanged } from './matchPrep';

/* ------------------------------------------------------------------ export */

export function exportScript(d: DebateData, side: Side, opts: { notes: boolean; seat?: Seat }): Blob {
  const units = oralOf(d, side).filter((u) => !opts.seat || seatOf(u) === opts.seat);
  const out: OutBlock[] = [{ kind: 'h', level: 1, text: `Oral Argument — ${side === 'prosecution' ? 'Prosecution' : 'Defence'}` }];
  out.push({ kind: 'p', note: true, text: '編輯說明：每個段落是系統中的一段；請保留「Heading 1」章節標題。方括號 [→法官題 P-01] 是法官插問點，可移動或刪除。灰色小字是中文提示，可修改。存檔後回到系統「Word 同步」即可更新。' });
  let sec = '';
  let seat: Seat | 0 = 0;
  for (const u of units) {
    if (u.section !== sec) {
      sec = u.section;
      out.push({ kind: 'h', level: 2, text: sec });
    }
    const s = seatOf(u);
    if (s !== seat) {
      seat = s;
      out.push({ kind: 'h', level: 3, text: SPEAKERS[s].label });
    }
    out.push({ kind: 'p', text: u.textEn });
    if (opts.notes && u.notesZh.trim()) out.push({ kind: 'p', note: true, text: u.notesZh });
  }
  return buildDocx(out);
}

/* ------------------------------------------------------------------ parse */

export interface Para { section: string; seat: Seat | 0; text: string; notes: string; }

const cjkRatio = (s: string) => {
  const t = s.replace(/\[→[^\]]*\]/g, '').replace(/\s/g, '');
  if (!t) return 0;
  return (t.match(/[　-〿一-鿿＀-￯]/g) ?? []).length / t.length;
};
const SECTION_RE = /^(Opening|開場|Preliminary Issues?|Count\s*[12]|Prayer|Rebuttal|Sur-?rebuttal|Conclusion|反駁|結論)\b.*$/i;
const SPEAKER_RE = /^(?:Speaker\s*([12])\b|First Counsel|Second Counsel|第[一二]辯士|楊昭容|陳姵彤)/i;

export function parseScript(blocks: Block[]): Para[] {
  const out: Para[] = [];
  let section = '';
  let seat: Seat | 0 = 0;
  for (const b of blocks) {
    if (b.kind === 'table') continue;
    const t = b.text.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (b.level === 1 && /^Oral Argument/i.test(t)) continue;
    if (b.style === 'Note' && /^編輯說明/.test(t)) continue;
    const sp = t.length < 80 ? SPEAKER_RE.exec(t) : null;
    if (sp && (b.level || t.length < 60)) {
      seat = sp[1] ? (Number(sp[1]) as Seat) : /楊|first|第一/i.test(t) ? 1 : 2;
      continue;
    }
    if ((b.level && b.level <= 2) || (t.length < 90 && SECTION_RE.test(t) && !/[.?!]$/.test(t))) {
      section = t;
      continue;
    }
    if (b.level >= 3) continue;
    if (b.style === 'Note' || cjkRatio(t) > 0.35) {
      if (out.length) out[out.length - 1].notes = (out[out.length - 1].notes ? out[out.length - 1].notes + '\n' : '') + b.text.trim();
      continue;
    }
    out.push({ section, seat, text: b.text.replace(/[ \t]+/g, ' ').trim(), notes: '' });
  }
  return out;
}

/* ------------------------------------------------------------------ diff */

const toks = (s: string) => cleanScript(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
function sim(a: string, b: string): number {
  const A = toks(a);
  const B = toks(b);
  if (!A.length && !B.length) return 1;
  if (!A.length || !B.length) return 0;
  const grams = (w: string[]) => { const s = new Map<string, number>(); for (let i = 0; i < w.length - 1; i++) { const k = w[i] + ' ' + w[i + 1]; s.set(k, (s.get(k) ?? 0) + 1); } if (w.length === 1) s.set(w[0], 1); return s; };
  const ga = grams(A);
  const gb = grams(B);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  const tot = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / tot;
}

export type Op =
  | { op: 'same'; unit: OralUnit; para: Para; meta: boolean }
  | { op: 'edit'; unit: OralUnit; para: Para; score: number }
  | { op: 'add'; para: Para; after: string }
  | { op: 'del'; unit: OralUnit };

const MATCH = 0.3;

/** Order-preserving alignment (Needleman–Wunsch on similarity). */
export function diffScript(units: OralUnit[], paras: Para[]): Op[] {
  const n = units.length;
  const m = paras.length;
  const S: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => sim(units[i].textEn, paras[j].text)));
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const take = S[i][j] >= MATCH ? S[i][j] + dp[i + 1][j + 1] : -Infinity;
      dp[i][j] = Math.max(take, dp[i + 1][j], dp[i][j + 1]);
    }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let lastId = '';
  while (i < n || j < m) {
    if (i < n && j < m && S[i][j] >= MATCH && dp[i][j] === S[i][j] + dp[i + 1][j + 1]) {
      const u = units[i];
      const p = paras[j];
      const same = cleanScript(u.textEn) === cleanScript(p.text) && sameMarkers(u.textEn, p.text);
      const metaChanged = (!!p.section && p.section !== u.section) || (!!p.seat && p.seat !== seatOf(u)) || (!!p.notes && p.notes.trim() !== u.notesZh.trim());
      ops.push(same ? { op: 'same', unit: u, para: p, meta: metaChanged } : { op: 'edit', unit: u, para: p, score: S[i][j] });
      lastId = u.id;
      i++; j++;
    } else if (i < n && (j >= m || dp[i][j] === dp[i + 1][j])) {
      ops.push({ op: 'del', unit: units[i] });
      lastId = units[i].id;
      i++;
    } else {
      ops.push({ op: 'add', para: paras[j], after: lastId });
      j++;
    }
  }
  return ops;
}

const sameMarkers = (a: string, b: string) => anchorsOf(a).map((x) => `${x.at}:${x.qid}`).join() === anchorsOf(b).map((x) => `${x.at}:${x.qid}`).join();

/** Word-level diff for display: [kind, text] runs. */
export function wordDiff(a: string, b: string): ['=' | '+' | '-', string][] {
  const A = a.split(/(\s+)/).filter((x) => x.trim());
  const B = b.split(/(\s+)/).filter((x) => x.trim());
  const n = A.length;
  const m = B.length;
  if (n * m > 400_000) return [['-', a], ['+', b]];
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: ['=' | '+' | '-', string][] = [];
  const push = (k: '=' | '+' | '-', w: string) => { const l = out[out.length - 1]; if (l && l[0] === k) l[1] += ' ' + w; else out.push([k, w]); };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++]);
    else push('+', B[j++]);
  }
  while (i < n) push('-', A[i++]);
  while (j < m) push('+', B[j++]);
  return out;
}

/* ------------------------------------------------------------------ apply */

/**
 * If Word dropped the ⚖ markers of a paragraph (e.g. pasted as plain text),
 * put them back at the same relative position, snapped to a sentence end.
 */
export function carryMarkers(oldText: string, newText: string): string {
  if (/\[→[^\]]*\]/.test(newText)) return newText;
  const old = anchorsOf(oldText);
  if (!old.length) return newText;
  const oldLen = cleanScript(oldText).split(/\s+/).filter(Boolean).length || 1;
  const words = newText.split(/\s+/).filter(Boolean);
  const inserts = new Map<number, string[]>();
  for (const a of old) {
    let at = Math.round((a.at / oldLen) * words.length);
    // move to the nearest sentence end at or after `at`
    let k = at;
    while (k > 0 && k < words.length && !/[.?!;:]["”’)]*$/.test(words[k - 1])) k++;
    if (k <= words.length) at = k;
    const tag = `[→${a.teacher ? '老師題' : '法官題'} ${a.qid}]`;
    inserts.set(at, [...(inserts.get(at) ?? []), tag]);
  }
  const out: string[] = [];
  for (let i = 0; i <= words.length; i++) {
    if (inserts.has(i)) out.push(...inserts.get(i)!);
    if (i < words.length) out.push(words[i]);
  }
  return out.join(' ');
}

export interface ApplyOpts {
  keepMarkers: boolean; notes: boolean; accept: Set<number>;
  /** The Word file held only this counsel's part: the other counsel's units stay where they are. */
  seat?: Seat;
}

/** Write accepted ops into the side's script. Returns ids of units whose wording changed. */
export function applyDiff(d: DebateData, side: Side, ops: Op[], o: ApplyOpts): { changed: string[]; added: number; removed: number } {
  const full = oralOf(d, side);
  const list = o.seat ? full.filter((u) => seatOf(u) === o.seat) : full;
  const next: OralUnit[] = [];
  const changed: string[] = [];
  let added = 0;
  let removed = 0;
  let lastSection = list[0]?.section ?? 'Custom';
  let lastSeat: Seat = 1;
  const taken = new Set(list.map((u) => u.id));
  const newId = () => { let k = taken.size + 1; while (taken.has(`${side}-word-${String(k).padStart(3, '0')}`)) k++; const id = `${side}-word-${String(k).padStart(3, '0')}`; taken.add(id); return id; };
  ops.forEach((op, idx) => {
    const ok = o.accept.has(idx);
    if (op.op === 'del') {
      if (ok) { removed++; return; }
      next.push(op.unit);
      lastSection = op.unit.section; lastSeat = seatOf(op.unit);
      return;
    }
    if (op.op === 'add') {
      if (!ok) return;
      const seat = (op.para.seat || lastSeat) as Seat;
      const u: OralUnit = {
        id: newId(), side, speaker: SPEAKERS[seat].label, speakerId: SPEAKERS[seat].id, seat,
        section: op.para.section || lastSection, textEn: op.para.text, notesZh: o.notes ? op.para.notes : '', qa: [],
      };
      next.push(u);
      changed.push(u.id);
      added++;
      lastSection = u.section; lastSeat = seat;
      return;
    }
    const u = op.unit;
    if (ok) {
      if (op.op === 'edit') {
        u.textEn = o.keepMarkers ? carryMarkers(u.textEn, op.para.text) : op.para.text;
        changed.push(u.id);
      }
      if (op.para.section) u.section = op.para.section;
      if (op.para.seat && op.para.seat !== seatOf(u)) { u.seat = op.para.seat; u.speaker = SPEAKERS[op.para.seat].label; u.speakerId = SPEAKERS[op.para.seat].id; }
      if (o.notes && op.para.notes.trim()) u.notesZh = op.para.notes;
    }
    next.push(u);
    lastSection = u.section; lastSeat = seatOf(u);
  });
  if (!o.seat) full.splice(0, full.length, ...next);
  else {
    // keep the other counsel's units in place; new units follow the kept unit before them
    const pos = new Map(next.map((u, i) => [u, i]));
    const out: OralUnit[] = [];
    let k = 0;
    for (const u of full) {
      if (seatOf(u) !== o.seat && !pos.has(u)) { out.push(u); continue; }
      const i = pos.get(u);
      if (i == null) continue; // removed
      while (k <= i) out.push(next[k++]);
    }
    while (k < next.length) out.push(next[k++]);
    full.splice(0, full.length, ...out);
  }
  markChanged(changed, 'Word 同步');
  return { changed, added, removed };
}

/* ------------------------------------------------------------------ linked file */

type Handle = FileSystemFileHandle & { queryPermission?: (o: any) => Promise<string>; requestPermission?: (o: any) => Promise<string> };
const IDB = 'debate-word-link';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('h', mode);
    const rq = fn(tx.objectStore('h'));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

export const canLink = () => typeof (window as any).showOpenFilePicker === 'function';

export interface Link { handle: Handle; name: string; side: Side; last: number; }

export async function pickLink(side: Side): Promise<Link | null> {
  if (!canLink()) return null;
  const [h] = await (window as any).showOpenFilePicker({
    types: [{ description: 'Word / 文字', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'text/plain': ['.txt', '.md'] } }],
  });
  const f = await h.getFile();
  const link: Link = { handle: h, name: f.name, side, last: 0 };
  await idbDo('readwrite', (s) => s.put({ handle: h, name: f.name, last: 0 }, side));
  return link;
}

export async function savedLink(side: Side): Promise<Link | null> {
  try {
    const v = await idbDo<any>('readonly', (s) => s.get(side));
    return v?.handle ? { handle: v.handle, name: v.name, side, last: v.last ?? 0 } : null;
  } catch { return null; }
}
export async function rememberSeen(link: Link, last: number) {
  link.last = last;
  try { await idbDo('readwrite', (s) => s.put({ handle: link.handle, name: link.name, last }, link.side)); } catch {}
}
export async function forgetLink(side: Side) {
  try { await idbDo('readwrite', (s) => s.delete(side)); } catch {}
}

/** 'granted' | 'prompt' | 'denied'; asks only when `ask` (needs a click). */
export async function linkPermission(link: Link, ask: boolean): Promise<string> {
  const o = { mode: 'read' };
  let p = (await link.handle.queryPermission?.(o)) ?? 'granted';
  if (p !== 'granted' && ask) p = (await link.handle.requestPermission?.(o)) ?? p;
  return p;
}

/** The file when it changed since `last`, else null. */
export async function readIfChanged(link: Link): Promise<File | null> {
  const f = await link.handle.getFile();
  return f.lastModified > link.last ? f : null;
}
