import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngineModel } from '../../src/models/ContextEngineModel';
import type { MatchPrep, PrepMeta } from '../../src/types';

const prep: PrepMeta = { team: 'Team 42', facts: 'Armed attack on oil platform', factsName: 'SAF' };
const match = {
  id: 'm1',
  oppTeam: 'D01',
  memorial: { name: 'Respondent', words: 0, notes: {}, importedAt: 0, paras: [
    { n: '1', head: 'Breach of Art 2(4)', text: '' },
    { n: '2', head: 'Art 51 Self-defence', text: '' },
  ] },
  assess: { priorities: ['Attribution under ILC Art 8'], pros: [], cons: [], verify: [] },
} as unknown as MatchPrep;

describe('ContextEngineModel', () => {
  it('builds legal prompt context from the facts, the opponent memorial and our priorities', () => {
    const engine = new ContextEngineModel('prosecution', 1, prep, match);
    const prompt = engine.buildPromptContext('The paramilitary attacked at dawn', 'Opening Submissions');

    assert.ok(prompt.includes('Applicant (正方 / 申請方)'));
    assert.ok(prompt.includes('Breach of Art 2(4)'));
    assert.ok(prompt.includes('Art 51 Self-defence'));
    assert.ok(prompt.includes('Attribution under ILC Art 8'));
    assert.ok(prompt.includes('Armed attack on oil platform'));
    assert.ok(prompt.includes('D01'));
  });

  it('switches to defense party correctly', () => {
    const engine = new ContextEngineModel();
    engine.setSide('defense');

    assert.equal(engine.getSide(), 'defense');
    const prompt = engine.buildPromptContext('We acted under necessity', 'Plea on Merits');
    assert.ok(prompt.includes('Respondent (反方 / 被申請方)'));
  });
});
