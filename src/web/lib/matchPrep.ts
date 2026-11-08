/**
 * 對戰準備 Match preparation — one record per scheduled round, reusable for
 * every match of the season.
 *
 *   schedule      parse the organiser's schedule (PDF / Word / text) into rounds
 *                 for our team: time, room, our side, opponent
 *   memorial      the opponent's written memorial, split into numbered ¶ with
 *                 headings and footnotes, so every claim can point at its ¶
 *   reading       導讀: their structure, what each part claims, how they will
 *                 likely say it in court, what they concede, what they leave out
 *   assess        應對評估: points for us, risks with level and response,
 *                 priorities, things to verify before using them
 *   script        稿件調整: concrete fixes to our oral script (located in the
 *                 script and applicable with one click), arguments to add,
 *                 expected attacks and answers, time plan, rebuttal points,
 *                 bench Q&A, courtroom reminders
 *
 * Everything lives in the shared bank (DebateData.matches) so it is published
 * with the scripts. Content can come from (a) the team's own analysis written
 * in Word (tables are recognised by their header row), (b) Claude, (c) the
 * offline cross-check, or (d) typing. Every item keeps where it came from.
 */
import type { DebateData } from './debateStorage';
import type { BenchQuestion, OralUnit } from './debateData';
import { type Block, blocksText } from './docx';
import { cleanScript, loadMastery, saveMastery, oralOf, questionsOf, seatOf, shortSection, wordsCount, estimateSec, SEAT_INFO, type Side } from './mootCourt';
import { callClaude, resolveEngine, localLLMReady } from './debateAI';
import { loadSettings, streamChat, type Msg } from '../llm/backends';

export type Source = 'word' | 'ai' | 'auto' | 'me';
export type Level = '高' | '中高' | '中' | '低';

export interface MemorialPara { n: string; text: string; head: string; }
export interface Memorial { name: string; words: number; paras: MemorialPara[]; notes: Record<string, string>; importedAt: number; }

export interface Claim { issue: string; claim: string; paras: string; predict: string; strength?: 'strong' | 'medium' | 'weak'; read?: boolean; mine?: string; src: Source; }
export interface Admission { text: string; paras: string; use: string; src: Source; }
export interface Pro { point: string; basis: string; use: string; src: Source; }
export interface Con { risk: string; detail: string; level: Level; response: string; mine?: string; src: Source; }
export interface Check { text: string; done: boolean; src: Source; }
export interface Fix {
  where: string; current: string; problem: string; suggest: string;
  /** English text that replaces `current` verbatim; '' = needs a person to rewrite */
  replacement: string;
  unit?: string;
  status: 'open' | 'applied' | 'skipped';
  src: Source;
}
export interface Attack { claim: string; response: string; cite: string; src: Source; }
export interface Timing { part: string; minutes: number; focus: string; src: Source; }
export interface Qa {
  question: string; answer: string; avoid: string; qid?: string;
  /** English bench wording, answer outline and a sample answer (filled by AI or typed) */
  en?: string; structure?: string[]; sampleEn?: string;
  src: Source;
}

export interface MatchPrep {
  id: string;
  round: string;
  date: string; // YYYY-MM-DD
  time: string; // 10:00–11:40
  room: string;
  ourSide: Side;
  ourTeam: string; // P04
  oppTeam: string; // D01
  memorial: Memorial | null;
  reading: { summary: string[]; claims: Claim[]; admissions: Admission[]; gaps: string[] };
  assess: { pros: Pro[]; cons: Con[]; priorities: string[]; verify: Check[] };
  script: { directions: string[]; fixes: Fix[]; additions: Check[]; attacks: Attack[]; timing: Timing[]; rebuttal: string[]; qa: Qa[]; reminders: string[] };
  sources: { name: string; kind: string; at: number }[];
  updatedAt: number;
}

export interface PrepMeta { team: string; facts: string; factsName: string; }

/* ------------------------------------------------------------------ store */

export const matchesOf = (d: DebateData): MatchPrep[] => (d.matches ??= []);
export const prepMeta = (d: DebateData): PrepMeta => (d.prep ??= { team: '', facts: '', factsName: '' });

export function blankMatch(p: Partial<MatchPrep> = {}): MatchPrep {
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    round: '', date: '', time: '', room: '', ourSide: 'prosecution', ourTeam: '', oppTeam: '',
    memorial: null,
    reading: { summary: [], claims: [], admissions: [], gaps: [] },
    assess: { pros: [], cons: [], priorities: [], verify: [] },
    script: { directions: [], fixes: [], additions: [], attacks: [], timing: [], rebuttal: [], qa: [], reminders: [] },
    sources: [],
    updatedAt: Date.now(),
    ...p,
  };
}

export const matchTitle = (m: MatchPrep) =>
  `${m.ourSide === 'prosecution' ? `${m.ourTeam || 'P??'} v. ${m.oppTeam || 'D??'}` : `${m.oppTeam || 'P??'} v. ${m.ourTeam || 'D??'}`}`;

const ACTIVE_KEY = 'debate_active_match_v1';
export function activeMatchId(): string {
  try { return localStorage.getItem(ACTIVE_KEY) ?? ''; } catch { return ''; }
}
export function setActiveMatch(id: string) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
}
/** The match the drills focus on, when it belongs to this side. */
export function focusMatch(d: DebateData, side: Side): MatchPrep | null {
  const m = matchesOf(d).find((x) => x.id === activeMatchId());
  return m && m.ourSide === side ? m : null;
}

