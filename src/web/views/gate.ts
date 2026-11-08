/**
 * The one login screen every gated module uses.
 *
 * Signed out: 通行碼 (if the module takes codes) · 登入 (Google or email) · 註冊.
 * Signed in but not (yet) allowed: shows the account's state, lets the person
 * say what they need, redeem a code, or sign out.
 */
import { html, raw, $, $$ } from '../lib/dom';
import {
  me, hasModule, signInPassword, signUp, signInGoogle, resetPassword, signOut, requestAccess, redeem,
  stashCode, MODULES, MODULE_KEYS, STATUS, type Module, type Me,
} from '../lib/auth';
import '../styles/scoped/auth.css';

export interface GateOpts {
  module: Module;
  kicker: string;
  title: string;
  intro: string;
  /** Show the 通行碼 tab. */
  codes: boolean;
  codeLabel?: string;
  codePlaceholder?: string;
  /** Extra fields inside the code form (already-escaped HTML). */
  codeExtra?: string;
  /** Pre-filled code (from a share link). */
  code?: string;
  /** Try the code. Return an error message, or null when it opened. */
  onCode?: (code: string, form: HTMLFormElement) => Promise<string | null>;
  /** Called once the person may use the module. */
  done: () => void;
  /** Let any signed-in account through, whatever its status (the account page). */
  anyAccount?: boolean;
  /** A message to show on arrival (e.g. "this code was revoked"). */
  notice?: string;
  /** Force showing gate UI to prevent infinite loop when backend data is missing */
  forceShow?: boolean;
}

type Pane = 'code' | 'login' | 'signup';

export async function gate(root: HTMLElement, o: GateOpts) {
  let account: Me | null = null;
  try { account = await me(true); } catch {}
  if (!o.forceShow && account && (o.anyAccount || hasModule(account, o.module))) {
    root.replaceChildren();
    o.done();
    return;
  }
  if (account) return pending(root, o, account);
  signedOut(root, o);
}

function head(o: GateOpts) {
  return html`<header class="page-head"><span class="kicker">${o.kicker}</span><h1>${o.title}</h1><p>${o.intro}</p></header>`;
}

