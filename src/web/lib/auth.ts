/**
 * One login system for every gated module.
 *
 *   帳號：Supabase Auth (email + password, or Google). A new account is
 *         'pending' until an admin approves it and grants modules in
 *         後臺 → 帳號與代碼. Approval, suspension and grants live in the
 *         database (supabase/migrations/20261105000000_site_access.sql).
 *   代碼：issued and revoked in the same back-office tab. A code opens one
 *         module on this device without an account, or a signed-in account
 *         can redeem it to keep that module.
 */
import { db } from './db';

export type Module = 'desk' | 'debate' | 'shelf';
export type Role = 'member' | 'manager';
export type Status = 'pending' | 'active' | 'suspended' | 'banned';

export const MODULES: Record<Module, string> = { desk: '後臺', debate: '辯論比賽練習模組', shelf: '想弟書櫥' };
export const MODULE_KEYS = Object.keys(MODULES) as Module[];
export const STATUS: Record<Status, string> = { pending: '待審核', active: '已開通', suspended: '停權中', banned: '已封鎖' };

export interface Grant { module: Module; role: Role; shelf_group_id?: string | null; expires_at?: string | null; }
export interface Me {
  user_id: string;
  email: string;
  display_name: string;
  status: Status;
  suspended_until: string | null;
  requested: Module[];
  request_note: string;
  owner: boolean;
  grants: Grant[];
}

// ---------- account ----------
let cached: { at: number; me: Promise<Me | null> } | null = null;
let watching = false;

/** The signed-in account with its approval state and module grants (null when signed out). */
export function me(force = false): Promise<Me | null> {
  if (!watching) {
    watching = true;
    db().auth.onAuthStateChange((ev) => { if (ev !== 'TOKEN_REFRESHED') cached = null; });
  }
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.me;
  const p = (async () => {
    const { data: { session } } = await db().auth.getSession();
    if (!session) return null;
    const { data, error } = await db().rpc('site_me');
    if (error) throw error;
    return (data as Me) ?? null;
  })();
  cached = { at: Date.now(), me: p };
  p.catch(() => { cached = null; });
  return p;
}

/** Desk admins (and owners) may use every module. */
export function grantFor(m: Me | null, mod: Module): Grant | null {
  if (!m || m.status !== 'active') return null;
  const now = Date.now();
  const live = m.grants.filter((g) => !g.expires_at || new Date(g.expires_at).getTime() > now);
  return live.find((g) => g.module === mod) ?? (live.find((g) => g.module === 'desk') ? { module: mod, role: 'manager' } : null);
}
export const hasModule = (m: Me | null, mod: Module) => !!grantFor(m, mod);

const redirectHere = () => `${location.origin}${location.pathname}${location.search}`;

export async function signInPassword(email: string, password: string) {
  const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  cached = null;
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email 或密碼不對。' : error.message === 'Email not confirmed' ? '這個 Email 還沒有確認，請先點確認信裡的連結。' : error.message);
}

/** Returns true when the account is signed in right away, false when a confirmation email was sent. */
export async function signUp(email: string, password: string, name: string): Promise<boolean> {
  const { data, error } = await db().auth.signUp({
    email: email.trim(), password,
    options: { data: { full_name: name.trim() }, emailRedirectTo: redirectHere() },
  });
  cached = null;
  if (error) throw new Error(/registered/i.test(error.message) ? '這個 Email 已經註冊過，請直接登入。' : error.message);
  return !!data.session;
}

export async function signInGoogle() {
  const { error } = await db().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectHere(), queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error(/provider is not enabled/i.test(error.message) ? 'Google 登入尚未在 Supabase 啟用。' : error.message);
}

