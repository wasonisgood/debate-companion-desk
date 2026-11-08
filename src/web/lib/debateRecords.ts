/**
 * Practice records in the cloud (site_debate_records) and recordings in the
 * private `debate-audio` bucket.
 *
 * What is kept:
 *   - Every attempt keeps its text: transcript, scores, feedback, hints, the
 *     full hearing report. Text is small and is what the records page shows.
 *   - Audio is kept only where listening back is worth the space (AUDIO_RULES):
 *     a full hearing of 5 minutes or more, a 口說教練 pass at an off-script
 *     stage, a 單題攻防 answer scoring 85+ or setting a personal best. Anything
 *     else can still be saved by hand from its result screen.
 *   - Recordings are stored for accounts only (they live in the account's own
 *     folder). Code users keep text records, tied to their code.
 *
 * A record that cannot reach the server waits in a queue on this device and
 * is sent the next time the module opens.
 */
import { db } from './db';
import type { Me } from './auth';
import { loadMastery, saveMastery, type Mastery } from './mootCourt';

export type RecordKind = 'coach' | 'bench' | 'hearing';

export interface RecordInput {
  kind: RecordKind;
  side: 'prosecution' | 'defense';
  target_id: string;
  title: string;
  stage?: string;
  score?: number;
  accuracy?: number;
  passed?: boolean;
  duration_sec: number;
  engine: string;
  transcript: string;
  detail: Record<string, unknown>;
}

export interface DebateRecord extends RecordInput {
  id: string;
  user_id: string | null;
  code_id: string | null;
  audio_path: string | null;
  audio_bytes: number | null;
  audio_reason: string;
  created_at: string;
}

export const AUDIO_RULES: { kind: RecordKind; label: string; rule: string }[] = [
  { kind: 'hearing', label: '40 分鐘模擬庭', rule: '開庭 5 分鐘以上的庭期，整場錄音保存。' },
  { kind: 'coach', label: '口說教練', rule: '在「脫稿／抗打斷／串背」通過門檻時保存該段錄音；跟讀、提詞與未通過的只留文字。' },
  { kind: 'bench', label: '單題攻防', rule: '得分 85 以上，或刷新該題個人最佳（且 70 分以上）時保存；其餘只留文字。' },
];

/** Why this attempt's audio is worth keeping ('' = text only). */
export function audioReason(kind: RecordKind, x: { score?: number; passed?: boolean; stage?: string; elapsed?: number; prevBest?: number }): string {
  if (kind === 'hearing') return (x.elapsed ?? 0) >= 300 ? '完整模擬庭（5 分鐘以上）' : '';
  if (kind === 'coach')
    return x.passed && ['blind', 'interrupt', 'chain'].includes(x.stage ?? '') ? `通過${{ blind: '脫稿', interrupt: '抗打斷', chain: '串背' }[x.stage as 'blind']}門檻` : '';
  const s = x.score ?? 0;
  if (s >= 85) return '高分作答（85 分以上）';
  if (s >= 70 && s > (x.prevBest ?? -1) && x.prevBest !== undefined) return '刷新個人最佳';
  return '';
}

/* ------------------------------------------------------------------ who */

const id = {
  uid: '',
  code: '',
  manager: false,
};

export function initRecords(account: Me | null, code: string, manager: boolean) {
  id.uid = account?.user_id ?? '';
  id.code = account ? '' : code;
  id.manager = manager;
  void flushQueue();
  if (id.uid) {
    void importLegacy();
    void pullProgress();
  }
}
export const recordIdentity = () => ({ ...id });
export const canKeepAudio = () => !!id.uid;

/* ------------------------------------------------------------------ save */

const QUEUE_KEY = 'debate_records_queue_v1';
type Queued = RecordInput & { client_id: string; created_at: string };

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-60)));
  } catch {}
}

