/**
 * AI Judge Intelligence: Follow-up question generation, multi-turn reasoning,
 * fluency and hesitation detection, and moot court segment evaluation.
 */

import { type BenchQuestion } from './debateData';
import { loadSettings, streamChat, type Msg } from '../llm/backends';
import { callClaude, engineDescription, localLLMReady, resolveEngine, type Engine } from './debateAI';

export interface EvaluationResult {
  totalScore: number; // 0 - 100
  legalScore: number; // 0 - 25
  directScore: number; // 0 - 25
  fluencyScore: number; // 0 - 25
  strategyScore: number; // 0 - 25
  wpm: number;
  pausesCount: number;
  fillerWordsCount: number;
  fillerWords: string[];
  engineSource: 'llm' | 'heuristic';
  engineName?: string;
  feedback: {
    strengths: string[];
    improvements: string[];
    legalCritique: string;
    summary: string;
  };
}

export function getJudgeEngineStatus(): { isLocalLLM: boolean; engine: Engine; description: string; backend: string } {
  const engine = resolveEngine();
  return {
    // "has a real model" (Claude or local); kept under the old name for callers
    isLocalLLM: engine !== 'rules',
    engine,
    description: engineDescription(engine),
    backend: engine === 'local' ? loadSettings().backend : engine,
  };
}

export interface FluencyMetrics {
  durationSec: number;
  pausesCount: number;
  silenceTotalSec: number;
}

const COMMON_FILLER_WORDS = [
  'um',
  'uh',
  'er',
  'ah',
  'like',
  'you know',
  'basically',
  'actually',
  'sort of',
  'kind of',
  '那個',
  '這個',
  '呃',
  '啊',
  '就是說',
  '然後呢',
  '嗯',
];

/** Detect filler words and hesitation in speech */
export function analyzeSpeechFluency(
  text: string,
  metrics: FluencyMetrics,
): { wpm: number; pausesCount: number; fillerCount: number; foundFillers: string[]; rating: '流暢' | '中等' | '稍卡頓' | '明顯卡頓' } {
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+|(?=[\u4e00-\u9fff])/).filter(Boolean);
  const wordCount = words.length;

  const effectiveMins = Math.max(0.08, metrics.durationSec / 60);
  const wpm = Math.round(wordCount / effectiveMins);

  const foundFillers: string[] = [];
  let fillerCount = 0;

  for (const f of COMMON_FILLER_WORDS) {
    const re = new RegExp(`\\b${f}\\b|${f}`, 'gi');
    const matches = lower.match(re);
    if (matches) {
      fillerCount += matches.length;
      if (!foundFillers.includes(f)) foundFillers.push(f);
    }
  }

  // Stutter detection: repeated adjacent words (e.g. "the the", "we we", "這個 這個")
  const repeatRe = /\b([a-zA-Z\u4e00-\u9fff]+)\s+\1\b/gi;
  const repeats = text.match(repeatRe);
  if (repeats) {
    fillerCount += repeats.length * 2;
  }

  let rating: '流暢' | '中等' | '稍卡頓' | '明顯卡頓' = '流暢';
  if (metrics.pausesCount > 4 || fillerCount > 6 || wpm < 85) rating = '明顯卡頓';
  else if (metrics.pausesCount > 2 || fillerCount > 3 || wpm < 105) rating = '稍卡頓';
  else if (metrics.pausesCount > 0 || fillerCount > 1) rating = '中等';

  return { wpm, pausesCount: metrics.pausesCount, fillerCount, foundFillers, rating };
}

/**
 * Generate a follow-up question based on the debater's actual answer.
 * Claude → local model → rule engine. Returns bilingual text for the local
 * and rule paths; Claude returns the English question only (it is spoken).
 */