/** Progress of a match through the five steps (0..1 each). */
export function progress(m: MatchPrep) {
  const claims = m.reading.claims;
  const fixes = m.script.fixes;
  return {
    memorial: m.memorial ? 1 : 0,
    reading: claims.length ? claims.filter((c) => c.read).length / claims.length : 0,
    assess: m.assess.cons.length ? m.assess.cons.filter((c) => (c.mine ?? '').trim()).length / m.assess.cons.length : (m.assess.pros.length ? 0.5 : 0),
    script: fixes.length ? fixes.filter((f) => f.status !== 'open').length / fixes.length : (m.script.attacks.length ? 0.5 : 0),
    drill: m.script.qa.length ? m.script.qa.filter((q) => q.qid).length / m.script.qa.length : 0,
  };
}

/* ------------------------------------------------------------------ changed units */

const CHANGED_KEY = 'debate_changed_units_v1';
/** Units whose wording changed (Word sync, applied fixes): memory drops back so they get re-drilled. */
export function markChanged(ids: string[], why: string) {
  if (!ids.length) return;
  const m = loadMastery();
  for (const id of ids) if (m[id]) m[id] = { ...m[id], level: Math.min(m[id].level, 1) };
  saveMastery(m);
  const c = changedUnits();
  for (const id of ids) c[id] = { at: Date.now(), why };
  try { localStorage.setItem(CHANGED_KEY, JSON.stringify(c)); } catch {}
}
export function changedUnits(): Record<string, { at: number; why: string }> {
  try { return JSON.parse(localStorage.getItem(CHANGED_KEY) || '{}'); } catch { return {}; }
}
export function clearChanged(id?: string) {
  const c = changedUnits();
  if (id) delete c[id]; else for (const k of Object.keys(c)) delete c[k];
  try { localStorage.setItem(CHANGED_KEY, JSON.stringify(c)); } catch {}
}

/* ------------------------------------------------------------------ schedule */

