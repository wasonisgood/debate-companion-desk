import type { View, Cleanup } from '../../main';
import { html, raw, $ } from '../../lib/dom';
import { me, hasModule, savedCode, saveCode, codeStillValid, codeLogin, signOut, takeCodeParam, type Me } from '../../lib/auth';
import { gate } from '../gate';
import { fetchDebateBank, type Bank } from '../../lib/debateStorage';
import { initDebateAI } from '../../lib/debateAI';
import { initRecords } from '../../lib/debateRecords';
import { preloadIfNeeded } from '../../lib/stt';
import '../../styles/scoped/base.css';
import '../../styles/scoped/prep.css';
import '../../styles/scoped/debate.css';
import '../../styles/scoped/moot.css';

export type DebateTab = (el: HTMLElement, signal: AbortSignal) => Cleanup | Promise<Cleanup>;

/** Tabs kept in the desktop app. AI settings and LINE setup stay out on purpose. */
export const TABS: [string, string, () => Promise<{ default: DebateTab }>][] = [
  ['memorize', '口說教練', () => import('./memorize')],
  ['prep', '對戰準備', () => import('./prep')],
  ['bench', '單題攻防', () => import('./bench')],
  ['simulation', '40 分鐘模擬庭', () => import('./simulation')],
  ['records', '練習紀錄', () => import('./records')],
  ['manage', '題庫與稿件', () => import('./manage')],
];

/**
 * Mounts the debate module into `root`. Signing in / redeeming a code is the same
 * gate the website uses, so the same accounts and grants apply. Tabs switch in
 * place: the desktop app has no address bar to navigate.
 */
export const debateView: View = async (root, { signal, url }) => {
  if (signal.aborted) return;
  const linkCode = takeCodeParam(url, 'debate');

  let account: Me | null = null;
  try { account = await me(); } catch {}
  let via: 'account' | 'code' | null = hasModule(account, 'debate') ? 'account' : null;
  let notice = '';
  if (!via && !linkCode && savedCode('debate')) {
    if (await codeStillValid('debate')) via = 'code';
    else notice = '這組通行碼已被撤銷或已過期，請向管理者索取新的代碼，或改用帳號登入。';
  }
  let bank: Bank | null = null;
  let bankErr = '';
  if (via) {
    try {
      bank = await fetchDebateBank(via === 'code' ? savedCode('debate') : '');
      if (!bank) { via = null; if (savedCode('debate')) { saveCode('debate', ''); notice = '這組通行碼已失效，請向管理者索取新的代碼，或改用帳號登入。'; } }
    } catch (e: any) {
      bankErr = `題庫載入失敗：${e.message ?? e}`;
    }
  }
  if (signal.aborted) return;
  if (!via) {
    const again = () => debateView(root, { params: {}, signal, url: new URL(url.href) });
    return gate(root, {
      module: 'debate', kicker: 'Moot Court Practice', title: '辯論比賽練習模組', codes: true, code: linkCode, notice,
      intro: '紅十字會國際人道法模擬法庭（IHL Moot Court）專屬練習環境。請輸入管理者發給你的通行碼，或用已開通的帳號登入。',
      onCode: async (c) => {
        const r = await codeLogin('debate', c);
        if (!r) return '通行碼不正確、已撤銷、已過期或已達使用上限。';
        saveCode('debate', c.toUpperCase().replace(/\s+/g, ''));
        return null;
      },
      done: again,
    });
  }

  await initDebateAI(via === 'account' ? account : null);
  preloadIfNeeded();
  initRecords(via === 'account' ? account : null, via === 'code' ? savedCode('debate') : '', !!bank?.can_manage);
  if (signal.aborted) return;

  const who = via === 'account' ? (account!.display_name || account!.email) : `通行碼 ${savedCode('debate')}`;
  const initial = TABS.some(([k]) => k === url.searchParams.get('tab')) ? url.searchParams.get('tab')! : 'memorize';

  root.innerHTML = html`
    <header class="desk-head">
      <div>
        <span class="kicker">IHL Moot Court Drill · 2026-2027</span>
        <h1 id="debate-tab-title"></h1>
      </div>
      <p class="mono dim">${who} · <button class="linkish" id="lock-debate" type="button">${via === 'account' ? '登出' : '鎖定離開'}</button></p>
    </header>
    <nav class="desk-tabs" aria-label="辯論比賽練習模組導航">
      ${TABS.map(([k, l]) => raw(html`<button type="button" class="desk-tab" data-tab="${k}">${l}</button>`))}
    </nav>
    ${bankErr || (bank && !bank.data)
      ? raw(html`<p class="debate-bank-note mono">${bankErr ? bankErr : '題庫尚未發布或為空，請稍後再來或聯絡管理者。'}</p>`)
      : ''}
    <div id="debate-body" class="debate-body"><p class="loading">模組載入中……</p></div>
  `;

  $('#lock-debate', root)?.addEventListener('click', async () => {
    if (via === 'account') await signOut();
    else saveCode('debate', '');
    void debateView(root, { params: {}, signal, url: new URL(url.href) });
  });

  let teardown: Cleanup | null = null;
  let tabAbort: AbortController | null = null;
  let token = 0;
  const show = async (key: string) => {
    const mine = ++token;
    tabAbort?.abort();
    if (typeof teardown === 'function') teardown();
    teardown = null;
    const entry = TABS.find(([k]) => k === key) ?? TABS[0];
    root.querySelectorAll<HTMLButtonElement>('.desk-tab').forEach((b) => {
      const on = b.dataset.tab === entry[0];
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#debate-tab-title', root)!.textContent = `辯論比賽練習模組 · ${entry[1]}`;
    const body = $('#debate-body', root)!;
    body.innerHTML = '<p class="loading">模組載入中……</p>';
    const ctl = new AbortController();
    tabAbort = ctl;
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const mod = await entry[2]();
    if (mine !== token || ctl.signal.aborted) return;
    body.replaceChildren();
    const out = await mod.default(body, ctl.signal);
    if (mine === token) teardown = out ?? null;
  };
  root.querySelectorAll<HTMLButtonElement>('.desk-tab').forEach((b) => {
    b.addEventListener('click', () => void show(b.dataset.tab!));
  });
  void show(initial);
  // The desktop rail opens a specific tab (e.g. 對戰準備) without a page navigation.
  const onOpenTab = (e: Event) => {
    const key = (e as CustomEvent<string>).detail;
    if (TABS.some(([k]) => k === key)) void show(key);
  };
  window.addEventListener('desk:debate-tab', onOpenTab);
  signal.addEventListener('abort', () => {
    window.removeEventListener('desk:debate-tab', onOpenTab);
    tabAbort?.abort();
    if (typeof teardown === 'function') teardown();
  }, { once: true });
};

export default debateView;