export async function generateFollowUpQuestion(
  q: BenchQuestion,
  debaterAnswer: string,
  signal?: AbortSignal,
): Promise<string> {
  const engine = resolveEngine();
  if (engine === 'claude' && wordCount(debaterAnswer) >= MIN_AI_WORDS) {
    try {
      const r = await callClaude<{ question: string }>('followup', { q: slimQ(q, false), answer: debaterAnswer }, signal);
      const t = r.data?.question?.trim();
      if (t) return `"${t.replace(/^["“]|["”]$/g, '')}"`;
    } catch (e) {
      console.info('Claude follow-up unavailable, falling back', e);
    }
  }
  if (localLLMReady() && engine !== 'rules') {
    const settings = loadSettings();
    try {
      const messages: Msg[] = [
        {
          role: 'system',
          content: `You are a stern, authoritative judge at the International Criminal Court (ICC) Moot Court competition (Prosecutor v. Roger Thorn).
Ask ONE sharp, direct follow-up question strictly in English.
Requirements:
1. Speak in authoritative judicial English starting with "Counsel, ".
2. Press directly on the unproven elements, factual loopholes, or logical fallacies in the debater's immediate oral answer.
3. Output STRICTLY the English question (1-2 sentences, max 40 words).
4. Strictly NO Chinese characters, prefixes, or bilingual explanations.`,
        },
        {
          role: 'user',
          content: `Original Question (${q.id}):
${q.questionEn}
Issue: ${q.issue}

Debater's Immediate Oral Answer:
"${debaterAnswer}"

Provide your judicial follow-up question in English:`,
        },
      ];

      let result = '';
      for await (const chunk of streamChat(settings, messages, signal ?? new AbortController().signal)) {
        result += chunk;
      }
      if (result.trim()) {
        const cleaned = result.trim().replace(/^["“]|["”]$/g, '').replace(/[\u4e00-\u9fa5].*$/s, '').trim();
        if (cleaned) return cleaned.startsWith('Counsel') ? cleaned : `Counsel, ${cleaned}`;
      }
    } catch (e) {
      console.warn('LLM stream error, falling back to heuristic engine', e);
    }
  }

  // Built-in intelligent moot judge follow-up fallback
  return getHeuristicFollowUp(q, debaterAnswer);
}

/** Answers shorter than this are not worth a model call: the rule engine scores them. */
export const MIN_AI_WORDS = 8;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Only the fields the model needs: keeps every request small. */
function slimQ(q: BenchQuestion, withSample: boolean) {
  return {
    id: q.id,
    issue: q.issue,
    questionEn: q.questionEn,
    structure: q.structure.filter((s) => !/[一-鿿]/.test(s)).slice(0, 8),
    ...(withSample ? { sampleEn: q.sampleEn } : {}),
  };
}

export function getHeuristicFollowUp(q: BenchQuestion, answer: string): string {
  // If the question already has an official English follow-up, use it
  if (q.followUp && !/[\u4e00-\u9fa5]/.test(q.followUp)) {
    return q.followUp.trim().replace(/^Counsel,?\s*/i, 'Counsel, ');
  }

  const low = answer.toLowerCase();

  if (q.category === 'IAC' || low.includes('tadic') || low.includes('conflict')) {
    return 'Counsel, if I may press you on that point: even granting that an armed conflict began on 15 March, by what precise legal standard can this Court find that hostilities continued during the subsequent three months of absolute military inactivity?';
  }

  if (q.category === 'Count 1 (Jaku)' || low.includes('jaku') || low.includes('injection') || low.includes('medical')) {
    return 'Counsel, you maintain this was legitimate emergency care, but can you point to any established medical protocol that justifies administering an unapproved experimental compound to comatose soldiers without independent ethical review?';
  }

  if (q.category === 'Count 2 (Airstrike)' || low.includes('school') || low.includes('target') || low.includes('civilian')) {
    return 'Counsel, even if intelligence suggested potential military dual-use, does the commander\'s failure to conduct real-time reconnaissance after the President specifically raised doubts not evince direct willful blindness or recklessness under Article 30?';
  }

  return 'Counsel, taking your argument to its logical conclusion, how do you reconcile that position with the express requirements of the Rome Statute and established customary international humanitarian law?';
}

/**
 * Score and evaluate a debater's response paragraph.
 */