export interface Fixture { round: string; date: string; time: string; room: string; prosecutor: string; defence: string; }

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** All "P04 v. D01" pairings with the time, room, day and round they sit under. */
export function parseSchedule(lines: string[]): Fixture[] {
  let year = new Date().getFullYear();
  const y = lines.join(' ').match(/\b(20\d\d)\b/);
  if (y) year = Number(y[1]);
  let date = '';
  let round = '';
  let time = '';
  let rooms: string[] = [];
  const out: Fixture[] = [];
  const TIME = /(\d{1,2}:\d{2})\s*[-–~～]\s*(\d{1,2}:\d{2})/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const md = l.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[（(]/) ?? l.match(/(\d{1,2})\/(\d{1,2})/);
    const en = l.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i);
    if (en) date = `${year}-${String(MONTHS[en[2].toLowerCase()]).padStart(2, '0')}-${en[1].padStart(2, '0')}`;
    else if (md && !TIME.test(l) && /行程|Day|日|（|\(/.test(l)) date = `${year}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
    const pairs = [...l.matchAll(/\bP\s*(\d{1,2})\s*v{1,2}\.?\s*D\s*(\d{1,2})\b/gi)];
    if (/Round|初賽|準決賽|決賽|複賽/i.test(l) && !pairs.length && !/Feedback|回饋/i.test(l)) round = l.replace(/\s+/g, ' ');
    const t = l.match(TIME);
    if (t && !/Feedback|回饋|Lunch|午餐|Break|休息/i.test(l)) time = `${t[1]}–${t[2]}`;
    const nums = l.replace(TIME, '').match(/\b\d{3}\b/g);
    if (nums && nums.length >= 2 && !pairs.length && l.replace(/\b\d{3}\b|\d{1,2}:\d{2}|[-–\s]/g, '') === '') rooms = nums;
    if (!pairs.length) continue;
    // a time printed on the line just after the pairings (second-round layout)
    let tm = t ? `${t[1]}–${t[2]}` : time;
    if (!t) {
      const nx = (lines[i + 1] ?? '').match(TIME);
      if (nx && !/Feedback|回饋/i.test(lines[i + 1])) tm = `${nx[1]}–${nx[2]}`;
    }
    const lineRooms = (l.replace(TIME, '').match(/\b\d{3}\b/g) ?? []);
    pairs.forEach((p, k) => {
      out.push({
        round, date, time: tm,
        room: rooms[k] ?? (lineRooms.length === pairs.length ? lineRooms[k] : ''),
        prosecutor: `P${p[1].padStart(2, '0')}`,
        defence: `D${p[2].padStart(2, '0')}`,
      });
    });
  }
  return out;
}

/** Rounds for our team number ("04"), newest settings kept for existing ones. */
export function fixturesFor(team: string, fx: Fixture[]): Partial<MatchPrep>[] {
  const t = team.replace(/\D/g, '').padStart(2, '0');
  return fx
    .filter((f) => f.prosecutor === `P${t}` || f.defence === `D${t}`)
    .map((f) => {
      const ourSide: Side = f.prosecutor === `P${t}` ? 'prosecution' : 'defense';
      return {
        round: f.round, date: f.date, time: f.time, room: f.room, ourSide,
        ourTeam: ourSide === 'prosecution' ? f.prosecutor : f.defence,
        oppTeam: ourSide === 'prosecution' ? f.defence : f.prosecutor,
      };
    });
}

/* ------------------------------------------------------------------ memorial */

const HEAD_RE = /^([A-H]|[IVX]{1,4}|[a-h])\.\s+\S/;

/** Split memorial text blocks into numbered ¶, headings and footnotes. */
export function splitMemorial(blocks: Block[], name: string): Memorial {
  const paras: MemorialPara[] = [];
  const notes: Record<string, string> = {};
  let head = '';
  let big = '';
  let cur: MemorialPara | null = null;
  let lastNote = '';
  let words = 0;
  for (const b of blocks) {
    if (b.kind === 'table') { if (cur) cur.text += '\n' + b.rows.map((r) => r.join(' | ')).join('\n'); continue; }
    const t = b.text.trim();
    if (!t) continue;
    if (b.style === 'small') {
      const m = /^(\d{1,3})\s+(.*)$/.exec(t);
      if (m) { notes[m[1]] = m[2]; lastNote = m[1]; }
      else if (/^\d{1,3}$/.test(t)) { lastNote = t; notes[t] = ''; }
      else if (lastNote) notes[lastNote] = (notes[lastNote] + ' ' + t).trim();
      continue;
    }
    const num = /^(?:¶\s*)?\[?(\d{1,3})\]?[.)]?\s+(.*)$/.exec(t);
    if (num && Number(num[1]) <= 400 && (paras.length === 0 || Number(num[1]) >= Number(paras[paras.length - 1].n))) {
      cur = { n: num[1], text: num[2], head: [big, head].filter(Boolean).join(' › ') };
      paras.push(cur);
      words += num[2].split(/\s+/).length;
      continue;
    }
    if (b.level || HEAD_RE.test(t) || (t === t.toUpperCase() && /[A-Z]{4}/.test(t) && t.length < 140)) {
      if (t === t.toUpperCase() && !HEAD_RE.test(t)) { big = t; head = ''; } else head = t;
      cur = null;
      continue;
    }
    if (cur && /^[a-z(“"'‘]/.test(t)) { cur.text += ' ' + t; words += t.split(/\s+/).length; continue; }
    if (cur && !/[.:;]$/.test(cur.text)) { cur.text += ' ' + t; words += t.split(/\s+/).length; continue; }
    // unnumbered prose (introductions, prayer)
    cur = { n: '', text: t, head: [big, head].filter(Boolean).join(' › ') };
    paras.push(cur);
    words += t.split(/\s+/).length;
  }
  return { name, words, paras, notes, importedAt: Date.now() };
}

export function memorialText(m: Memorial, max = 60_000): string {
  let out = '';
  let lastHead = '';
  for (const p of m.paras) {
    if (p.head !== lastHead) { out += `\n## ${p.head}\n`; lastHead = p.head; }
    out += `${p.n ? `¶${p.n} ` : ''}${p.text}\n`;
    if (out.length > max) break;
  }
  return out.slice(0, max);
}

/* ------------------------------------------------------------------ offline cross-check */

const CASE_RE = /\b(Tadi[cć]|Lubanga|Katanga|Bemba|Ntaganda|Ongwen|Al[- ]Hassan|Kunarac|Delali[cć]|Bla[sš]ki[cć]|Gali[cć]|Strugar|Kordi[cć]|Prli[cć]|Abu Garda|Banda|Mbarushimana|Kupre[sš]ki[cć]|Gotovina|Furund[zž]ija|Akayesu|Brima|Caroline|Nicaragua|Oil Platforms|Armed Activities)(?![A-Za-z])/gi;
const ART_RE = /\b(?:Art(?:icle)?s?\.?\s*)(\d+(?:\(\d+\))*(?:\([a-z]+\))*(?:\([ivx]+\))*)/gi;
const FACT_RE = /(?:SAF|Facts?)\s*,?\s*¶{1,2}\s*([\d–\-, ()a-z]+)/gi;
const ADMIT_RE = /\b(does not dispute|do(?:es)? not contest|concedes?|accepts? that|admits?|acknowledges?|although|even if|it is not disputed|undisputed|while .{0,40} (?:may|might))\b/i;

export interface CrossCheck {
  cases: { name: string; paras: string[]; inOurs: boolean }[];
  articles: { name: string; paras: string[]; inOurs: boolean }[];
  facts: { n: string; paras: string[]; inOurs: boolean }[];
  admissions: Admission[];
  heads: { head: string; paras: string[] }[];
}

