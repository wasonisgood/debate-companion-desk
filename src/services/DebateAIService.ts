/**
 * Desktop entry point to the ported debate AI (src/web/lib). Follow-up questions
 * come from Claude when the signed-in account is allowed to use it, otherwise
 * from the rules engine. Nothing here is canned text.
 */
import { initDebateAI, resolveEngine, engineDescription } from '../web/lib/debateAI';
import { generateFollowUpQuestion } from '../web/lib/debateJudgeAI';
import { me } from '../web/lib/auth';
import type { BenchQuestion } from '../types';

export interface FollowUpResult {
  followUpEn: string;
  followUpZh: string;
  engine: string;
}

let initialised: Promise<void> | null = null;

/** Loads the AI configuration once per app session. Safe to call repeatedly. */
export function ensureDebateAI(): Promise<void> {
  initialised ??= (async () => {
    let account = null;
    try { account = await me(); } catch {}
    await initDebateAI(account);
  })();
  return initialised;
}

export async function followUpFor(question: BenchQuestion, debaterAnswer: string, signal?: AbortSignal): Promise<FollowUpResult> {
  await ensureDebateAI();
  const en = await generateFollowUpQuestion(question as any, debaterAnswer, signal);
  const zh = question.followUpZh?.trim() || question.questionZh?.trim() || '';
  return {
    followUpEn: en,
    followUpZh: zh,
    engine: engineDescription(resolveEngine(), 'followup'),
  };
}
