import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngineModel } from '../../src/models/ContextEngineModel';

describe('ContextEngineModel', () => {
  it('builds legal prompt context considering party and memorials', () => {
    const engine = new ContextEngineModel('prosecution', 1, {
      factsSummary: 'Armed attack on oil platform',
      applicantMemorialOverview: 'Breach of Art 2(4)',
      respondentMemorialOverview: 'Art 51 Self-defence'
    });

    const prompt = engine.buildPromptContext('The paramilitary attacked at dawn', 'Opening Submissions');

    assert.ok(prompt.includes('Applicant (簡方 / 申請方)'));
    assert.ok(prompt.includes('Breach of Art 2(4)'));
    assert.ok(prompt.includes('Art 51 Self-defence'));
    assert.ok(prompt.includes('Armed attack on oil platform'));
  });

  it('switches to defense party correctly', () => {
    const engine = new ContextEngineModel();
    engine.setSide('defense');

    assert.equal(engine.getSide(), 'defense');
    const prompt = engine.buildPromptContext('We acted under necessity', 'Plea on Merits');
    assert.ok(prompt.includes('Respondent (扁方 / 被申請方)'));
  });
});
