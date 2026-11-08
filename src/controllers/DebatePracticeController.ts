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

import type { Side, CounselSeat, BenchQuestion, OralUnit, AuthSession } from '../types';
import { followUpFor, type FollowUpResult } from '../services/DebateAIService';
import { fetchDebateBank } from '../web/lib/debateStorage';
import { syncFinishedSegments, type SyncSummary } from '../services/RecordingSync';

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

  /** The debater's latest finished answer, used as the basis for a follow-up. */
  public lastFinalAnswer: string = '';

  public onPopoutTrigger?: (q: BenchQuestion, reason: string) => void;
  public onStateChanged?: () => void;
  public onAuthGranted?: (session: AuthSession) => void;

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
    this.bridgeController.setOnAuthSuccess((session) => {
      if (this.onAuthGranted) {
        this.onAuthGranted(session);
      }
      // Fetch the shared bank once the website session is active (no UI wait).
      void this.bridgeController.sessionReady.then(() => this.refreshBank()).catch(() => {});
    });

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

    if (isFinal) this.recordingController.noteTranscript(transcript);

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
    if (isFinal) this.lastFinalAnswer = transcript;
    const currentUnit = alignResult.currentUnitId ? this.debateModel.findOralUnitById(alignResult.currentUnitId) : undefined;
    if (isFinal && this.settingsModel.getSettings().showLiveChineseSummary && currentUnit) {
      this.questionBankModel.addChineseSummary(currentUnit, transcript);
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

  /**
   * 即時追問: builds the follow-up from what the debater actually said (Claude when
   * available, rules engine otherwise). Returns null when there is no answer yet.
   */
  private finishing: Promise<SyncSummary | null> | null = null;
  /** Practice round counter shown in uploaded records (第 n 回合). */
  public roundNumber = 1;

  /** Start the next practice round: the next recording and records count from here. */
  public startNewRound(): void {
    this.roundNumber += 1;
  }

  /**
   * Ends the current recording (round end, timer finished, or new round), uploads
   * each segment with its audio, and returns the sync summary. Safe to call twice:
   * concurrent calls share one run.
   */
  public finishRecording(): Promise<SyncSummary | null> {
    if (this.finishing) return this.finishing;
    if (!this.recordingController.isRecording()) return Promise.resolve(null);
    const session = this.recordingModel.getCurrentSession();
    const sessionId = session?.id ?? '';
    const matchId = session?.matchId;
    const side = session?.side ?? this.contextEngine.getSide();
    const roundNo = this.roundNumber;
    const sideLabel = side === 'prosecution' ? '控方' : '辯方';
    this.finishing = (async () => {
      try {
        const items = await this.recordingController.stopRecording();
        if (!items.length) return null;
        return await syncFinishedSegments(items, {
          side,
          roundTitle: `${sideLabel} · 第 ${roundNo} 回合`,
          sessionId,
          matchId,
        });
      } finally {
        this.finishing = null;
      }
    })();
    return this.finishing;
  }

  /**
   * Pull the shared bank through the website storage (same login and code rules).
   * Returns true when a bank was loaded.
   */
  public async refreshBank(): Promise<boolean> {
    try {
      const bank = await fetchDebateBank(this.authModel.getDebateCode());
      if (!bank?.data) return false;
      this.debateModel.replaceFromBank(bank.data);
      this.switchSide(this.settingsModel.getSettings().targetSide);
      return true;
    } catch (e) {
      console.warn('Shared debate bank could not be loaded', e);
      return false;
    }
  }

  public async triggerFollowUp(baseQuestion: BenchQuestion, spokenAnswer: string = this.lastFinalAnswer): Promise<FollowUpResult | null> {
    const answer = spokenAnswer.trim();
    if (!answer) return null;
    return followUpFor(baseQuestion, answer);
  }
}
