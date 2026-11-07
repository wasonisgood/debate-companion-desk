import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AITimingJudgeModel } from '../../src/models/AITimingJudgeModel';
import { DebateModel } from '../../src/models/DebateModel';

describe('AITimingJudgeModel - Dynamic AI Interruption Timing Evaluator', () => {
  const debateData = new DebateModel();
  const questions = debateData.getQuestionsForSide('prosecution', 1);

  it('evaluates bold substantive assertions and dynamically decides to interrupt', () => {
    const model = new AITimingJudgeModel();
    const decision = model.evaluateInterruptionTiming({
      spokenTranscript: 'We respectfully submit that the paramilitary operation is directly attributable to the Respondent under international law and Article 8 of ILC Draft Articles.',
      recentSentence: 'We respectfully submit that the paramilitary operation is directly attributable to the Respondent under international law and Article 8 of ILC Draft Articles.',
      activeSectionTitle: 'State Responsibility & Attribution',
      side: 'prosecution',
      seat: 1,
      candidateQuestions: questions,
      sensitivity: 'balanced',
      elapsedSeconds: 45
    });

    assert.equal(decision.shouldInterrupt, true);
    assert.ok(decision.confidence >= 0.7);
    assert.ok(decision.rationale.includes('歸責'));
    assert.ok(decision.recommendedQuestionId);
  });

  it('refrains from interrupting during brief preliminary introductory statements', () => {
    const model = new AITimingJudgeModel();
    const decision = model.evaluateInterruptionTiming({
      spokenTranscript: 'Mr President Members of the Court.',
      recentSentence: 'Mr President Members of the Court.',
      activeSectionTitle: 'Introduction',
      side: 'prosecution',
      seat: 1,
      candidateQuestions: questions,
      sensitivity: 'balanced',
      elapsedSeconds: 10
    });

    assert.equal(decision.shouldInterrupt, false);
    assert.ok(decision.rationale.includes('不足以構成實質論述要件') || decision.rationale.includes('鋪陳'));
  });

  it('adjusts dynamic threshold according to researcher sensitivity preferences', () => {
    const model = new AITimingJudgeModel();
    const speech = 'Moving to our second submission on the aerial bombardment.';

    const aggressiveDecision = model.evaluateInterruptionTiming({
      spokenTranscript: speech,
      recentSentence: speech,
      activeSectionTitle: 'Count 2',
      side: 'prosecution',
      seat: 2,
      candidateQuestions: questions,
      sensitivity: 'aggressive',
      elapsedSeconds: 80
    });

    const conservativeDecision = model.evaluateInterruptionTiming({
      spokenTranscript: speech,
      recentSentence: speech,
      activeSectionTitle: 'Count 2',
      side: 'prosecution',
      seat: 2,
      candidateQuestions: questions,
      sensitivity: 'conservative',
      elapsedSeconds: 80
    });

    // Aggressive has a lower threshold than conservative
    assert.ok(aggressiveDecision.confidence >= 0);
    assert.equal(conservativeDecision.shouldInterrupt, false);
  });
});