export async function evaluateAnswer(
  q: BenchQuestion,
  answer: string,
  metrics: FluencyMetrics,
  signal?: AbortSignal,
  extra?: { firstAnswer?: string; followUp?: string; followAnswer?: string },
): Promise<EvaluationResult> {
  const fluency = analyzeSpeechFluency(answer, metrics);
  const settings = loadSettings();
  const engine = resolveEngine();
  const enough = wordCount(answer) >= MIN_AI_WORDS;
  const hasLocalLLM = engine !== 'rules' && enough && localLLMReady();
  let engineName = '';

  let legalScore = 20;
  let directScore = 20;
  let fluencyScore = 20;
  let strategyScore = 20;
  let summary = '';
  let legalCritique = '';
  const strengths: string[] = [];
  const improvements: string[] = [];

  // Deduct fluency score based on pauses and hesitation
  if (fluency.rating === '明顯卡頓') fluencyScore = 14;
  else if (fluency.rating === '稍卡頓') fluencyScore = 17;
  else if (fluency.rating === '中等') fluencyScore = 21;
  else fluencyScore = 24;

  if (fluency.fillerCount > 0) {
    improvements.push(`注意口語填充詞（出現 ${fluency.fillerCount} 次，如 "${fluency.foundFillers.slice(0, 3).join('", "')}"），建議以沈穩停頓代替冗贅詞。`);
  } else {
    strengths.push('語言精準流暢，未出現多餘贅字或口頭禪。');
  }

  if (fluency.pausesCount > 2) {
    improvements.push(`答辯過程中出現 ${fluency.pausesCount} 次顯著中斷，注意法庭節奏掌控，維持平穩語速（目前約 ${fluency.wpm} WPM）。`);
  } else {
    strengths.push(`答辯節奏穩健（約 ${fluency.wpm} WPM），符合國際法庭辯論標準節奏。`);
  }

  if (engine === 'claude' && enough) {
    try {
      const r = await callClaude<{ legal: number; direct: number; strategy: number; strengths: string[]; improvements: string[]; critique: string; summary: string }>(
        'evaluate',
        {
          q: slimQ(q, true),
          answer: extra?.firstAnswer ?? answer,
          sec: metrics.durationSec,
          ...(extra?.followUp ? { followUp: extra.followUp, answer2: extra.followAnswer ?? '' } : {}),
        },
        signal,
      );
      const d = r.data;
      const clamp = (n: unknown, d0: number) => (typeof n === 'number' && isFinite(n) ? Math.min(25, Math.max(0, Math.round(n))) : d0);
      legalScore = clamp(d.legal, legalScore);
      directScore = clamp(d.direct, directScore);
      strategyScore = clamp(d.strategy, strategyScore);
      if (Array.isArray(d.strengths)) strengths.push(...d.strengths.slice(0, 2));
      if (Array.isArray(d.improvements)) improvements.push(...d.improvements.slice(0, 3));
      legalCritique = d.critique ?? '';
      summary = d.summary || ' ';
      engineName = `${engineDescription('claude')}${r.cached ? ' · 快取' : ''}`;
    } catch (e) {
      console.info('Claude grading unavailable, falling back', e);
    }
  }

  if (!summary && hasLocalLLM) {
    try {
      const messages: Msg[] = [
        {
          role: 'system',
          content: `你是一名資深國際人道法（IHL）模擬法庭總裁判長。
請依據評分規準對選手的即時答辯進行專業評分，輸出 JSON 格式：
{
  "legalScore": 0-25之間的整數,
  "directScore": 0-25之間的整數,
  "strategyScore": 0-25之間的整數,
  "strengths": ["優點1", "優點2"],
  "improvements": ["改進建議1", "改進建議2"],
  "legalCritique": "法理涵攝詳細講評",
  "summary": "一句話裁判總評"
}`,
        },
        {
          role: 'user',
          content: `題目（${q.id}）：${q.questionEn}
中文題意：${q.questionZh}
核心爭點：${q.issue}
官方回答架構：${q.structure.join(' / ')}
選手答辯內容：
"${answer}"`,
        },
      ];

      let rawJson = '';
      for await (const chunk of streamChat(settings, messages, signal ?? new AbortController().signal)) {
        rawJson += chunk;
      }

      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.legalScore === 'number') legalScore = Math.min(25, Math.max(8, parsed.legalScore));
        if (typeof parsed.directScore === 'number') directScore = Math.min(25, Math.max(8, parsed.directScore));
        if (typeof parsed.strategyScore === 'number') strategyScore = Math.min(25, Math.max(8, parsed.strategyScore));
        if (Array.isArray(parsed.strengths)) strengths.push(...parsed.strengths);
        if (Array.isArray(parsed.improvements)) improvements.push(...parsed.improvements);
        if (parsed.legalCritique) legalCritique = parsed.legalCritique;
        if (parsed.summary) summary = parsed.summary;
        if (summary) engineName = settings.backend === 'builtin' ? 'Chrome 內建 Prompt API' : `${settings.backend.toUpperCase()} · ${settings.model}`;
      }
    } catch (e) {
      console.warn('LLM evaluate error, fallback to heuristics', e);
    }
  }

  const isFromLLM = Boolean(summary);

  // Heuristic rule-based evaluation if LLM didn't fill in
  if (!summary) {
    const textLower = answer.toLowerCase();

    // Check direct answer
    const directStarters = ['yes', 'no', 'we accept', 'your excellency', 'the prosecution', 'the defense', '是的', '不是', '庭上', '辯方', '檢方'];
    const hasDirectStart = directStarters.some((s) => textLower.startsWith(s) || answer.startsWith(s));
    if (hasDirectStart) {
      directScore = 23;
      strengths.push('開門見山正面回答庭上提問（Direct Answer），未迴避核心質問。');
    } else {
      directScore = 16;
      improvements.push('回答開頭應更加直接（例如以 "Yes, Your Excellency" 或 "No, the Defense submits..." 明確表明立場），再開展法律理由。');
    }

    // Check legal authorities
    const authorities = ['tadic', 'rome statute', 'article', 'commentary', 'geneva', 'icrc', 'bemba', 'lubanga', 'elements of crimes', '條', '公約', '規約', '判例'];
    const citedAuths = authorities.filter((a) => textLower.includes(a));
    if (citedAuths.length >= 2) {
      legalScore = 23;
      strengths.push(`準確援引法律權威與規範要件（${citedAuths.slice(0, 3).join(', ')}），法理依據扎實。`);
    } else {
      legalScore = 17;
      improvements.push('建議加強具體條文與權威判決援引（如 Rome Statute Art 8 / Art 25 / Art 30 或 Tadić / ICRC Commentary），提升法庭說服力。');
    }

    // Roadmap & transition
    if (textLower.includes('return to') || textLower.includes('roadmap') || textLower.includes('first') || answer.includes('回到') || answer.includes('首先')) {
      strategyScore = 23;
      strengths.push('展現優良法庭態勢，答辯後能主動收束並回歸口說稿主軸（Transition to roadmap）。');
    } else {
      strategyScore = 18;
      improvements.push('答辯結尾建議加上銜接句：「If that answers Your Excellency’s question, I will now return to...」確保辯論時間掌握。');
    }

    legalCritique = `針對「${q.issue || q.title}」，答辯大致涵蓋了核心立場，但若能對事實與法條構成要件進行更緊密的涵攝（Subsumption），法官將更難挑出漏洞。`;
    summary = enough
      ? `整體表現良好，法庭禮儀與法律核心掌握度具備水平，持續精煉直接回答與法條銜接將更具殺傷力。`
      : '回答太短，無法評出法理內容（未送 AI 評分）。先表態，再給一個法律理由。';
    if (!enough) {
      legalScore = Math.min(legalScore, 8);
      strategyScore = Math.min(strategyScore, 10);
    }
  }

  const totalScore = legalScore + directScore + fluencyScore + strategyScore;

  return {
    totalScore,
    legalScore,
    directScore,
    fluencyScore,
    strategyScore,
    wpm: fluency.wpm,
    pausesCount: fluency.pausesCount,
    fillerWordsCount: fluency.fillerCount,
    fillerWords: fluency.foundFillers,
    engineSource: isFromLLM ? 'llm' : 'heuristic',
    engineName: isFromLLM ? engineName : undefined,
    feedback: {
      strengths: Array.from(new Set(strengths)),
      improvements: Array.from(new Set(improvements)),
      legalCritique,
      summary: summary.trim(),
    },
  };
}