function signedOut(root: HTMLElement, o: GateOpts) {
  let pane: Pane = o.code && o.codes ? 'code' : 'login';
  root.innerHTML = html`
    <section class="gate">
      ${raw(head(o))}
      <nav class="gate-tabs" role="tablist">
        <button type="button" role="tab" data-pane="login">帳號登入</button>
        <button type="button" role="tab" data-pane="signup">註冊帳號</button>
        ${o.codes ? raw('<button type="button" role="tab" data-pane="code">通行碼</button>') : ''}
      </nav>

      <form class="gate-pane" data-pane="login">
        <button type="button" class="btn gate-google" data-google>${raw(GOOGLE)} 用 Google 帳號登入</button>
        <p class="gate-or mono dim"><span>或用 Email</span></p>
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="username"></label>
        <label class="field"><span>密碼</span><input type="password" name="password" required autocomplete="current-password"></label>
        <div class="gate-act"><button class="btn primary">登入</button><a href="#" data-forgot class="mono dim">忘記密碼</a></div>
      </form>

      <form class="gate-pane" data-pane="signup">
        <button type="button" class="btn gate-google" data-google>${raw(GOOGLE)} 用 Google 帳號註冊</button>
        <p class="gate-or mono dim"><span>或用 Email</span></p>
        <label class="field"><span>稱呼</span><input type="text" name="name" maxlength="80" required autocomplete="name"></label>
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="username"></label>
        <label class="field"><span>密碼（至少 8 字）</span><input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
        <p class="gate-foot mono dim">註冊後需要管理者審核開通，開通前無法使用任何模組。</p>
        <div class="gate-act"><button class="btn primary">註冊</button></div>
      </form>

      ${o.codes ? raw(html`
      <form class="gate-pane" data-pane="code" autocomplete="off">
        <label class="field"><span>${o.codeLabel ?? '通行碼'}</span>
          <input type="text" name="code" required class="gate-code" placeholder="${o.codePlaceholder ?? 'XXXX-XXXX'}" spellcheck="false" autocapitalize="characters" value="${o.code ?? ''}">
        </label>
        ${raw(o.codeExtra ?? '')}
        <div class="gate-act"><button class="btn primary">進入</button></div>
        <p class="gate-foot mono dim">通行碼由管理者簽發，可隨時撤銷。有帳號的話，也可以改用帳號登入。</p>
      </form>`) : ''}

      <p class="gate-msg mono" role="status" data-msg>${o.notice ?? ''}</p>
    </section>`;

  const msg = $('[data-msg]', root);
  const say = (s: string) => { msg.textContent = s; };
  const show = (p: Pane) => {
    pane = p;
    for (const b of $$<HTMLButtonElement>('.gate-tabs [data-pane]', root)) b.setAttribute('aria-selected', String(b.dataset.pane === p));
    for (const f of $$<HTMLFormElement>('form.gate-pane', root)) f.hidden = f.dataset.pane !== p;
    $<HTMLInputElement>(`form[data-pane="${p}"] input:not([type=hidden])`, root)?.focus();
  };
  show(pane);
  $('.gate-tabs', root).addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-pane]');
    if (b) { say(''); show(b.dataset.pane as Pane); }
  });
  // Leaving the site (Google, or an email-confirmation link): keep the code
  // from the link or the code box, so it is still filled in on the way back.
  const keepCode = () => {
    const typed = $<HTMLInputElement>('form[data-pane="code"] input[name=code]', root)?.value.trim() ?? '';
    const c = typed || o.code || '';
    if (c) stashCode(o.module, c);
  };
  for (const b of $$('[data-google]', root)) b.addEventListener('click', async () => {
    say('前往 Google…');
    keepCode();
    try {
      await signInGoogle();
    } catch (e: any) {
      stashCode(o.module, '');
      say(e.message || '前往 Google 失敗');
    }
  });

  $<HTMLFormElement>('form[data-pane="code"]', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const code = String(new FormData(form).get('code') ?? '').trim();
    if (!code || !o.onCode) return;
    say('確認中…');
    try {
      const err = await o.onCode(code, form);
      if (err) { say(err); return; }
      root.replaceChildren();
      o.done();
    } catch (e: any) { say(e.message ?? String(e)); }
  });

  $<HTMLFormElement>('form[data-pane="login"]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    say('登入中…');
    try {
      await signInPassword(String(fd.get('email')), String(fd.get('password')));
      await gate(root, o);
    } catch (e: any) { say(e.message); }
  });
  $('[data-forgot]', root).addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('form[data-pane="login"] input[name=email]', root).value;
    if (!email) { say('先填 Email。'); return; }
    try { await resetPassword(email); say('重設信已寄出。點信裡的連結會回到後臺「網站設定」，在那裡設新密碼。'); } catch (e: any) { say(e.message); }
  });

  $<HTMLFormElement>('form[data-pane="signup"]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    say('註冊中…');
    try {
      const inNow = await signUp(String(fd.get('email')), String(fd.get('password')), String(fd.get('name')));
      if (inNow) {
        if (!o.anyAccount) await requestAccess([o.module], '', String(fd.get('name'))).catch(() => {});
        await gate(root, o);
      } else {
        keepCode();
        say('確認信已寄出。點信裡的連結確認 Email 後，回到這一頁登入，等待管理者開通。');
      }
    } catch (e: any) { say(e.message); }
  });
}

