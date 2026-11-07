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

  it('extracts active sentence accurately from oral script', () => {
    const attributionUnit = model.getOralUnitsForSide('prosecution', 1)[1];
    const attrController = new AlignmentController(attributionUnit);

    const speech = 'Turning to our first submission the actions of the Blue Brigade paramilitary force';
    const result = attrController.alignSpeech(speech);

    assert.ok(result.activeSentence.length > 0);
    assert.ok(result.activeSentence.includes('Turning to our first submission'));
  });
});