/** No model needed: what they cite, what they concede, what our script never touches. */
export function crossCheck(m: Memorial, ours: OralUnit[]): CrossCheck {
  const script = ours.map((u) => cleanScript(u.textEn)).join(' ');
  const scriptLow = script.toLowerCase();
  const casesM = new Map<string, Set<string>>();
  const artsM = new Map<string, Set<string>>();
  const factsM = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, k: string, n: string) => { if (!map.has(k)) map.set(k, new Set()); map.get(k)!.add(n || '前言'); };
  const headM = new Map<string, string[]>();
  const admissions: Admission[] = [];
  for (const p of m.paras) {
    const all = `${p.text} ${Object.entries(m.notes).filter(([k]) => new RegExp(`\\D${k}(?:\\D|$)`).test(` ${p.text} `)).map(([, v]) => v).join(' ')}`;
    for (const x of all.matchAll(CASE_RE)) add(casesM, x[1].replace(/[cć]$/i, 'ć').replace(/^./, (c) => c.toUpperCase()), p.n);
    for (const x of p.text.matchAll(ART_RE)) add(artsM, `Art ${x[1]}`, p.n);
    for (const x of all.matchAll(FACT_RE)) for (const n of x[1].split(/[,，]/)) { const v = n.trim().match(/^\d+/); if (v) add(factsM, v[0], p.n); }
    if (p.head) { if (!headM.has(p.head)) headM.set(p.head, []); headM.get(p.head)!.push(p.n); }
    const sentence = p.text.split(/(?<=[.;])\s+/).find((s) => ADMIT_RE.test(s));
    if (sentence) admissions.push({ text: sentence.slice(0, 320), paras: p.n ? `¶${p.n}` : '', use: '', src: 'auto' });
  }
  const inScript = (k: string) => scriptLow.includes(k.toLowerCase().replace(/ć/g, 'c')) || scriptLow.includes(k.toLowerCase());
  const factInScript = (n: string) => new RegExp(`(facts?|paragraph|para\\.?|¶)\\s*\\[?${n}\\b`, 'i').test(script);
  const list = (map: Map<string, Set<string>>, test: (k: string) => boolean) =>
    [...map].map(([name, s]) => ({ name, paras: [...s], inOurs: test(name.replace(/^Art /, 'Article ')) || test(name) }))
      .sort((a, b) => Number(a.inOurs) - Number(b.inOurs) || b.paras.length - a.paras.length);
  return {
    cases: list(casesM, inScript),
    articles: list(artsM, (k) => inScript(k.replace(/^Article /, '').replace(/^Art /, '')) && inScript(k.replace(/^Art /, 'Article ').split('(')[0])),
    facts: [...factsM].map(([n, s]) => ({ n, paras: [...s], inOurs: factInScript(n) })).sort((a, b) => Number(a.n) - Number(b.n)),
    admissions: admissions.slice(0, 20),
    heads: [...headM].map(([head, paras]) => ({ head, paras })),
  };
}

/** Planned minutes per part vs. what our script takes at courtroom pace. */
export function timingCheck(units: OralUnit[]) {
  const by = new Map<string, { words: number; seat: number }>();
  for (const u of units) {
    const k = shortSection(u.section);
    const v = by.get(k) ?? { words: 0, seat: seatOf(u) };
    v.words += wordsCount(u.textEn);
    by.set(k, v);
  }
  return [...by].map(([part, v]) => ({ part, seat: v.seat, sec: estimateSec(v.words), words: v.words }));
}

/* ------------------------------------------------------------------ locate a fix in the script */

const normQ = (s: string) => s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** The verbatim fragment(s) quoted in a "current wording" cell. */
export function quotedFragments(s: string): string[] {
  const q = [...normQ(s).matchAll(/"([^"]{4,})"/g)].map((m) => m[1]);
  const base = q.length ? q : [normQ(s)];
  return base.flatMap((x) => x.split(/\s*(?:…|\.\.\.)\s*/)).map((x) => x.trim()).filter((x) => x.length >= 4 && /[A-Za-z]/.test(x));
}

export interface Located { unit: OralUnit; start: number; end: number; fragment: string; }

/** Find where in our script a fix points: exact fragment first, then the longest matching word run. */
export function locateFix(f: Fix, units: OralUnit[]): Located | null {
  const frags = quotedFragments(f.current).sort((a, b) => b.length - a.length);
  if (f.unit) {
    const u = units.find((x) => x.id === f.unit);
    if (u) {
      for (const fr of frags) {
        const i = normQ(u.textEn).toLowerCase().indexOf(fr.toLowerCase());
        if (i >= 0) return { unit: u, ...span(u.textEn, i, fr.length), fragment: fr };
      }
    }
  }
  for (const fr of frags) {
    for (const u of units) {
      const i = normQ(u.textEn).toLowerCase().indexOf(fr.toLowerCase());
      if (i >= 0) return { unit: u, ...span(u.textEn, i, fr.length), fragment: fr };
    }
  }
  // fuzzy: longest run of ≥4 consecutive words from the fragment
  for (const fr of frags) {
    const w = fr.split(/\s+/);
    for (let len = Math.min(w.length, 10); len >= 4; len--) {
      for (let s = 0; s + len <= w.length; s++) {
        const piece = w.slice(s, s + len).join(' ').toLowerCase();
        for (const u of units) {
          const i = normQ(u.textEn).toLowerCase().indexOf(piece);
          if (i >= 0) return { unit: u, ...span(u.textEn, i, piece.length), fragment: piece };
        }
      }
    }
  }
  return null;
}

