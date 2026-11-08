/**
 * New bench questions on demand, so drills never run out.
 *
 * Claude (task 'gen') writes questions in the bank's own format from what the
 * bench would actually press on: this counsel's script, the issues already in
 * the bank (to avoid repeats), the focused opponent's arguments, and the
 * Statement of Agreed Facts. There is no local-model fallback. New questions
 * are saved into the bank on this device (category「AI 新題」, ids AI-P-001 /
 * AI-D-001) and can be edited or published like any other.
 */
import type { BenchQuestion } from './debateData';
import { loadDebateData, saveDebateData, type DebateData } from './debateStorage';
import { callClaude, resolveEngine } from './debateAI';
import { cleanScript, questionsOf, seatOf, oralOf, SEAT_INFO, type Seat, type Side } from './mootCourt';
import { focusMatch, prepMeta, matchTitle } from './matchPrep';
import { sanitizeQuestion } from './debateQuestionSanitizer';

type Gen = Pick<BenchQuestion, 'title' | 'category' | 'issue' | 'questionEn' | 'questionZh' | 'followUp' | 'followUpZh' | 'structure' | 'sampleEn' | 'sampleZh'>;

export const canGenerate = () => resolveEngine() !== 'rules';

function input(d: DebateData, side: Side, seat: Seat | 0, n: number) {
  const units = oralOf(d, side).filter((u) => !seat || seatOf(u) === seat);
  const m = focusMatch(d, side);
  return {
    side,
    seat: seat ? SEAT_INFO[seat].en : 'both counsel',
    n,
    script: units.map((u) => cleanScript(u.textEn)).join('\n').slice(0, 40_000),
    existing: questionsOf(d, side).map((q) => `${q.id}: ${q.questionEn}`).join('\n').slice(0, 25_000),
    opponent: m ? `${matchTitle(m)} — ${m.reading.claims.map((c) => `${c.paras} ${c.claim}`).join(' | ')}`.slice(0, 8_000) : '',
    facts: prepMeta(d).facts.slice(0, 30_000),
  };
}

async function ask(inp: ReturnType<typeof input>, signal?: AbortSignal): Promise<Gen[]> {
  const eng = resolveEngine();
  if (eng === 'claude') {
    try {
      const r = await callClaude<{ questions: Gen[] }>('gen', inp, signal);
      if (r.data?.questions?.length) return r.data.questions;
    } catch (e) {
      console.info('Claude question generation unavailable', e);
    }
  }
  throw new Error('出新題需要 AI：請用帳號登入並由管理者開通 Claude。');
}

/**
 * Generate `n` new questions for this side / counsel, add them to the bank
 * (saved on this device) and to `into` when given (the caller's live data).
 */
export async function generateQuestions(side: Side, seat: Seat | 0, n = 5, into?: DebateData, signal?: AbortSignal): Promise<BenchQuestion[]> {
  const d = loadDebateData();
  const got = await ask(input(d, side, seat, n), signal);
  const prefix = `AI-${side === 'prosecution' ? 'P' : 'D'}-`;
  const m = focusMatch(d, side);
  const out: BenchQuestion[] = [];
  for (const targets of [d, into].filter(Boolean) as DebateData[]) {
    const list = questionsOf(targets, side);
    const seen = new Set(list.map((q) => q.questionEn.trim().toLowerCase()));
    let k = list.filter((q) => q.id.startsWith(prefix)).length + 1;
    for (const g of got) {
      if (!g?.questionEn || seen.has(g.questionEn.trim().toLowerCase())) continue;
      while (list.some((q) => q.id === `${prefix}${String(k).padStart(3, '0')}`)) k++;
      const id = `${prefix}${String(k).padStart(3, '0')}`;
      const q: BenchQuestion = {
        id, title: `${id} ${g.title || g.questionEn.slice(0, 50)}`, side, category: 'AI 新題',
        where: '', whereZh: '', issue: g.issue ?? '', questionEn: g.questionEn, questionZh: g.questionZh ?? '',
        followUp: g.followUp ?? '', followUpZh: g.followUpZh ?? '', structure: Array.isArray(g.structure) ? g.structure : [],
        sampleEn: g.sampleEn ?? '', sampleZh: g.sampleZh ?? '',
        ...(seat ? { seat } : {}), ...(m ? { match: m.id } : {}),
      };
      sanitizeQuestion(q);
      list.push(q);
      seen.add(g.questionEn.trim().toLowerCase());
      if (targets === d) out.push(q);
    }
  }
  saveDebateData(d);
  return out;
}