async function send(rec: Queued): Promise<string> {
  const { data, error } = await db().rpc('site_debate_record_save', { p_code: id.code, p_rec: rec });
  if (error) throw new Error(error.message);
  return data as string;
}

let flushing = false;
async function flushQueue() {
  if (flushing || (!id.uid && !id.code)) return;
  flushing = true;
  try {
    let q = readQueue();
    for (const r of [...q]) {
      try {
        await send(r);
        q = q.filter((x) => x.client_id !== r.client_id);
        writeQueue(q);
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export interface SaveResult {
  id: string | null;
  queued: boolean;
  audio: 'saved' | 'none' | 'skipped' | 'failed' | 'no-account';
  reason: string;
  error?: string;
}

const clientId = () => `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;

/**
 * Save one attempt. `audio` is uploaded only when `keepReason` is non-empty
 * (see audioReason) or the person asked to keep it.
 */
export async function saveRecord(rec: RecordInput, audio?: Blob | null, keepReason = ''): Promise<SaveResult> {
  if (!id.uid && !id.code) return { id: null, queued: false, audio: 'none', reason: '' };
  const q: Queued = {
    ...rec,
    transcript: rec.transcript.slice(0, 60000),
    duration_sec: Math.max(0, Math.round(rec.duration_sec)),
    client_id: clientId(),
    created_at: new Date().toISOString(),
  };
  let recordId: string | null = null;
  try {
    recordId = await send(q);
  } catch (e: any) {
    writeQueue([...readQueue(), q]);
    return { id: null, queued: true, audio: audio ? 'failed' : 'none', reason: keepReason, error: e?.message };
  }
  if (!audio || !audio.size) return { id: recordId, queued: false, audio: 'none', reason: '' };
  if (!keepReason) return { id: recordId, queued: false, audio: 'skipped', reason: '' };
  if (!id.uid) return { id: recordId, queued: false, audio: 'no-account', reason: keepReason };
  try {
    await uploadAudio(recordId, audio, keepReason);
    return { id: recordId, queued: false, audio: 'saved', reason: keepReason };
  } catch (e: any) {
    return { id: recordId, queued: false, audio: 'failed', reason: keepReason, error: e?.message };
  }
}

/** Upload (or add later, by hand) the recording of a saved record. */
export async function uploadAudio(recordId: string, audio: Blob, reason: string): Promise<string> {
  if (!id.uid) throw new Error('以帳號登入才能保存錄音。');
  const base = (audio.type || 'audio/webm').split(';')[0];
  const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm';
  const d = new Date();
  const path = `${id.uid}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${recordId}.${ext}`;
  const { error } = await db().storage.from('debate-audio').upload(path, audio, { contentType: base, upsert: true });
  if (error) throw new Error(error.message);
  const { error: e2 } = await db().rpc('site_debate_record_audio', { p_id: recordId, p_path: path, p_bytes: audio.size, p_reason: reason });
  if (e2) throw new Error(e2.message);
  return path;
}

export async function audioUrl(path: string): Promise<string> {
  const { data, error } = await db().storage.from('debate-audio').createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------------------------------------------ read */

export async function listRecords(opts: { kind?: RecordKind | ''; userId?: string; limit?: number } = {}): Promise<DebateRecord[]> {
  const limit = opts.limit ?? 200;
  if (!id.uid) {
    if (!id.code) return [];
    const { data, error } = await db().rpc('site_debate_records_by_code', { p_code: id.code, p_limit: limit });
    if (error) throw new Error(error.message);
    return ((data ?? []) as DebateRecord[]).filter((r) => !opts.kind || r.kind === opts.kind);
  }
  let q = db().from('site_debate_records').select('*').order('created_at', { ascending: false }).limit(limit);
  if (opts.kind) q = q.eq('kind', opts.kind);
  if (opts.userId === '*') {
    /* managers: everyone */
  } else q = q.eq('user_id', opts.userId || id.uid);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DebateRecord[];
}

export async function deleteRecord(r: DebateRecord) {
  if (r.audio_path) await db().storage.from('debate-audio').remove([r.audio_path]);
  const { error } = await db().from('site_debate_records').delete().eq('id', r.id);
  if (error) throw new Error(error.message);
}

export const pendingCount = () => readQueue().length;

/* ------------------------------------------------------------------ progress */

const SCORE_KEY = 'debate_bench_scores_v1';

export function loadBenchScores(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveBenchScores(s: Record<string, number>) {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(s));
  } catch {}
  pushProgressSoon();
}

function mergeMastery(a: Record<string, Mastery>, b: Record<string, Mastery>): Record<string, Mastery> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    const o = out[k];
    out[k] = o
      ? { level: Math.max(o.level, v.level), best: Math.max(o.best, v.best), attempts: Math.max(o.attempts, v.attempts), last: Math.max(o.last, v.last) }
      : v;
  }
  return out;
}

async function pullProgress() {
  if (!id.uid) return;
  const { data } = await db().from('site_debate_progress').select('mastery,bench_scores').eq('user_id', id.uid).maybeSingle();
  const mastery = mergeMastery(loadMastery(), (data?.mastery ?? {}) as Record<string, Mastery>);
  saveMastery(mastery);
  const scores = { ...loadBenchScores() };
  for (const [k, v] of Object.entries((data?.bench_scores ?? {}) as Record<string, number>)) scores[k] = Math.max(scores[k] ?? 0, v);
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
  } catch {}
  await pushProgress();
}

async function pushProgress() {
  if (!id.uid) return;
  await db()
    .from('site_debate_progress')
    .upsert({ user_id: id.uid, mastery: loadMastery(), bench_scores: loadBenchScores(), updated_at: new Date().toISOString() });
}

let pushTimer: number | undefined;
/** Debounced: mastery changes after every attempt. */
export function pushProgressSoon() {
  if (!id.uid) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void pushProgress().catch(() => {}), 4000);
}

/* ------------------------------------------------------------------ legacy */

/** Hearings and practice logs that used to live only in this browser go to the account once. */
async function importLegacy() {
  const flag = `debate_legacy_imported_v1:${id.uid}`;
  try {
    if (localStorage.getItem(flag)) return;
  } catch {
    return;
  }
  try {
    const hearings: any[] = JSON.parse(localStorage.getItem('debate_hearings_v1') || '[]');
    for (const h of hearings) {
      const scored = (h.qa ?? []).filter((x: any) => typeof x.score === 'number');
      await send({
        kind: 'hearing', side: h.side, target_id: h.id, title: `模擬庭（本機匯入）`, stage: h.mode,
        score: scored.length ? Math.round(scored.reduce((a: number, x: any) => a + x.score, 0) / scored.length) : undefined,
        duration_sec: h.elapsed ?? 0, engine: h.engine ?? '',
        transcript: (h.phases ?? []).map((p: any) => `【${p.label}】${p.transcript}`).join('\n\n'),
        detail: { report: h }, client_id: `legacy-hearing-${h.id}`, created_at: new Date(h.ts).toISOString(),
      });
    }
    const recs: any[] = JSON.parse(localStorage.getItem('debate_practice_records') || '[]');
    for (const r of recs) {
      if (/^模擬庭/.test(r.targetTitle ?? '')) continue; // already imported as a hearing
      await send({
        kind: r.type === 'recite' ? 'coach' : 'bench', side: r.side, target_id: r.targetId, title: r.targetTitle,
        score: r.score, accuracy: r.accuracy, duration_sec: 0, engine: '', transcript: '',
        detail: { notes: r.notes, legacy: true }, client_id: `legacy-rec-${r.id}`, created_at: new Date(r.timestamp).toISOString(),
      });
    }
    localStorage.setItem(flag, String(Date.now()));
  } catch (e) {
    console.info('legacy import postponed', e);
  }
}
