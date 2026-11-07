import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TimerController } from '../../src/controllers/TimerController';

describe('TimerController', () => {
  it('initializes with default moot court timing', () => {
    const timer = new TimerController({ totalSeconds: 900, warningSeconds: 120 });
    const state = timer.getState();

    assert.equal(state.totalSeconds, 900);
    assert.equal(state.remainingSeconds, 900);
    assert.equal(state.isRunning, false);
  });

  it('triggers warning bell at warning threshold', () => {
    const timer = new TimerController({ totalSeconds: 10, warningSeconds: 3 });
    let rings = 0;
    timer.ringBell = (count = 1) => { rings += count; };

    // Advance 7 seconds (10 - 7 = 3 seconds remaining)
    for (let i = 0; i < 7; i++) {
      timer.tick();
    }

    assert.equal(timer.getState().remainingSeconds, 3);
    assert.equal(timer.getState().isWarningFired, true);
    assert.equal(rings, 1);
  });

  it('triggers finish bell at 0 seconds remaining', () => {
    const timer = new TimerController({ totalSeconds: 5, warningSeconds: 2 });
    let rings = 0;
    timer.ringBell = (count = 1) => { rings += count; };

    for (let i = 0; i < 5; i++) {
      timer.tick();
    }

    assert.equal(timer.getState().remainingSeconds, 0);
    assert.equal(timer.getState().isFinishedFired, true);
    assert.ok(rings >= 2);
  });
});
