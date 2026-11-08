import { SITE_ORIGIN } from '../config';
/**
 * Which AI judges the debate practice.
 *
 *   claude  Claude through /api/debate-ai (keys and budgets managed on the server).
 *   rules   the offline rule engine, used whenever Claude is not available.
 *
 * There is no engine picker: Claude when the server allows it, rules otherwise.
 */
import { db } from './db';
import type { Me } from './auth';

export type Engine = 'claude' | 'rules';
export type AiTask = 'followup' | 'evaluate' | 'hearing' | 'prep' | 'rebut' | 'gen';

export interface AiConfig {
  enabled: boolean;
  google_default: boolean;
  has_keys: boolean;
  models: Record<string, string>;
  user_monthly_usd: number;
  user_daily_calls: number;
}

export const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
};

const CACHE_KEY = 'debate_ai_cache_v1';
const CACHE_MAX = 120;

const ctx = {
  account: false,
  google: false,
  config: null as AiConfig | null,
  /** set when the server refuses (budget, suspended…): stop asking for this page view */
  blocked: '',
  spent: 0,
  calls: 0,
};

export async function initDebateAI(account: Me | null): Promise<void> {
  ctx.account = !!account;
  ctx.blocked = '';
  ctx.google = false;
  if (account) {
    try {
      const { data } = await db().auth.getSession();
      const meta = data.session?.user.app_metadata ?? {};
      const providers: string[] = meta.providers ?? (meta.provider ? [meta.provider] : []);
      ctx.google = providers.includes('google');
    } catch {}
  }
  try {
    const { data } = await db().rpc('site_ai_config_get');
    ctx.config = (data as AiConfig) ?? null;
  } catch {
    ctx.config = null;
  }
}

/** Could this person use Claude at all right now? '' = yes, otherwise why not. */
export function claudeBlocker(): string {
  if (!ctx.account) return '用通行碼進來時無法使用 Claude，請改用帳號登入。';
  if (!ctx.config) return '讀不到 AI 設定。';
  if (!ctx.config.enabled) return '管理者已暫停 Claude 雲端 AI。';
  if (!ctx.config.has_keys) return '管理者尚未設定 API key。';
  return ctx.blocked;
}

export function resolveEngine(): Engine {
  return claudeBlocker() ? 'rules' : 'claude';
}

export function engineDescription(e: Engine = resolveEngine(), task: AiTask = 'evaluate'): string {
  if (e === 'claude') return `${MODEL_LABEL[ctx.config?.models?.[task] ?? ''] ?? 'Claude'}（雲端）`;
  return '離線規則引擎';
}

export const aiContext = () => ({ ...ctx });

/* ------------------------------------------------------------------ call */

export interface ClaudeResult<T> {
  data: T;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
  cached?: boolean;
}

async function digest(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readCache(): Record<string, { at: number; v: ClaudeResult<unknown> }> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeCache(c: Record<string, { at: number; v: ClaudeResult<unknown> }>) {
  const entries = Object.entries(c).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

/**
 * Ask Claude. Grading results are cached on this device by exact input, so
 * re-opening a report or re-scoring the same transcript costs nothing.
 * Throws when Claude is unavailable; callers fall back to the rules engine.
 */
export async function callClaude<T>(task: AiTask, input: unknown, signal?: AbortSignal): Promise<ClaudeResult<T>> {
  const why = claudeBlocker();
  if (why) throw new Error(why);
  const cacheable = task !== 'followup';
  const key = cacheable ? `${task}:${ctx.config?.models?.[task] ?? ''}:${await digest(JSON.stringify(input))}` : '';
  if (cacheable) {
    const hit = readCache()[key];
    if (hit) return { ...(hit.v as ClaudeResult<T>), cached: true };
  }
  const { data: s } = await db().auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error('登入已過期，請重新登入。');
  const res = await fetch(`${SITE_ORIGIN}/api/debate-ai`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, input }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  if (body?.usage?.cost) {
    ctx.spent += body.usage.cost;
    ctx.calls++;
  }
  if (!res.ok || !body?.ok) {
    const reason = body?.reason ?? `Claude 服務暫時無法使用（${res.status}）`;
    if (res.status === 403 || res.status === 503) ctx.blocked = reason;
    throw new Error(reason);
  }
  const out: ClaudeResult<T> = { data: body.data as T, model: body.model, usage: body.usage };
  if (cacheable) {
    const c = readCache();
    c[key] = { at: Date.now(), v: out };
    writeCache(c);
  }
  return out;
}

/** Admin: does this stored key work? (one tiny Haiku call) */
export async function pingKey(keyId: string): Promise<string> {
  const { data: s } = await db().auth.getSession();
  const res = await fetch(`${SITE_ORIGIN}/api/debate-ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.session?.access_token ?? ''}` },
    body: JSON.stringify({ task: 'ping', key_id: keyId, input: {} }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.reason ?? `HTTP ${res.status}`);
  return `可用 · ${body.model} · ${body.usage.input + body.usage.cacheRead + body.usage.cacheWrite} / ${body.usage.output} tokens`;
}

export const usd = (n: number) =>
  n >= 1 ? `US$${n.toFixed(2)}` : n >= 0.01 ? `US$${n.toFixed(3)}` : n > 0 ? `US$${n.toFixed(4)}` : 'US$0';