export async function resetPassword(email: string) {
  const { error } = await db().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/desk/settings` });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  cached = null;
  await db().auth.signOut();
}

// ---------- sign-in methods on one account ----------
export interface Identity { identity_id: string; provider: string; email: string; created_at: string | null; last_sign_in_at: string | null; }

/** How this account can sign in: 'email' (password) and/or 'google'. */
export async function identities(): Promise<Identity[]> {
  const { data, error } = await db().auth.getUserIdentities();
  if (error) throw new Error(error.message);
  return (data?.identities ?? []).map((i: any) => ({
    identity_id: i.identity_id, provider: i.provider,
    email: String(i.identity_data?.email ?? ''), created_at: i.created_at ?? null, last_sign_in_at: i.last_sign_in_at ?? null,
  }));
}

/** True when the account can sign in with email + password. */
export async function hasPassword(ids: Identity[]): Promise<boolean> {
  if (ids.some((i) => i.provider === 'email')) return true;
  const { data } = await db().auth.getSession();
  return !!data.session?.user.user_metadata?.has_password;
}

/** Add Google to the signed-in account (leaves the site, comes back here). */
export async function linkGoogle() {
  const { error } = await db().auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: `${location.origin}/account`, queryParams: { prompt: 'select_account' } },
  });
  if (error) {
    throw new Error(/manual linking/i.test(error.message)
      ? '尚未開啟帳號綁定：請站長到 Supabase → Authentication → Sign In / Providers 打開「Allow manual linking」。'
      : /provider is not enabled/i.test(error.message) ? 'Google 登入尚未在 Supabase 啟用。' : error.message);
  }
}

export async function unlinkIdentity(identity_id: string) {
  const { data } = await db().auth.getUserIdentities();
  const it = data?.identities.find((i) => i.identity_id === identity_id);
  if (!it) throw new Error('找不到這個登入方式。');
  const { error } = await db().auth.unlinkIdentity(it);
  cached = null;
  if (error) throw new Error(/single identity|at least/i.test(error.message) ? '至少要保留一種登入方式。' : error.message);
}

/**
 * Set or change the password. Some projects ask to confirm with a code sent by
 * email first: then this returns 'code-sent', and the caller asks for the code
 * and calls again with it.
 */
export async function setPassword(password: string, code = ''): Promise<'ok' | 'code-sent'> {
  const { error } = await db().auth.updateUser(code ? { password, nonce: code.trim() } : { password });
  if (!error) {
    // A Google account that sets a password gets no separate "email" identity,
    // so remember it on the account itself for the settings page.
    await db().auth.updateUser({ data: { has_password: true } }).catch(() => {});
    return 'ok';
  }
  if ((error as any).code === 'reauthentication_needed' || /reauthenticat/i.test(error.message)) {
    const r = await db().auth.reauthenticate();
    if (r.error) throw new Error(r.error.message);
    return 'code-sent';
  }
  if ((error as any).code === 'same_password' || /different from the old/i.test(error.message)) throw new Error('新密碼不能和舊密碼一樣。');
  if ((error as any).code === 'weak_password' || /at least/i.test(error.message)) throw new Error('密碼太短或太簡單，請至少 8 個字。');
  throw new Error(error.message);
}

export async function requestAccess(modules: Module[], note: string, name: string) {
  const { error } = await db().rpc('site_request_access', { p_modules: modules, p_note: note, p_name: name });
  cached = null;
  if (error) throw new Error(error.message);
}

// ---------- codes ----------
export const normCode = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const codeKey = (m: Module) => `${m}-code`;
const okKey = (m: Module) => `${m}-code-ok`;

export function savedCode(m: Module): string { try { return localStorage.getItem(codeKey(m)) ?? ''; } catch { return ''; } }
export function saveCode(m: Module, c: string) {
  try {
    if (c) { localStorage.setItem(codeKey(m), c); localStorage.setItem(okKey(m), String(Date.now())); }
    else { localStorage.removeItem(codeKey(m)); localStorage.removeItem(okKey(m)); }
  } catch {}
}

/** Sign in to a module with a code (no account). Returns null for a wrong / revoked / used-up code. */
export async function codeLogin(m: Module, code: string): Promise<{ role: Role; label: string } | null> {
  const { data, error } = await db().rpc('site_code_login', { p_code: normCode(code), p_module: m });
  if (error) throw new Error(error.message);
  return data as { role: Role; label: string } | null;
}

/**
 * Is the code this device holds still valid? Revoking a code takes effect the
 * next time a page opens. Offline, a code checked within three days still works.
 */
export async function codeStillValid(m: Module): Promise<boolean> {
  const c = savedCode(m);
  if (!c) return false;
  try {
    const { data, error } = await db().rpc('site_code_check', { p_code: c, p_module: m });
    if (error) throw error;
    if (data) { try { localStorage.setItem(okKey(m), String(Date.now())); } catch {} return true; }
    saveCode(m, '');
    return false;
  } catch {
    let at = 0;
    try { at = Number(localStorage.getItem(okKey(m)) ?? 0); } catch {}
    return Date.now() - at < 3 * 86400_000;
  }
}

/** A signed-in account turns a code into a lasting grant. */
export async function redeem(code: string): Promise<{ module: Module; role: Role; label: string } | null> {
  const { data, error } = await db().rpc('site_code_redeem', { p_code: normCode(code) });
  cached = null;
  if (error) throw new Error(error.message);
  return data as { module: Module; role: Role; label: string } | null;
}

/** Codes: four-and-four, no letters that read like digits. */
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function makeCode(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint8Array(8));
  const s = [...r].map((n) => ALPHA[n % ALPHA.length]).join('');
  return `${prefix ? prefix + '-' : ''}${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Where a code is typed in; share links carry ?code=. */
export const codeLink = (m: Module, code: string) =>
  m === 'desk' ? `${location.origin}/desk?code=${encodeURIComponent(code)}` : `${location.origin}/${m}?code=${encodeURIComponent(code)}`;

// A code that arrived in a link must survive a Google sign-in (which leaves
// the site and comes back) or an email-confirmation round trip. It is kept
// on this device for an hour, and dropped once it has been used.
const pendingKey = (m: Module) => `pending-code:${m}`;
const PENDING_TTL = 3600_000;
export function stashCode(m: Module, code: string) {
  try {
    if (code) localStorage.setItem(pendingKey(m), JSON.stringify({ code: normCode(code), at: Date.now() }));
    else localStorage.removeItem(pendingKey(m));
  } catch {}
}
/** Read once: the stash is cleared as it is read. */
function popStashedCode(m: Module): string {
  try {
    const raw = localStorage.getItem(pendingKey(m));
    if (!raw) return '';
    localStorage.removeItem(pendingKey(m));
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    return Date.now() - at > PENDING_TTL ? '' : code ?? '';
  } catch { return ''; }
}

/**
 * The code a link brought: ?code= on the address bar (taken off it), or one
 * the login screen kept before leaving for Google / an email confirmation.
 */
export function takeCodeParam(url: URL, m: Module): string {
  const c = url.searchParams.get('code');
  if (!c) return popStashedCode(m);
  const u = new URL(location.href); u.searchParams.delete('code');
  history.replaceState(history.state, '', u);
  return normCode(c);
}