/** Signed in, but not allowed into this module (yet). */
function pending(root: HTMLElement, o: GateOpts, m: Me) {
  const until = m.suspended_until ? new Date(m.suspended_until).toLocaleString('zh-Hant-TW') : '';
  const state =
    m.owner
      ? `您已登入站長帳號（超級管理員）。若要載入本模組的書籍資料，請輸入您的管理者通行碼或群組代碼即可立即進入。`
      : m.status === 'pending'
      ? m.requested.length
        ? '你的申請已送出，等待管理者審核開通。'
        : '帳號已建立，等待管理者審核開通。可以先寫下你需要哪些模組。'
      : m.status === 'suspended'
      ? `這個帳號停權中${until ? `，到 ${until} 為止` : ''}。`
      : m.status === 'banned'
      ? '這個帳號已被封鎖。如有疑問請聯絡站長。'
      : `這個帳號已開通，但尚未取得「${MODULES[o.module]}」的閱讀群組通行碼。`;
  const canAsk = !m.owner && (m.status === 'pending' || m.status === 'active');
  const want = new Set<Module>(m.requested.length ? m.requested : [o.module]);
  const badgeStatus = m.owner ? 'owner' : m.status;
  const badgeLabel = m.owner ? '超級管理員 · 站長' : STATUS[m.status];

  root.innerHTML = html`
    <section class="gate">
      ${raw(head(o))}
      <div class="gate-me">
        <p class="mono"><b>${m.display_name || m.email}</b> · ${m.email} · <span class="gate-badge" data-s="${badgeStatus}">${badgeLabel}</span></p>
        <p>${state}</p>
      </div>
      ${canAsk ? raw(html`
      <form class="gate-pane" data-f="ask">
        <h2 class="desk-h2">${m.status === 'pending' ? '申請開通' : '申請更多權限'}</h2>
        <label class="field"><span>稱呼</span><input type="text" name="name" maxlength="80" value="${m.display_name}"></label>
        <div class="field"><span>需要的模組</span>
          <div class="gate-mods">${MODULE_KEYS.filter((k) => k !== 'desk' || m.status === 'active').map((k) => raw(html`<label><input type="checkbox" name="mod" value="${k}" ${want.has(k) ? raw('checked') : ''}> ${MODULES[k]}</label>`))}</div>
        </div>
        <label class="field"><span>說明（你是誰、為什麼需要）</span><textarea name="note" rows="2" maxlength="500">${m.request_note}</textarea></label>
        <div class="gate-act"><button class="btn">送出申請</button><span class="mono dim" data-amsg></span></div>
      </form>`) : ''}
      ${m.status !== 'banned' ? raw(html`
      <form class="gate-pane" data-f="redeem" autocomplete="off">
        <h2 class="desk-h2">有代碼？</h2>
        <p class="gate-foot mono dim">管理者發給你的代碼可以直接綁定到這個帳號，綁定後立即開通對應模組。</p>
        <label class="field"><span>代碼</span><input type="text" name="code" required class="gate-code" placeholder="XXXX-XXXX" spellcheck="false" autocapitalize="characters" value="${o.code ?? ''}"></label>
        <div class="gate-act"><button class="btn primary">綁定代碼</button></div>
      </form>`) : ''}
      <p class="gate-act"><button type="button" class="btn ghost" data-recheck>重新檢查</button><a class="btn ghost" href="/account">帳號設定</a><button type="button" class="btn ghost" data-out>登出</button>${o.codes ? raw('<button type="button" class="btn ghost" data-codeonly>改用通行碼進入</button>') : ''}</p>
      <p class="gate-msg mono" role="status" data-msg>${o.notice ?? ''}</p>
    </section>`;

  const msg = $('[data-msg]', root);
  $<HTMLFormElement>('[data-f="ask"]', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const am = $('[data-amsg]', root);
    am.textContent = '送出中…';
    try {
      await requestAccess(fd.getAll('mod').map(String) as Module[], String(fd.get('note') ?? ''), String(fd.get('name') ?? ''));
      am.textContent = '已送出，管理者開通後重新整理即可。';
    } catch (e: any) { am.textContent = e.message; }
  });
  $<HTMLFormElement>('[data-f="redeem"]', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget as HTMLFormElement).get('code') ?? '');
    msg.textContent = '確認中…';
    try {
      const r = await redeem(code);
      if (!r) { msg.textContent = '這組代碼無效、已撤銷、已過期或已用完。'; return; }
      msg.textContent = `已綁定「${MODULES[r.module]}」。`;
      await gate(root, { ...o, code: '', notice: `已綁定「${MODULES[r.module]}」。` });
    } catch (e: any) { msg.textContent = e.message; }
  });
  $('[data-recheck]', root).addEventListener('click', () => gate(root, { ...o, notice: '' }));
  $('[data-out]', root).addEventListener('click', async () => { await signOut(); signedOut(root, { ...o, notice: '已登出。' }); });
  $('[data-codeonly]', root)?.addEventListener('click', () => signedOut(root, { ...o, notice: '' }));
}

const GOOGLE = '<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
