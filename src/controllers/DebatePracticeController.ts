import { DebateModel } from '../models/DebateModel';
import { ArgumentRoadmapModel } from '../models/ArgumentRoadmapModel';
import { QuestionBankModel } from '../models/QuestionBankModel';
import { ContextEngineModel } from '../models/ContextEngineModel';
import { RecordingModel } from '../models/RecordingModel';
import { SettingsModel } from '../models/SettingsModel';
import { AuthModel } from '../models/AuthModel';
import { AITimingJudgeModel } from '../models/AITimingJudgeModel';

import { AlignmentController } from './AlignmentController';
import { TimerController } from './TimerController';
import { AudioRecordingController } from './AudioRecordingController';
import { SpeechRecognitionController } from './SpeechRecognitionController';
import { TTSController } from './TTSController';
import { BridgeController } from './BridgeController';

import type { Side, CounselSeat, BenchQuestion, OralUnit } from '../types';

export class DebatePracticeController {
  public debateModel: DebateModel;
  public roadmapModel: ArgumentRoadmapModel;
  public questionBankModel: QuestionBankModel;
  public contextEngine: ContextEngineModel;
  public recordingModel: RecordingModel;
  public settingsModel: SettingsModel;
  public authModel: AuthModel;
  public aiTimingJudge: AITimingJudgeModel;

  public alignmentController: AlignmentController;
  public timerController: TimerController;
  public recordingController: AudioRecordingController;
  public speechController: SpeechRecognitionController;
  public ttsController: TTSController;
  public bridgeController: BridgeController;

  public onPopoutTrigger?: (q: BenchQuestion, reason: string) => void;
  public onStateChanged?: () => void;

  constructor() {
    this.debateModel = new DebateModel();
    this.settingsModel = new SettingsModel();
    this.authModel = new AuthModel();
    this.recordingModel = new RecordingModel();
    this.aiTimingJudge = new AITimingJudgeModel();

    const side = this.settingsModel.getSettings().targetSide;
    const seat = this.settingsModel.getSettings().targetSeat;

    const units = this.debateModel.getOralUnitsForSide(side, seat);
    const questions = this.debateModel.getQuestionsForSide(side, seat);

    this.roadmapModel = new ArgumentRoadmapModel(units, questions);
    this.questionBankModel = new QuestionBankModel(questions);
    this.contextEngine = new ContextEngineModel(side, seat, this.debateModel.getData().prep);

    this.alignmentController = new AlignmentController(units[0]);
    this.timerController = new TimerController();
    this.recordingController = new AudioRecordingController(this.recordingModel);
    this.speechController = new SpeechRecognitionController();
    this.ttsController = new TTSController();
    this.bridgeController = new BridgeController(this.authModel);

    this.setupOrchestration();
  }

  private setupOrchestration(): void {
    // When debater speaks, process speech recognition stream
    this.speechController.subscribe((transcript, isFinal) => {
      this.handleSpokenTranscript(transcript, isFinal);
    });

    // Recording coach feedback listener
    this.recordingController.setOnSegmentCreated((seg) => {
      if (this.onStateChanged) this.onStateChanged();
    });
  }

  public handleSpokenTranscript(transcript: string, isFinal: boolean): void {
    // 1. Auto-start timer on first speech if smart timer enabled
    if (this.settingsModel.getSettings().enableSmartTimer && !this.timerController.getState().isRunning) {
      this.timerController.start();
      if (this.settingsModel.getSettings().enableAutoRecording) {
        this.recordingController.startRecording(
          this.contextEngine.getSide(),
          this.contextEngine.getSeat()
        );
      }
    }

    // 2. Check for coach feedback transition ("老師講評")
    if (this.settingsModel.getSettings().enableFeedbackSegmentation) {
      const isFeedback = this.recordingController.evaluateFeedbackTriggers(transcript);
      if (isFeedback) {
        // Coach feedback segment isolated
        return;
      }
    }

    // 3. Align with oral script
    const alignResult = this.alignmentController.alignSpeech(transcript);

    // 4. Generate real-time simplified Chinese summary entry
    if (isFinal && this.settingsModel.getSettings().showLiveChineseSummary && alignResult.currentUnitId) {
      this.questionBankModel.addChineseSummary(alignResult.currentUnitId, transcript);
    }

    // 5. Dynamic AI Timing Judgment for Bench Interruption (交由 AI 實時動態裁定最佳提問時機)
    if (this.settingsModel.getSettings().showAIQuestionPrompts) {
      const candidateQuestions = this.debateModel.getQuestionsForSide(
        this.contextEngine.getSide(),
        this.contextEngine.getSeat()
      );

      const decision = this.aiTimingJudge.evaluateInterruptionTiming({
        spokenTranscript: transcript,
        recentSentence: alignResult.activeSentence,
        activeSectionTitle: this.roadmapModel.getActiveNode()?.title || '',
        side: this.contextEngine.getSide(),
        seat: this.contextEngine.getSeat(),
        prepMeta: this.debateModel.getData().prep,
        candidateQuestions,
        sensitivity: this.settingsModel.getSettings().interruptionSensitivity,
        elapsedSeconds: this.timerController.getState().elapsedSeconds
      });

      if (decision.shouldInterrupt && this.onPopoutTrigger) {
        const questionToAsk = decision.recommendedQuestionId
          ? this.debateModel.findQuestionById(decision.recommendedQuestionId)
          : this.questionBankModel.findBestQuestionForText(transcript, this.contextEngine.getSide());

        if (questionToAsk) {
          this.onPopoutTrigger(questionToAsk, decision.rationale);
        }
      }
    }

    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }

  public switchSide(side: Side): void {
    this.settingsModel.updateSetting('targetSide', side);
    this.contextEngine.setSide(side);

    const seat = this.contextEngine.getSeat();
    const units = this.debateModel.getOralUnitsForSide(side, seat);
    const questions = this.debateModel.getQuestionsForSide(side, seat);

    this.roadmapModel.buildFromUnits(units, questions);
    this.questionBankModel.setQuestions(questions);
    if (units.length > 0) {
      this.alignmentController.setActiveUnit(units[0]);
    }

    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }

  public selectOralUnit(unitId: string): void {
    const unit = this.debateModel.findOralUnitById(unitId);
    if (unit) {
      this.alignmentController.setActiveUnit(unit);
      this.roadmapModel.setActiveNode(unitId);
      if (this.onStateChanged) {
        this.onStateChanged();
      }
    }
  }

  public triggerFollowUp(baseQuestion: BenchQuestion, spokenAnswer: string): { followUpEn: string; followUpZh: string } {
    return this.questionBankModel.generateDynamicFollowUp(spokenAnswer, baseQuestion);
  }
}
