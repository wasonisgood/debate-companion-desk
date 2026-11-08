/**
 * 練習紀錄 — every saved attempt, its transcript and feedback, recordings
 * that were kept, and (for accounts) this person's own Claude usage and
 * estimated cost. Managers can switch to anyone's records.
 */
import { html, raw, $, $$, ago } from '../../lib/dom';
import { db } from '../../lib/db';
import { drawBars } from '../../lib/barChart';
import { fmtClock, fmtMin, JUDGES } from '../../lib/mootCourt';
import {
  listRecords, deleteRecord, audioUrl, recordIdentity, pendingCount, AUDIO_RULES,
  type DebateRecord, type RecordKind,
} from '../../lib/debateRecords';
import { aiContext, claudeBlocker, engineDescription, resolveEngine, usd, MODEL_LABEL } from '../../lib/debateAI';

const KIND: Record<RecordKind, string> = { coach: '口說教練', bench: '單題攻防', hearing: '模擬庭' };
const STAGE: Record<string, string> = { read: '跟讀', cue: '提詞', blind: '脫稿', interrupt: '抗打斷', chain: '串背', seat1: '第一辯士', seat2: '第二辯士', relay: '兩人接力' };
const TASK: Record<string, string> = { followup: '追問', evaluate: '單題評分', hearing: '庭後評議', ping: '金鑰測試' };

interface Person { user_id: string | null; code_id: string | null; name: string; email: string; seconds: number; records: number; }
interface MyUsage {
  month_cost: number; month_calls: number; month_tokens: number; total_cost: number; limit_usd: number;
  by_task: { task: string; calls: number; cost: number; input: number; output: number }[];
  by_day: { day: string; calls: number; cost: number }[];
  recent: { at: string; task: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; ok: boolean; error: string }[];
}

