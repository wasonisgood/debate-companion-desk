import type { View, Cleanup } from '../../main';
import { html, raw, $ } from '../../lib/dom';
import { me, hasModule, savedCode, saveCode, codeStillValid, codeLogin, takeCodeParam, type Me } from '../../lib/auth';
import { gate } from '../gate';
import { fetchDebateBank, type Bank } from '../../lib/debateStorage';
import { initDebateAI } from '../../lib/debateAI';
import { initRecords, pendingCount } from '../../lib/debateRecords';
import { preloadIfNeeded } from '../../lib/stt';
import '../../styles/prep.css';
import '../../styles/debate.css';
import '../../styles/moot.css';

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
 * gate the website uses, so the same accounts and grants apply.
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

  const tabParam = url.searchParams.get('tab') ?? 'memorize';
  const currentTab = TABS.some(([k]) => k === tabParam) ? tabParam : 'memorize';
  const [, label, load] = TABS.find(([k]) => k === currentTab)!;
  const who = via === 'account' ? (account!.display_name || account!.email) : `通行碼 ${savedCode('debate')}`;

  root.innerHTML = html`
    <header class="desk-head">
      <div>
        <span class="kicker">IHL Moot Court Drill · 2026-2027</span>
        <h1>辯論比賽練習模組 · ${label}</h1>
      </div>
      <p class="mono dim">${who} · <a href="#" id="lock-debate">${via === 'account' ? '登出' : '鎖定離開'}</a></p>
    </header>
    <nav class="desk-tabs" aria-label="辯論比賽練習模組導航">
      ${TABS.map(([k, l]) => raw(html`<a href="?tab=${k}" data-tab="${k}" ${k === currentTab ? raw('aria-current="page"') : ''}>${l}</a>`))}
    </nav>
    ${bankErr || (bank && !bank.data)
      ? raw(html`<p class="debate-bank-note mono">${bankErr ? bankErr : '題庫尚未發布或為空，請稍後再來或聯絡管理者。'}</p>`)
      : ''}
    <div id="debate-body"><p class="loading">模組載入中……</p></div>
  `;
  void pendingCount;
  const body = $('#debate-body', root);
  const mod = await load();
  if (signal.aborted) return;
  body.replaceChildren();
  return mod.default(body, signal);
};

export default debateView;