/** normQ only collapses whitespace and quote shapes; map an index back onto the raw text. */
function span(raw: string, i: number, len: number): { start: number; end: number } {
  let r = 0;
  let n = 0;
  const t = raw.replace(/^\s+/, '');
  const lead = raw.length - t.length;
  const map: number[] = [];
  let prevSpace = false;
  for (r = 0; r < t.length; r++) {
    const sp = /\s/.test(t[r]);
    if (sp && prevSpace) continue;
    map[n++] = r;
    prevSpace = sp;
  }
  map[n] = t.length;
  return { start: lead + (map[i] ?? 0), end: lead + (map[Math.min(i + len, n)] ?? t.length) };
}

/** An English replacement quoted in the suggestion cell, e.g. 改為 “between 2 and 10 April 2025”. */
export function suggestedReplacement(s: string): string {
  const q = [...normQ(s).matchAll(/"([^"]{3,})"/g)].map((m) => m[1]).filter((x) => /[A-Za-z]/.test(x) && !/[一-鿿]/.test(x));
  return q[0] ?? '';
}

/* ------------------------------------------------------------------ Word analysis import */

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const lv = (s: string): Level => (/中高/.test(s) ? '中高' : /高/.test(s) ? '高' : /低/.test(s) ? '低' : '中');
const bulletText = (s: string) => clean(s.replace(/^\s*([-•●▪]|\d+[.)、])\s*/, ''));

export interface ImportResult { kind: 'memorial-analysis' | 'script-adjustment' | 'mixed'; meta: Record<string, string>; added: Record<string, number>; }

/**
 * Read the team's own analysis written in Word (書狀分析 / 口說稿調整). Tables
 * are recognised by their header row, lists by the section heading above them.
 * Merges into the match; nothing already there is removed.
 */
export function importAnalysis(m: MatchPrep, blocks: Block[], name: string): ImportResult {
  const text = blocksText(blocks);
  const kind: ImportResult['kind'] = /口說稿調整|口說稿/.test(text.slice(0, 400)) ? 'script-adjustment' : /書狀分析|利弊/.test(text.slice(0, 400)) ? 'memorial-analysis' : 'mixed';
  const added: Record<string, number> = {};
  const inc = (k: string, n = 1) => (added[k] = (added[k] ?? 0) + n);
  const meta: Record<string, string> = {};
  let section = '';
  let sub = '';
  const src: Source = 'word';
  const push = <T>(arr: T[], item: T, key: string, same: (a: T) => boolean) => { if (!arr.some(same)) { arr.push(item); inc(key); } };

  for (const b of blocks) {
    if (b.kind === 'table') {
      const rows = b.rows.filter((r) => r.some((c) => c.trim()));
      if (!rows.length) continue;
      const h = rows[0].map(clean).join('|');
      const body = rows.slice(1);
      const col = (r: string[], i: number) => clean(r[i] ?? '');
      if (rows.length === 1 && rows[0].length === 1 || rows.every((r) => r.length === 1)) {
        // boxed summary: first line is the title, bullets follow
        const lines = rows.map((r) => r[0]).join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
        const title = lines[0] ?? '';
        const items = lines.slice(1).map(bulletText).filter(Boolean);
        if (/Q&A|需要修正/.test(title)) items.forEach((x) => push(m.script.directions, `${title.replace(/[:：]$/, '')}：${x}`, 'directions', (a) => a.endsWith(x)));
        else if (kind === 'script-adjustment') items.forEach((x) => push(m.script.directions, x, 'directions', (a) => a === x));
        else items.forEach((x) => push(m.reading.summary, x, 'summary', (a) => a === x));
        continue;
      }
      if (/^項目\|內容/.test(h) || (rows[0].length === 2 && /項目|賽事/.test(h))) {
        for (const r of rows) meta[clean(r[0])] = clean(r[1] ?? '');
        continue;
      }
      if (/對方主張/.test(h)) {
        for (const r of body) push(m.reading.claims, { issue: col(r, 0), claim: col(r, 1), paras: col(r, 2), predict: '', src }, 'claims', (a) => a.issue === col(r, 0) && a.claim === col(r, 1));
      } else if (/有利點/.test(h)) {
        const o = rows[0].length >= 4 ? 1 : 0;
        for (const r of body) push(m.assess.pros, { point: col(r, o), basis: col(r, o + 1), use: col(r, o + 2), src }, 'pros', (a) => a.point === col(r, o));
      } else if (/風險/.test(h) && /應對/.test(h)) {
        for (const r of body) push(m.assess.cons, { risk: col(r, 0).replace(/^\d+[.、]\s*/, ''), detail: col(r, 1), level: lv(col(r, 2)), response: col(r, 3), src }, 'cons', (a) => a.risk === col(r, 0).replace(/^\d+[.、]\s*/, ''));
      } else if (/現稿/.test(h)) {
        for (const r of body) {
          const f: Fix = { where: col(r, 0), current: col(r, 1), problem: col(r, 2), suggest: col(r, 3), replacement: suggestedReplacement(col(r, 3)), status: 'open', src };
          push(m.script.fixes, f, 'fixes', (a) => a.current === f.current);
        }
      } else if (/對方論點/.test(h)) {
        for (const r of body) push(m.script.attacks, { claim: col(r, 0), response: col(r, 1), cite: col(r, 2), src }, 'attacks', (a) => a.claim === col(r, 0));
      } else if (/建議時間/.test(h)) {
        for (const r of body) push(m.script.timing, { part: col(r, 0), minutes: Number((col(r, 1).match(/[\d.]+/) ?? ['0'])[0]), focus: col(r, 2), src }, 'timing', (a) => a.part === col(r, 0));
      } else if (/法官問題|可能的問題/.test(h)) {
        for (const r of body) push(m.script.qa, { question: col(r, 0), answer: col(r, 1), avoid: col(r, 2), src }, 'qa', (a) => a.question === col(r, 0));
      } else if (/核對|查證/.test(h)) {
        for (const r of body) push(m.assess.verify, { text: body.length ? r.map(clean).join('：') : '', done: false, src }, 'verify', (a) => a.text === r.map(clean).join('：'));
      }
      continue;
    }
    const t = b.text.trim();
    if (!t) continue;
    if (/^[一二三四五六七八九十]+、/.test(t) || (b.level && b.level <= 2)) { section = t; sub = ''; continue; }
    if (!b.list && /[：:]$/.test(t)) { sub = t; continue; }
    const gap = /^對方書狀未處理的事項[：:](.*)$/.exec(t);
    if (gap) {
      const body = gap[1].split(/[。]/)[0];
      body.split(/[、；;]/).map(clean).filter(Boolean).forEach((x) => push(m.reading.gaps, x, 'gaps', (a) => a === x));
      continue;
    }
    if (!b.list && !/^[-•●▪]/.test(t)) continue;
    const item = bulletText(t);
    const where = `${section} ${sub}`;
    if (/反駁|rebuttal/i.test(sub)) push(m.script.rebuttal, item, 'rebuttal', (a) => a === item);
    else if (/優先/.test(where)) push(m.assess.priorities, item, 'priorities', (a) => a === item);
    else if (/核對|查證/.test(where)) push(m.assess.verify, { text: item, done: false, src }, 'verify', (a) => a.text === item);
    else if (/新增/.test(where)) push(m.script.additions, { text: item, done: false, src }, 'additions', (a) => a.text === item);
    else if (/臨場|提醒/.test(where)) push(m.script.reminders, item, 'reminders', (a) => a === item);
    else if (/反駁/.test(where)) push(m.script.rebuttal, item, 'rebuttal', (a) => a === item);
    else if (/結論|重點/.test(where)) push(m.reading.summary, item, 'summary', (a) => a === item);
  }
  // header table: 場次 "12/5（六）10:00–11:40 501 教室 P04 v. D01"
  const field = meta['場次'] ?? '';
  if (field) {
    const t = field.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    if (t && !m.time) m.time = `${t[1]}–${t[2]}`;
    const r = field.match(/\b(\d{3})\s*教室/);
    if (r && !m.room) m.room = r[1];
    const d = field.match(/(\d{1,2})\/(\d{1,2})/);
    if (d && !m.date) m.date = `${new Date().getFullYear()}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`;
  }
  if (!m.round && meta['賽事']) m.round = meta['賽事'].replace(/^.*?(初賽|準決賽|決賽)/, '$1');
  m.sources.push({ name, kind: kind === 'script-adjustment' ? '口說稿調整（Word）' : kind === 'memorial-analysis' ? '書狀分析（Word）' : 'Word 文件', at: Date.now() });
  m.updatedAt = Date.now();
  return { kind, meta, added };
}

