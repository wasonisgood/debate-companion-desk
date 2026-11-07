import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DebateModel } from '../../src/models/DebateModel';
import { ArgumentRoadmapModel } from '../../src/models/ArgumentRoadmapModel';

describe('ArgumentRoadmapModel', () => {
  const model = new DebateModel();
  const units = model.getOralUnitsForSide('prosecution', 1);
  const questions = model.getQuestionsForSide('prosecution', 1);

  it('builds roadmap nodes matching oral argument units', () => {
    const roadmap = new ArgumentRoadmapModel(units, questions);
    const nodes = roadmap.getNodes();

    assert.ok(nodes.length > 0);
    assert.equal(nodes[0].status, 'active');
    assert.equal(nodes[0].section, units[0].section);
  });

  it('tracks progression and marks nodes completed upon advance', () => {
    const roadmap = new ArgumentRoadmapModel(units, questions);
    assert.equal(roadmap.getProgressPercentage() > 0, true);

    const next = roadmap.advanceToNextNode();
    assert.ok(next);
    assert.equal(roadmap.getNodes()[0].status, 'completed');
    assert.equal(next?.status, 'active');
  });

  it('marks node interrupted when question intervention occurs', () => {
    const roadmap = new ArgumentRoadmapModel(units, questions);
    roadmap.markNodeInterrupted(units[0].id);
    assert.equal(roadmap.getNodes()[0].status, 'interrupted');
  });
});
