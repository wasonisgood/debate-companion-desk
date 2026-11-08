import type { BenchQuestion, OralUnit, FollowUpExample } from './debateData';
import type { MatchPrep, PrepMeta } from './matchPrep';
import { db } from './db';
import { sanitizeDebateData } from './debateQuestionSanitizer';

export interface DebateData {
  prosecutionQuestions: BenchQuestion[];
  defenseQuestions: BenchQuestion[];
  prosecutionOral: OralUnit[];
  defenseOral: OralUnit[];
  followUpExamples: FollowUpExample[];
  /** 對戰準備: one record per scheduled round (see src/lib/matchPrep.ts). */
  matches?: MatchPrep[];
  /** Our team number and the Statement of Agreed Facts, shared by every match. */
  prep?: PrepMeta;
}

// The bank itself lives in Supabase (site_debate_bank). All modifications are
// automatically synchronized to the cloud so that any device sees the same state.
const STORAGE_KEY = 'debate_practice_data_v1';
const BASE_KEY = 'debate_practice_base_v1';

export interface Bank { data: DebateData | null; version: number; updated_at: string | null; can_manage: boolean; }
let bank: Bank | null = null;
let bankCode = '';

const EMPTY = (): DebateData => ({ prosecutionQuestions: [], defenseQuestions: [], prosecutionOral: [], defenseOral: [], followUpExamples: [] });
const valid = (p: any): p is DebateData =>
  !!p && ['prosecutionQuestions', 'defenseQuestions', 'prosecutionOral', 'defenseOral'].every((k) => Array.isArray(p[k]));

/** Always hand out a copy: editors mutate in place, and the shared bank must stay pristine. */
function freshDefaults(): DebateData {
  const d = bank?.data;
  return d ? (structuredClone({ ...d, followUpExamples: d.followUpExamples ?? [] }) as DebateData) : EMPTY();
}

try { localStorage.removeItem('debate_practice_auth_v1'); } catch {}

/**
 * Fetch the shared bank. `code` is the debate code this device holds ('' for
 * an account). Returns null when the server says this caller may not see it.
 */
export async function fetchDebateBank(code: string): Promise<Bank | null> {
  const { data, error } = await db().rpc('site_debate_load', { p_code: code });
  if (error) throw new Error(error.message);
  if (!data) { bank = null; return null; }
  bank = data as Bank;
  if (bank.data && !valid(bank.data)) bank.data = null;
  bankCode = code;
  if (bank.data) {
    const fixed = sanitizeDebateData(bank.data);
    if (fixed) {
      void syncDebateDataNow();
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bank.data));
      localStorage.setItem(BASE_KEY, String(bank.version));
    } catch {}
  }
  return bank;
}
export const debateBank = () => bank;

export function hasLocalEdits(): boolean {
  return false;
}
/** Version of the shared bank the local edits started from (0 = unknown / older than versioning). */
export function localBase(): number {
  try { return Number(localStorage.getItem(BASE_KEY) ?? 0); } catch { return 0; }
}

export type SyncState = 'idle' | 'saving' | 'synced' | 'error';
type SyncListener = (status: SyncState, info?: string) => void;
const syncListeners = new Set<SyncListener>();

export function onSyncStatus(fn: SyncListener): () => void {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

function notifySync(status: SyncState, info?: string) {
  for (const fn of syncListeners) {
    try { fn(status, info); } catch {}
  }
}

let syncTimer: number | undefined;

/** Publish/Sync data directly to the cloud bank. */
export async function publishDebateData(data: DebateData): Promise<number> {
  const { data: r, error } = await db().rpc('site_debate_save', {
    p_code: bankCode,
    p_data: data,
    p_version: null,
  });
  if (error) throw new Error(error.message);
  const v = (r as { version: number }).version;
  bank = { data: structuredClone(data), version: v, updated_at: new Date().toISOString(), can_manage: true };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(BASE_KEY, String(v));
  } catch {}
  return v;
}

/** Immediately perform cloud sync if pending. */
export async function syncDebateDataNow(): Promise<number | null> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  if (!bank?.data) return null;
  notifySync('saving');
  try {
    const v = await publishDebateData(bank.data);
    notifySync('synced', new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    return v;
  } catch (e: any) {
    console.warn('Auto cloud sync failed:', e);
    notifySync('error', e?.message || '雲端同步失敗');
    return null;
  }
}

export function loadDebateData(): DebateData {
  let d: DebateData | null = null;
  if (bank?.data && valid(bank.data)) {
    d = freshDefaults();
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (valid(parsed)) {
          d = parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load custom debate data, fallback to defaults', err);
    }
  }
  const result = d ?? freshDefaults();
  sanitizeDebateData(result);
  return result;
}

/**
 * Save data: updates local memory & cache immediately, and automatically
 * synchronizes to the cloud with debouncing.
 */
export function saveDebateData(data: DebateData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (bank) localStorage.setItem(BASE_KEY, String(bank.version));
  } catch (err) {
    console.error('Failed to save debate data to localStorage', err);
  }
  if (bank) {
    bank.data = structuredClone(data);
  } else {
    bank = { data: structuredClone(data), version: 0, updated_at: new Date().toISOString(), can_manage: true };
  }
  notifySync('saving');
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    void syncDebateDataNow();
  }, 1000);
}

export function resetDebateData(): DebateData {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  bank = null;
  return freshDefaults();
}