export default function renderRecords(container: HTMLElement, signal: AbortSignal) {
  const who = recordIdentity();
  let kind: RecordKind | '' = '';
  let person = ''; // '' = me, '*' = everyone, or a user id
  let rows: DebateRecord[] = [];
  let people: Person[] = [];
  let open = '';
  let err = '';
  let usage: MyUsage | null = null;
  let ro: ResizeObserver | null = null;

  async function load() {
    err = '';
    try {
      rows = await listRecords({ kind, userId: person, limit: 300 });
    } catch (e: any) {
      err = e.message ?? String(e);
      rows = [];
    }
    if (signal.aborted) return;
    render();
  }

  async function loadSide() {
    const tasks: PromiseLike<unknown>[] = [];
    if (who.uid)
      tasks.push(db().rpc('site_ai_my_usage').then(({ data }) => (usage = (data as MyUsage) ?? null)));
    if (who.manager)
      tasks.push(
        db().rpc('site_debate_time_summary', { p_days: 365 }).then(({ data }) => {
          people = ((data as any)?.by_person ?? []) as Person[];
        }),
      );
    await Promise.allSettled(tasks);
    if (!signal.aborted) render();
  }

  function render() {
    if (signal.aborted) return;
    const since = Date.now() - 30 * 86400_000;
    const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since);
    const secs = recent.reduce((a, r) => a + (r.duration_sec || 0), 0);
    const scored = recent.filter((r) => typeof r.score === 'number');
    const audio = rows.filter((r) => r.audio_path).length;
    const pend = pendingCount();
    const viewingOther = person && person !== who.uid;

    container.innerHTML = html`
      <div class="rec">
        <div class="tiles">
          <div class="tile"><span>近 30 天練習時間</span><b>${fmtMin(secs)}</b><small>${recent.length} 次練習</small></div>
          <div class="tile"><span>近 30 天平均分</span><b>${scored.length ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length) : '—'}</b><small>${scored.length} 次有評分</small></div>
          <div class="tile"><span>保存的錄音</span><b>${audio}</b><small>${who.uid ? '只有你與管理者聽得到' : '以帳號登入才會保存錄音'}</small></div>
          ${usage && !viewingOther
            ? raw(html`<div class="tile"><span>本月 AI 預估費用</span><b>${usd(Number(usage.month_cost))}</b><small>${usage.month_calls} 次呼叫 · 上限 ${usd(Number(usage.limit_usd))}</small></div>`)
            : raw(html`<div class="tile"><span>AI 評審</span><b class="rec-small">${engineDescription(resolveEngine())}</b><small>${claudeBlocker() || '可使用 Claude'}</small></div>`)}
        </div>
        ${pend ? raw(html`<p class="mono dim">${pend} 筆紀錄還在這台裝置上等待上傳（連上網路後重新整理即可）。</p>`) : ''}

        <div class="rec-bar">
          <div class="seg">
            ${([['', '全部'], ['coach', KIND.coach], ['bench', KIND.bench], ['hearing', KIND.hearing]] as const).map(([k, l]) =>
              raw(html`<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`))}
          </div>
          ${who.manager && who.uid
            ? raw(html`<select id="rec-person" aria-label="查看誰的紀錄">
                <option value="" ${person === '' ? raw('selected') : ''}>我的紀錄</option>
                <option value="*" ${person === '*' ? raw('selected') : ''}>所有成員</option>
                ${people.filter((p) => p.user_id && p.user_id !== who.uid).map((p) =>
                  raw(html`<option value="${p.user_id}" ${person === p.user_id ? raw('selected') : ''}>${p.name || p.email} · ${fmtMin(p.seconds)}</option>`))}
              </select>`)
            : ''}
          <span class="mono dim">${rows.length} 筆</span>
        </div>
        ${err ? raw(html`<p class="mono" style="color:var(--shu)">讀取失敗：${err}</p>`) : ''}

        <table class="board rec-table">
          <thead><tr><th>時間</th><th>類型</th><th>內容</th><th class="num">分數</th><th class="num">時長</th><th>錄音</th></tr></thead>
          <tbody>
            ${rows.length
              ? rows.map((r) => raw(html`
                <tr class="rec-row ${open === r.id ? 'on' : ''}" data-open="${r.id}" tabindex="0">
                  <td class="dim">${ago(r.created_at)}</td>
                  <td>${KIND[r.kind]}${r.stage ? raw(html` <span class="dim">· ${STAGE[r.stage] ?? r.stage}</span>`) : ''}</td>
                  <td>${r.title}${person === '*' ? raw(html` <span class="dim">· ${ownerName(r)}</span>`) : ''}${r.passed ? raw(' <span class="rec-pass">過關</span>') : ''}</td>
                  <td class="num">${r.score ?? '—'}</td>
                  <td class="num">${r.duration_sec ? fmtClock(r.duration_sec) : '—'}</td>
                  <td>${r.audio_path ? '●' : ''}</td>
                </tr>
                ${open === r.id ? raw(html`<tr class="rec-detail"><td colspan="6">${raw(detailHtml(r))}</td></tr>`) : ''}`))
              : raw('<tr><td colspan="6" class="dim">還沒有紀錄。練習完會自動出現在這裡。</td></tr>')}
          </tbody>
        </table>

        ${usage && !viewingOther ? raw(usageHtml(usage)) : ''}

        <section class="desk-sec">
          <h2>保存規則</h2>
          <p class="dim">每一次練習都會保存文字紀錄（逐字稿、分數、回饋、提示使用）。錄音只在值得回聽時保存，避免占用空間：</p>
          <ul class="rec-rules">${AUDIO_RULES.map((x) => raw(html`<li><b>${x.label}</b>${x.rule}</li>`))}</ul>
          <p class="dim">未達門檻的錄音，可以在該次結果畫面按「仍要保存這段錄音」。錄音存在私人空間，只有你和管理者能播放。</p>
        </section>
      </div>`;
    bind();
    const chart = $('#rec-chart', container);
    ro?.disconnect();
    if (chart && usage) {
      const byDay = new Map<string, number>();
      for (let i = 29; i >= 0; i--) byDay.set(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), 0);
      for (const d of usage.by_day) byDay.set(d.day, Number(d.cost));
      const series = [...byDay];
      ro = new ResizeObserver(() => drawBars(chart, series, (v) => `<b>${usd(v)}</b>`, '每日 AI 費用', (v) => (v ? `$${v.toFixed(v < 0.1 ? 3 : 2)}` : '0')));
      ro.observe(chart);
    }
  }

  function ownerName(r: DebateRecord): string {
    const p = people.find((x) => (r.user_id && x.user_id === r.user_id) || (r.code_id && x.code_id === r.code_id));
    return p ? p.name || p.email : r.user_id ? '帳號' : '代碼';
  }

  function detailHtml(r: DebateRecord): string {
    const d: any = r.detail ?? {};
    const canDelete = !!who.uid && (r.user_id === who.uid || who.manager);
    const head = html`
      <div class="rec-meta mono dim">
        ${new Date(r.created_at).toLocaleString('zh-TW')} · ${r.side === 'prosecution' ? '控方' : '辯方'}
        ${r.engine ? ` · 評分：${r.engine}` : ''}${r.accuracy != null ? ` · 完整度 ${r.accuracy}%` : ''}
      </div>
      ${r.audio_path
        ? raw(html`<div class="rec-audio"><button class="btn small ghost" data-play="${r.audio_path}">▶ 播放錄音</button>
            <span class="mono dim">${r.audio_bytes ? `${Math.round(r.audio_bytes / 1024)} KB` : ''}${r.audio_reason ? ` · ${r.audio_reason}` : ''}</span></div>`)
        : ''}`;
    let body = '';
    if (r.kind === 'hearing' && d.report) {
      const rep = d.report;
      body = html`
        ${rep.overall ? raw(html`<p class="hear-overall">${rep.overall}</p>`) : ''}
        <ul class="rec-facts mono dim">
          <li>用時 ${fmtClock(rep.elapsed)} / ${fmtClock(rep.total)} · 提問 ${rep.qa?.length ?? 0} · 提示 ${rep.hints?.length ?? 0} 次 · ${rep.judges} 位法官</li>
          ${(rep.phases ?? []).map((p: any) => raw(html`<li>${p.label}：${fmtClock(p.used)} / ${fmtClock(p.allotted)} · 主稿覆蓋 ${p.coverage}% · ${p.finished ? '講完' : '未講完'}</li>`))}
        </ul>
        ${rep.advice?.length ? raw(html`<h4>教練建議</h4><ol class="hear-advice">${rep.advice.map((a: string) => raw(html`<li>${a}</li>`))}</ol>`) : ''}
        ${rep.qa?.length ? raw(html`<h4>法官問答</h4><ol class="hear-qa">${rep.qa.map((x: any) => raw(html`
          <li class="${x.followUp ? 'fu' : ''}"><header><span class="mono">${fmtClock(x.at)} · ${JUDGES[x.judge]?.zh ?? ''}${x.followUp ? ' · 追問' : ''}${x.qid ? ` · ${x.qid}` : ''}</span><b>${typeof x.score === 'number' ? `${x.score} 分` : ''}</b></header>
          <p class="q">${x.question}</p><p class="a">${x.answer || '（沒有收到回答）'}</p>${x.feedback ? raw(html`<p class="mono dim">${x.feedback}</p>`) : ''}</li>`))}</ol>`) : ''}`;
    } else if (r.kind === 'bench') {
      const s = d.scores ?? {};
      body = html`
        ${d.scores ? raw(html`<p class="mono dim">法理 ${s.legal} · 直接 ${s.direct} · 流暢 ${s.fluency} · 策略 ${s.strategy}${d.wpm ? ` · ${d.wpm} WPM` : ''}${d.hints ? ` · 提示 ${d.hints} 次` : ''}</p>`) : ''}
        ${d.feedback?.summary ? raw(html`<p>${d.feedback.summary}</p>`) : ''}
        ${d.feedback?.legalCritique ? raw(html`<p class="dim">${d.feedback.legalCritique}</p>`) : ''}
        <div class="drill-fb">
          <div><span class="mono">做得好</span>${(d.feedback?.strengths ?? []).map((x: string) => raw(html`<p>${x}</p>`))}</div>
          <div><span class="mono">下次改</span>${(d.feedback?.improvements ?? []).map((x: string) => raw(html`<p>${x}</p>`))}</div>
        </div>
        ${d.notes ? raw(html`<p class="dim">${d.notes}</p>`) : ''}`;
    } else {
      body = html`
        <p class="mono dim">${d.words ? `${d.matched}/${d.words} 字` : ''}${d.wpm ? ` · ${d.wpm} WPM` : ''}${d.hints ? ` · 提示 ${d.hints} 次` : ''}${d.resume ? ` · 接回主稿：${{ ok: '準確', skipped: '跳段', repeated: '重講' }[d.resume as 'ok']}` : ''}</p>
        ${d.missedKeys?.length ? raw(html`<p class="coach-miss"><span class="mono">漏掉的關鍵詞</span>${d.missedKeys.map((k: string) => raw(html`<i>${k}</i>`))}</p>`) : ''}
        ${d.question ? raw(html`<p><b>法官：</b>${d.question.text}</p><p><b>你：</b>${d.answer || '（未收到）'}</p>`) : ''}
        ${d.notes ? raw(html`<p class="dim">${d.notes}</p>`) : ''}`;
    }
    return html`${raw(head)}${raw(body)}
      ${r.transcript ? raw(html`<details><summary class="mono">逐字稿</summary><p class="hear-transcript">${r.transcript}</p></details>`) : ''}
      ${canDelete ? raw(html`<p><button class="btn small ghost danger" data-del="${r.id}">刪除這筆紀錄${r.audio_path ? '與錄音' : ''}</button></p>`) : ''}`;
  }

  function usageHtml(u: MyUsage): string {
    const ctx = aiContext();
    return html`
      <section class="desk-sec">
        <h2>我的 AI 用量（預估）</h2>
        <p class="dim">費用依 Claude 公開價格與實際 token 數估算，僅供參考；本頁開啟以來 ${ctx.calls} 次呼叫，約 ${usd(ctx.spent)}。累計 90 天 ${usd(Number(u.total_cost))}。</p>
        <div class="chart" id="rec-chart"></div>
        <div class="two-col">
          <table class="board"><thead><tr><th>本月用途</th><th class="num">次數</th><th class="num">tokens（入／出）</th><th class="num">費用</th></tr></thead>
            <tbody>${u.by_task.length
              ? u.by_task.map((t) => raw(html`<tr><td>${TASK[t.task] ?? t.task}</td><td class="num">${t.calls}</td><td class="num">${Number(t.input).toLocaleString()} / ${Number(t.output).toLocaleString()}</td><td class="num">${usd(Number(t.cost))}</td></tr>`))
              : raw('<tr><td colspan="4" class="dim">本月還沒有使用 Claude。</td></tr>')}</tbody></table>
          <table class="board"><thead><tr><th>最近呼叫</th><th>模型</th><th class="num">tokens</th><th class="num">費用</th></tr></thead>
            <tbody>${u.recent.slice(0, 12).map((x) => raw(html`<tr class="${x.ok ? '' : 'odd'}"><td class="dim">${ago(x.at)} · ${TASK[x.task] ?? x.task}</td><td>${MODEL_LABEL[x.model] ?? x.model}</td>
              <td class="num">${x.input_tokens + x.cache_read_tokens}/${x.output_tokens}</td><td class="num">${x.ok ? usd(Number(x.cost_usd)) : '失敗'}</td></tr>`))}</tbody></table>
        </div>
      </section>`;
  }

  function bind() {
    $$<HTMLButtonElement>('[data-kind]', container).forEach((b) =>
      b.addEventListener('click', () => {
        kind = b.dataset.kind as RecordKind | '';
        open = '';
        void load();
      }),
    );
    $('#rec-person', container)?.addEventListener('change', (e) => {
      person = (e.target as HTMLSelectElement).value;
      open = '';
      void load();
    });
    $$<HTMLElement>('[data-open]', container).forEach((tr) => {
      const toggle = () => {
        open = open === tr.dataset.open ? '' : tr.dataset.open!;
        render();
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle()));
    });
    $$<HTMLButtonElement>('[data-play]', container).forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        b.disabled = true;
        try {
          const url = await audioUrl(b.dataset.play!);
          const a = document.createElement('audio');
          a.controls = true;
          a.src = url;
          a.className = 'rec-player';
          b.replaceWith(a);
          void a.play().catch(() => {});
        } catch (er: any) {
          b.textContent = `無法播放：${er.message ?? er}`;
        }
      }),
    );
    $$<HTMLButtonElement>('[data-del]', container).forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = rows.find((x) => x.id === b.dataset.del);
        if (!r || !confirm('刪除這筆紀錄？刪除後無法復原。')) return;
        try {
          await deleteRecord(r);
          rows = rows.filter((x) => x.id !== r.id);
          open = '';
          render();
        } catch (er: any) {
          alert(er.message ?? er);
        }
      }),
    );
  }

  container.innerHTML = '<p class="loading">讀取練習紀錄……</p>';
  void load();
  void loadSide();
  return () => ro?.disconnect();
}
