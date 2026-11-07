import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlignmentController } from '../../src/controllers/AlignmentController';
import { DebateModel } from '../../src/models/DebateModel';

describe('AlignmentController', () => {
  const model = new DebateModel();
  const unit = model.getOralUnitsForSide('prosecution', 1)[0];
  const controller = new AlignmentController(unit);

  it('aligns spoken words with oral script and computes progress', () => {
    const speech = 'Mr President Members of the Court it is my privilege to appear before you today';
    const result = controller.alignSpeech(speech);

    assert.equal(result.currentUnitId, unit.id);
    assert.ok(result.matchedWordsCount > 5);
    assert.ok(result.progressPercent > 0);
  });

  it('detects key legal interruption points', () => {
    const attributionUnit = model.getOralUnitsForSide('prosecution', 1)[1];
    const attrController = new AlignmentController(attributionUnit);

    const speech = 'The paramilitary force acted under the effective control of that State';
    const result = attrController.alignSpeech(speech);

    assert.equal(result.isKeyInterruptionPoint, true);
    assert.ok(result.recommendedQuestionId);
  });
});
