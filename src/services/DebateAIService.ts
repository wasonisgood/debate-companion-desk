/**
 * Desktop entry point to the ported debate AI (src/web/lib). Follow-up questions
 * come from Claude when the signed-in account is allowed to use it, otherwise
 * from the rules engine. Nothing here is canned text.
 */
import { initDebateAI, resolveEngine, engineDescription } from '../web/lib/debateAI';
import { initRecords } from '../web/lib/debateRecords';
import { savedCode } from '../web/lib/auth';
import { generateFollowUpQuestion } from '../web/lib/debateJudgeAI';
import { me } from '../web/lib/auth';
import type { BenchQuestion } from '../types';

export interface FollowUpResult {
  followUpEn: string;
  followUpZh: string;
  engine: string;
}

let initialised: Promise<void> | null = null;

/**
 * Activates the website services the desktop uses (Claude judging and record
 * storage) for the current login. Runs once per session, and again with
 * `force` after a new authorization so it picks up the handed-over login.
 */
export function ensureDebateAI(force = false): Promise<void> {
  if (force) initialised = null;
  initialised ??= (async () => {
    let account = null;
    try { account = await me(force); } catch {}
    await initDebateAI(account);
    // Record storage needs the same identity (account or code) as the module.
    initRecords(account, savedCode('debate'), false);
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