/* ------------------------------------------------------------------ AI */

export type PrepStep = 'read' | 'assess' | 'script' | 'qa';

interface AiRead { summary: string[]; claims: { issue: string; claim: string; paras: string; predict: string; strength: 'strong' | 'medium' | 'weak' }[]; admissions: { text: string; paras: string; use: string }[]; gaps: string[]; }
interface AiAssess { pros: { point: string; basis: string; use: string }[]; cons: { risk: string; detail: string; level: Level; response: string }[]; priorities: string[]; verify: string[]; }
interface AiScript { directions: string[]; fixes: { unit: string; where: string; current: string; problem: string; suggest: string; replacement: string }[]; additions: string[]; attacks: { claim: string; response: string; cite: string }[]; timing: { part: string; minutes: number; focus: string }[]; rebuttal: string[]; reminders: string[]; }
interface AiQa { qa: { question: string; questionZh: string; answer: string; avoid: string; structure: string[]; sampleEn: string }[]; }
export type AiOut = AiRead | AiAssess | AiScript | AiQa;

/** What one step sends: the memorial, the facts, our script (for script/qa), and what is already known. */
export function prepInput(d: DebateData, m: MatchPrep, step: PrepStep) {
  const meta = prepMeta(d);
  const ours = oralOf(d, m.ourSide);
  const bySeat = (s: 1 | 2) => SEAT_INFO[s].en;
  return {
    step,
    ourSide: m.ourSide,
    match: `${matchTitle(m)} · ${m.round} · ${m.date} ${m.time}`,
    memorial: m.memorial ? memorialText(m.memorial, step === 'qa' ? 30_000 : 60_000) : '',
    facts: meta.facts.slice(0, step === 'read' ? 30_000 : 45_000),
    script: step === 'script' || step === 'qa'
      ? ours.map((u) => `[${u.id}] (${bySeat(seatOf(u))} · ${shortSection(u.section)}) ${u.textEn}`).join('\n').slice(0, 70_000)
      : '',
    known: step === 'read' ? '' : JSON.stringify({
      claims: m.reading.claims.map((c) => ({ issue: c.issue, claim: c.claim, paras: c.paras })),
      admissions: m.reading.admissions.map((a) => a.text),
      cons: m.assess.cons.map((c) => ({ risk: c.risk, level: c.level })),
      priorities: m.assess.priorities,
      qa: m.script.qa.map((q) => q.question),
    }).slice(0, 12_000),
  };
}

