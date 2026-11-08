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

  it('detects coach feedback keywords and splits dedicated segment', async () => {
    const model = new RecordingModel();
    const controller = new AudioRecordingController(model);
    await controller.startRecording('prosecution', 1);

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

    // Stop recording: both segments come back finished, with their own sync state
    const items = await controller.stopRecording();
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.segment.type), ['oral_argument', 'coach_feedback']);
    assert.equal(model.getCurrentSession()?.isRecording, false);
  });

  it('releases media recorder and stream references on stopRecording to prevent leaks', async () => {
    const controller = new AudioRecordingController();
    await controller.startRecording('defense', 2);
    const items = await controller.stopRecording();
    assert.ok(Array.isArray(items));
    assert.equal((controller as any).activeStream, null);
    assert.equal((controller as any).mediaRecorder, null);
  });

  it('gives each segment only the audio chunks inside its own time window, keeping the header chunk', async () => {
    const controller = new AudioRecordingController();
    await controller.startRecording('prosecution', 1);
    const now = Date.now();
    const chunk = (t: number, tag: string) => ({ t, blob: new Blob([tag], { type: 'audio/webm' }) });
    (controller as any).chunks = [chunk(now - 60_000, 'H'), chunk(now - 30_000, 'a'), chunk(now - 29_000, 'b'), chunk(now - 1_000, 'c')];
    const audioFor = (start: number, end: number) => (controller as any).audioFor(start, end) as Blob | null;

    // Window covers only chunks a and b; the header H is prepended so the file stays playable.
    const blob = audioFor(now - 30_000, now - 28_000);
    assert.ok(blob);
    assert.equal(await blob!.text(), 'Hab');
    assert.equal(audioFor(now - 100_000, now - 90_000), null);
  });

  it('keeps the segment transcript to the lines spoken inside its window', async () => {
    const controller = new AudioRecordingController();
    await controller.startRecording('prosecution', 1);
    const now = Date.now();
    controller.noteTranscript('first line', now - 20_000);
    controller.noteTranscript('later line', now - 2_000);
    assert.equal((controller as any).transcriptFor(now - 25_000, now - 10_000), 'first line');
  });
});