/* ------------------------------------------------------------------ hearing */

export interface HearingGrade {
  items: { i: number; score: number; note: string }[];
  overall: string;
  advice: string[];
  engine: string;
  cost?: number;
}

/**
 * Grade a whole hearing in ONE Claude call (instead of one call per
 * question). Returns null when Claude is not the engine or unavailable; the
 * caller then grades question by question with the local engine.
 */
export async function evaluateHearing(input: {
  side: string;
  mode: string;
  stats: string;
  qa: { qid: string; question: string; answer: string; sec: number; followUp: boolean }[];
  questions: BenchQuestion[];
}, signal?: AbortSignal): Promise<HearingGrade | null> {
  if (resolveEngine() !== 'claude') return null;
  const answered = input.qa.filter((x) => wordCount(x.answer) >= 3);
  if (!answered.length) return null;
  const questions: Record<string, ReturnType<typeof slimQ>> = {};
  for (const q of input.questions) if (input.qa.some((x) => x.qid === q.id)) questions[q.id] = slimQ(q, true);
  try {
    const r = await callClaude<{ items: HearingGrade['items']; overall: string; advice: string[] }>(
      'hearing',
      { side: input.side, mode: input.mode, stats: input.stats, qa: input.qa, questions },
      signal,
    );
    return {
      items: Array.isArray(r.data.items) ? r.data.items : [],
      overall: r.data.overall ?? '',
      advice: Array.isArray(r.data.advice) ? r.data.advice.slice(0, 4) : [],
      engine: `${engineDescription('claude', 'hearing')}${r.cached ? ' · 快取' : ''}`,
      cost: r.usage?.cost,
    };
  } catch (e) {
    console.info('Claude hearing grading unavailable', e);
    return null;
  }
}