function localPrompt(input: ReturnType<typeof prepInput>): Msg[] {
  const want: Record<PrepStep, string> = {
    read: '{"summary":[..3 條核心結論],"claims":[{"issue","claim","paras","predict"(英文，對方在庭上可能的說法),"strength":"strong|medium|weak"}],"admissions":[{"text","paras","use"}],"gaps":[..]}',
    assess: '{"pros":[{"point","basis","use"}],"cons":[{"risk","detail","level":"高|中高|中|低","response"}],"priorities":[..],"verify":[..]}',
    script: '{"directions":[..],"fixes":[{"unit","where","current"(逐字複製我方稿件原文),"problem","suggest","replacement"(英文替換句)}],"additions":[..],"attacks":[{"claim","response","cite"}],"timing":[{"part","minutes","focus"}],"rebuttal":[..],"reminders":[..]}',
    qa: '{"qa":[{"question"(英文法官問句),"questionZh","answer"(中文重點),"avoid","structure":[..英文],"sampleEn"}]}',
  };
  return [
    { role: 'system', content: '你是國際人道法模擬法庭（ICC 規約，Prosecutor v. Roger Thorn）隊伍的教練。只依提供的書狀、事實與我方稿件分析，不得捏造事實或段落號。用繁體中文（台灣用語）寫分析，英文保留給法律名詞與要在庭上說的句子。只輸出 JSON。' },
    { role: 'user', content: `任務：${input.step}\n我方：${input.ourSide}\n場次：${input.match}\n\n對方書狀：\n${input.memorial.slice(0, 14_000)}\n\n${input.script ? `我方稿件：\n${input.script.slice(0, 12_000)}\n\n` : ''}${input.known ? `已知：${input.known}\n\n` : ''}輸出格式：${want[input.step]}` },
  ];
}

/** Claude → local model → error. Returns the step's JSON and which engine made it. */
export async function runPrepAI(d: DebateData, m: MatchPrep, step: PrepStep, signal?: AbortSignal): Promise<{ data: AiOut; engine: string; cost?: number }> {
  if (!m.memorial && step !== 'script') throw new Error('先匯入對方書狀。');
  const input = prepInput(d, m, step);
  const engine = resolveEngine();
  let lastErr = '';
  if (engine === 'claude') {
    try {
      const r = await callClaude<AiOut>('prep', input, signal);
      return { data: r.data, engine: `${r.model}${r.cached ? '（快取）' : ''}`, cost: r.usage.cost };
    } catch (e: any) { lastErr = e?.message ?? String(e); }
  }
  if (localLLMReady() && engine !== 'rules') {
    let text = '';
    for await (const c of streamChat(loadSettings(), localPrompt(input), signal ?? new AbortController().signal)) text += c;
    const j = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try { return { data: JSON.parse(j), engine: '本地模型' }; } catch { lastErr = '本地模型回覆不是有效的 JSON。'; }
  }
  throw new Error(lastErr || '目前沒有可用的 AI（請用帳號登入使用 Claude，或在「本地模型」頁設定模型）。離線比對結果仍可使用。');
}

/** Merge a step's AI output into the match without duplicating what is there. */
export function mergeAI(d: DebateData, m: MatchPrep, step: PrepStep, out: AiOut): number {
  let n = 0;
  const src: Source = 'ai';
  const add = <T>(arr: T[], x: T, same: (a: T) => boolean) => { if (!arr.some(same)) { arr.push(x); n++; } };
  if (step === 'read') {
    const o = out as AiRead;
    o.summary?.forEach((s) => add(m.reading.summary, s, (a) => a === s));
    o.claims?.forEach((c) => {
      const hit = m.reading.claims.find((a) => a.paras && a.paras === c.paras && a.issue === c.issue);
      if (hit) { if (!hit.predict) { hit.predict = c.predict; n++; } hit.strength ??= c.strength; }
      else add(m.reading.claims, { ...c, src }, () => false);
    });
    o.admissions?.forEach((a) => add(m.reading.admissions, { ...a, src }, (x) => x.text === a.text));
    o.gaps?.forEach((g) => add(m.reading.gaps, g, (a) => a === g));
  } else if (step === 'assess') {
    const o = out as AiAssess;
    o.pros?.forEach((p) => add(m.assess.pros, { ...p, src }, (a) => a.point === p.point));
    o.cons?.forEach((c) => add(m.assess.cons, { ...c, level: lv(c.level), src }, (a) => a.risk === c.risk));
    o.priorities?.forEach((p) => add(m.assess.priorities, p, (a) => a === p));
    o.verify?.forEach((v) => add(m.assess.verify, { text: v, done: false, src }, (a) => a.text === v));
  } else if (step === 'script') {
    const o = out as AiScript;
    o.directions?.forEach((x) => add(m.script.directions, x, (a) => a === x));
    o.fixes?.forEach((f) => add(m.script.fixes, { ...f, unit: f.unit || undefined, status: 'open', src }, (a) => a.current === f.current));
    o.additions?.forEach((x) => add(m.script.additions, { text: x, done: false, src }, (a) => a.text === x));
    o.attacks?.forEach((x) => add(m.script.attacks, { ...x, src }, (a) => a.claim === x.claim));
    o.timing?.forEach((x) => add(m.script.timing, { ...x, src }, (a) => a.part === x.part));
    o.rebuttal?.forEach((x) => add(m.script.rebuttal, x, (a) => a === x));
    o.reminders?.forEach((x) => add(m.script.reminders, x, (a) => a === x));
  } else {
    const o = out as AiQa;
    for (const q of o.qa ?? []) {
      // English versions of questions the team wrote in Chinese come back with questionZh = the original
      const hit = m.script.qa.find((a) => a.question === q.questionZh || a.question === q.question);
      if (hit) {
        if (!hit.en) { hit.en = q.question; n++; }
        hit.structure ??= q.structure;
        hit.sampleEn ??= q.sampleEn;
        continue;
      }
      m.script.qa.push({ question: q.question, answer: q.answer, avoid: q.avoid, en: q.question, structure: q.structure, sampleEn: q.sampleEn, src });
      n++;
    }
  }
  m.sources.push({ name: `AI ${({ read: '導讀', assess: '應對評估', script: '稿件健檢', qa: '法官題' } as const)[step]}`, kind: 'AI', at: Date.now() });
  m.updatedAt = Date.now();
  void d;
  return n;
}

