import { SITE_ORIGIN } from '../config';
/**
 * Which AI judges the debate practice, and the call to Claude.
 *
 *   claude  Claude through /api/debate-ai (keys and budgets managed in 後臺).
 *           Default for Google accounts when the admin has it switched on.
 *   local   the model set on the /llm page (Ollama, OpenAI-compatible,
 *           WebGPU, Chrome built-in).
 *   rules   the offline rule engine — always there as the last fallback.
 *
 * The person can override the choice; it is remembered on this device.
 */
import { db } from './db';
import type { Me } from './auth';
import { loadSettings } from '../llm/backends';

export type EnginePref = 'auto' | 'claude' | 'local' | 'rules';
export type Engine = 'claude' | 'local' | 'rules';
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

const PREF_KEY = 'debate_ai_engine_v1';
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

export function enginePref(): EnginePref {
  try {
    const v = localStorage.getItem(PREF_KEY) as EnginePref | null;
    return v && ['auto', 'claude', 'local', 'rules'].includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setEnginePref(p: EnginePref) {
  try {
    localStorage.setItem(PREF_KEY, p);
  } catch {}
}

export function localLLMReady(): boolean {
  const s = loadSettings();
  return (
    (s.backend === 'builtin' && typeof (globalThis as any).LanguageModel !== 'undefined') ||
    (Boolean(s.model) && (s.backend === 'ollama' || s.backend === 'openai' || s.backend === 'webgpu'))
  );
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
  const pref = enginePref();
  const claudeOk = !claudeBlocker();
  if (pref === 'claude' && claudeOk) return 'claude';
  if (pref === 'rules') return 'rules';
  if (pref === 'local') return localLLMReady() ? 'local' : 'rules';
  if (pref === 'auto' && claudeOk && ctx.google && ctx.config?.google_default) return 'claude';
  // explicit Claude that is unavailable, or auto for non-Google: best local option
  if (localLLMReady()) return 'local';
  if (pref === 'auto' && claudeOk) return 'claude';
  return 'rules';
}

export function engineDescription(e: Engine = resolveEngine(), task: AiTask = 'evaluate'): string {
  if (e === 'claude') return `${MODEL_LABEL[ctx.config?.models?.[task] ?? ''] ?? 'Claude'}（雲端）`;
  if (e === 'local') {
    const s = loadSettings();
    return s.backend === 'builtin' ? '瀏覽器內建模型（Prompt API）' : `${s.backend.toUpperCase()} · ${s.model}`;
  }
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
 * Throws when Claude is unavailable; callers fall back to local / rules.
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