/**
 * Check whether the browser's built-in Google Chrome Prompt API supports multimodal audio inputs.
 * Uses the latest Chrome Prompt API specification (`LanguageModel.create({ expectedInputs: [...] })`).
 */
export async function checkChromePromptApiMultimodalSupport(): Promise<{ available: boolean; hasAudio: boolean; status: string }> {
  const LM = (globalThis as any).LanguageModel;
  if (!LM) {
    return { available: false, hasAudio: false, status: '瀏覽器無 Prompt API' };
  }
  try {
    const avail = await LM.availability();
    if (avail === 'unavailable') {
      return { available: false, hasAudio: false, status: '內建模型不可用' };
    }
    // Try probing session creation capabilities with audio input
    try {
      const session = await LM.create({
        expectedInputs: [{ type: 'text' }, { type: 'audio' }],
      });
      session.destroy?.();
      return { available: true, hasAudio: true, status: 'Chrome 內建多模態 Prompt API（支援語音與文字）' };
    } catch {
      return { available: true, hasAudio: false, status: 'Chrome 內建 Prompt API（支援文字串流）' };
    }
  } catch {
    return { available: false, hasAudio: false, status: '偵測失敗' };
  }
}

/**
 * Attempt to pass recorded audio directly to Google Chrome's multimodal Prompt API.
 * Returns the transcribed/analyzed text if successful, or null to fall back to Web Speech API.
 */
export async function tryPromptApiMultimodalAudio(
  audioBlob: Blob,
  instruction = 'Please transcribe the speaker’s oral argument exactly as spoken.'
): Promise<string | null> {
  const LM = (globalThis as any).LanguageModel;
  if (!LM) return null;
  try {
    const avail = await LM.availability();
    if (avail === 'unavailable') return null;

    const session = await LM.create({
      expectedInputs: [{ type: 'text' }, { type: 'audio' }],
      expectedOutputs: [{ type: 'text' }],
    });

    try {
      if (typeof session.promptStreaming === 'function') {
        const stream = session.promptStreaming([
          { type: 'audio', value: audioBlob },
          { type: 'text', value: instruction },
        ]);
        let out = '';
        for await (const chunk of stream) {
          out += chunk;
        }
        return out.trim() || null;
      } else if (typeof session.prompt === 'function') {
        const res = await session.prompt([
          { type: 'audio', value: audioBlob },
          { type: 'text', value: instruction },
        ]);
        return res ? String(res).trim() : null;
      }
    } finally {
      session.destroy?.();
    }
  } catch (e) {
    console.info('Prompt API multimodal audio direct stream not ready in this browser environment, falling back to Web Speech API.', e);
  }
  return null;
}