/* ------------------------------------------------------------------ Q&A → bench */

/** Turn the match's anticipated bench questions into drill questions (category = the match). */
export function qaToBench(d: DebateData, m: MatchPrep): number {
  const list = questionsOf(d, m.ourSide);
  const cat = `對戰 ${matchTitle(m)}`;
  const prefix = `M${m.ourSide === 'prosecution' ? 'P' : 'D'}${(m.oppTeam.match(/\d+/)?.[0] ?? 'X')}-`;
  let n = 0;
  m.script.qa.forEach((qa) => {
    if (qa.qid && list.some((q) => q.id === qa.qid)) return;
    let k = 1;
    while (list.some((q) => q.id === `${prefix}${String(k).padStart(2, '0')}`)) k++;
    const id = `${prefix}${String(k).padStart(2, '0')}`;
    const english = /[A-Za-z]{3,}/.test(qa.question) && !/[\u4e00-\u9fff]/.test(qa.question);
    const en = qa.en || (english ? qa.question : '');
    const q: BenchQuestion = {
      id,
      title: `${id} ${(en || qa.question).slice(0, 60)}`,
      side: m.ourSide,
      category: cat,
      where: matchTitle(m),
      whereZh: `${m.round} ${matchTitle(m)}`,
      issue: qa.answer,
      questionEn: en || qa.question,
      questionZh: english ? '' : qa.question,
      structure: qa.structure?.length ? qa.structure : qa.answer.split(/[；;。]/).map((s) => s.trim()).filter(Boolean),
      sampleEn: qa.sampleEn ?? '',
      sampleZh: `${qa.answer}${qa.avoid ? `\n避免：${qa.avoid}` : ''}`,
      match: m.id,
    };
    list.push(q);
    qa.qid = id;
    n++;
  });
  return n;
}

/* ------------------------------------------------------------------ rebuttal drill */

export interface RebutGrade { score: number; hit: string[]; missed: string[]; better: string; note: string; engine: string; }

/** Grade a spoken rebuttal of one opponent claim against the team's planned response. */
export async function gradeRebuttal(m: MatchPrep, c: { claim: string; predict: string; response: string }, answer: string, sec: number, signal?: AbortSignal): Promise<RebutGrade> {
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  if (resolveEngine() === 'claude' && words >= 12) {
    try {
      const r = await callClaude<Omit<RebutGrade, 'engine'>>('rebut', { side: m.ourSide, claim: c.claim, predict: c.predict, plan: c.response, answer, sec }, signal);
      return { ...r.data, engine: r.model };
    } catch (e) { console.info('Claude rebut unavailable', e); }
  }
  // offline: overlap with the planned response's key terms
  const key = (s: string) => new Set((s.match(/[A-Za-z][A-Za-z'-]{3,}|\d+|[一-鿿]{2,}/g) ?? []).map((x) => x.toLowerCase()));
  const plan = key(`${c.response}`);
  const said = key(answer);
  const hitTerms = [...plan].filter((x) => said.has(x));
  const factRefs = (answer.match(/(?:fact|paragraph|para)s?\s*\[?\d+/gi) ?? []).length;
  const score = Math.max(0, Math.min(100, Math.round(30 + Math.min(40, hitTerms.length * 6) + Math.min(15, factRefs * 5) + (sec >= 20 && sec <= 75 ? 15 : 5) - (words < 25 ? 20 : 0))));
  return {
    score,
    hit: hitTerms.slice(0, 6),
    missed: [...plan].filter((x) => !said.has(x) && /[A-Za-z]{5,}|\d/.test(x)).slice(0, 6),
    better: '',
    note: `離線比對：與預定應對的關鍵詞重合 ${hitTerms.length} 個，引用事實段 ${factRefs} 次，${Math.round(sec)} 秒。用帳號登入可取得 Claude 講評。`,
    engine: '離線規則',
  };
}
