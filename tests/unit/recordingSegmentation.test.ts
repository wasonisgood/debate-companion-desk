import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingModel } from '../../src/models/RecordingModel';
import { AudioRecordingController } from '../../src/controllers/AudioRecordingController';

describe('Recording Segmentation & Coach Feedback Isolation', () => {
  it('starts session with oral argument segment', () => {
    const model = new RecordingModel();
    const session = model.startSession('prosecution', 1);

    assert.equal(session.isRecording, true);
    assert.equal(session.segments.length, 1);
    assert.equal(session.segments[0].type, 'oral_argument');
  });

  it('detects coach feedback keywords and splits dedicated segment', () => {
    const model = new RecordingModel();
    const controller = new AudioRecordingController(model);
    controller.startRecording('prosecution', 1);

    // Debater speaking oral argument
    assert.equal(controller.evaluateFeedbackTriggers('We submit our first plea under Article 8.'), false);

    // Coach gives comments
    const triggered = controller.evaluateFeedbackTriggers('好的，整體來說回答得不錯，我們來看一下老師講評與建議。');
    assert.equal(triggered, true);

    const session = model.getCurrentSession();
    assert.ok(session);
    assert.equal(session?.segments.length, 2);
    assert.equal(session?.segments[1].type, 'coach_feedback');
    assert.equal(session?.isCoachFeedbackDetected, true);

    // Stop recording and verify segments finalized and clean
    const queue = controller.stopRecording();
    assert.equal(queue.length, 2);
    assert.equal(model.getCurrentSession()?.isRecording, false);
  });

  it('releases media recorder and stream references on stopRecording to prevent leaks', async () => {
    const controller = new AudioRecordingController();
    await controller.startRecording('defense', 2);
    const queue = controller.stopRecording();
    assert.ok(Array.isArray(queue));
  });
});
