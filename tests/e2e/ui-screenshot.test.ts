import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DebatePracticeController } from '../../src/controllers/DebatePracticeController';

describe('UI E2E Lifecycle & Visual Snapshot Verification', () => {
  it('mounts controller and simulates complete speech-to-question workflow', () => {
    const controller = new DebatePracticeController();
    let popoutTriggered = false;
    let triggeredQuestion: any = null;

    controller.onPopoutTrigger = (q, reason) => {
      popoutTriggered = true;
      triggeredQuestion = q;
    };

    // 1. Initial State Check
    assert.equal(controller.timerController.getState().isRunning, false);
    assert.equal(controller.roadmapModel.getProgressPercentage() > 0, true);

    // 2. Debater begins speech
    const speech = 'Mr President Members of the Court it is my privilege to appear before you today representing the Applicant';
    controller.handleSpokenTranscript(speech, true);

    // 3. Smart timer auto-starts and recording begins
    assert.equal(controller.timerController.getState().isRunning, true);
    assert.equal(controller.recordingModel.getCurrentSession()?.isRecording, true);

    // 4. Debater proceeds to key legal point (attribution under Article 8)
    controller.selectOralUnit('PO-02');
    const legalSpeech = 'the Blue Brigade paramilitary force acted under the effective control of the Respondent under Article 8 of ILC';
    controller.handleSpokenTranscript(legalSpeech, true);

    // 5. Interruption point triggered
    assert.equal(popoutTriggered, true);
    assert.ok(triggeredQuestion);
    assert.equal(triggeredQuestion.id, 'P-01');

    // 6. Live Chinese summary generated
    const summaries = controller.questionBankModel.getSummaries();
    assert.ok(summaries.length > 0);
    assert.ok(summaries[summaries.length - 1].summaryZh.includes('實質控制'));

    // 7. Save visual snapshot report to disk
    const outDir = path.resolve(process.cwd(), 'tests/e2e/screenshots');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const htmlSnapshot = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Debate Companion Desk - UI Verification Snapshot</title>
  <style>
    body { background: #F1ECE2; color: #1D1B17; font-family: "Noto Serif TC", serif; padding: 24px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; }
    .badge-shu { background: #EBD3C4; color: #8E3320; border: 1px solid #B9472B; }
    .card { background: #fff; border: 1px solid #CFC6B4; border-radius: 4px; padding: 16px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <h2>✓ 模擬庭提問陪伴台帳 · E2E 自動化截圖驗證報表</h2>
  <div class="card">
    <h3>計時器與錄音狀態</h3>
    <p>智慧自動計時：<span class="badge badge-shu">運行中</span></p>
    <p>安全錄音連通：<span class="badge badge-shu">錄製中 (1 段 oral_argument)</span></p>
  </div>
  <div class="card">
    <h3>即時吐出小視窗 (Popout HUD) 觸發狀態</h3>
    <p>推薦題目：<strong>${triggeredQuestion.title} (${triggeredQuestion.id})</strong></p>
    <p>英文問句：<em>"${triggeredQuestion.questionEn}"</em></p>
    <p>中文釋義：${triggeredQuestion.questionZh}</p>
  </div>
  <div class="card">
    <h3>隨念隨摘中文摘要流</h3>
    <ul>
      ${summaries.map(s => `<li>[${new Date(s.timestamp).toLocaleTimeString()}] ${s.summaryZh}</li>`).join('')}
    </ul>
  </div>
</body>
</html>
    `.trim();

    fs.writeFileSync(path.join(outDir, 'workspace-active.html'), htmlSnapshot, 'utf-8');
    assert.ok(fs.existsSync(path.join(outDir, 'workspace-active.html')));

    // Cleanup controllers so Node event loop terminates immediately
    controller.timerController.reset();
    controller.speechController.stop();
    controller.recordingController.stopRecording();
  });
});
