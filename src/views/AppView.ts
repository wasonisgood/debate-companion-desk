import { DebatePracticeController } from '../controllers/DebatePracticeController';
import { CustomTitleBarView } from './CustomTitleBarView';
import { RoadmapView } from './RoadmapView';
import { ScriptAlignmentView } from './ScriptAlignmentView';
import { QuestionPrompterView } from './QuestionPrompterView';
import { PopoutHudView } from './PopoutHudView';
import { FloatingBallView } from './FloatingBallView';
import { TTSDrillModalView } from './TTSDrillModalView';
import { SettingsView } from './SettingsView';
import { TouchGestureManager } from './TouchGestureManager';
import type { BenchQuestion } from '../types';

export class AppView {
  private root: HTMLElement;
  private controller: DebatePracticeController;

  private titleBarView!: CustomTitleBarView;
  private roadmapView!: RoadmapView;
  private scriptAlignmentView!: ScriptAlignmentView;
  private questionPrompterView!: QuestionPrompterView;
  private popoutHudView!: PopoutHudView;
  private floatingBallView!: FloatingBallView;
  private ttsDrillModalView!: TTSDrillModalView;
  private settingsView!: SettingsView;
  private touchGestureManager!: TouchGestureManager;

  private isFloatingMode: boolean = false;

  constructor(root: HTMLElement, controller: DebatePracticeController) {
    this.root = root;
    this.controller = controller;
    this.initViews();
    this.bindControllerEvents();
  }

  private initViews(): void {
    this.root.innerHTML = `
      <div id="titlebar-container"></div>
      <div id="workspace-container" class="workspace-container">
        <div id="roadmap-container"></div>
        <div id="script-container"></div>
        <div id="prompter-container"></div>
      </div>
      <div id="floating-ball-container"></div>
      <div id="popout-hud-wrapper"></div>
      <div id="tts-drill-modal-container" style="display: none;"></div>
      <div id="settings-view-container" style="display: none;"></div>
      <div id="touch-radial-ring"></div>
    `;

    // 1. TitleBar
    const titleBarEl = this.root.querySelector('#titlebar-container') as HTMLElement;
    this.titleBarView = new CustomTitleBarView(titleBarEl, {
      onMinimize: () => this.handleMinimize(),
      onMaximize: () => this.handleMaximize(),
      onClose: () => this.handleClose(),
      onToggleFloatMode: () => this.toggleFloatMode(),
      onOpenSettings: () => this.settingsView.open(),
      onSwitchSide: (side) => this.controller.switchSide(side),
      onStartSimulation: () => this.startSpeechSimulation()
    });

    // 2. Roadmap
    const roadmapEl = this.root.querySelector('#roadmap-container') as HTMLElement;
    this.roadmapView = new RoadmapView(roadmapEl, this.controller.roadmapModel, {
      onSelectNode: (nodeId) => this.controller.selectOralUnit(nodeId)
    });

    // 3. Script Tracker & Summary
    const scriptEl = this.root.querySelector('#script-container') as HTMLElement;
    this.scriptAlignmentView = new ScriptAlignmentView(scriptEl, {
      onInterruptionTriggerClick: () => {}
    });
    const currentUnit = this.controller.debateModel.findOralUnitById(
      this.controller.roadmapModel.getActiveNode()?.id || ''
    );
    this.scriptAlignmentView.setUnit(currentUnit || null);

    // 4. Question Prompter
    const prompterEl = this.root.querySelector('#prompter-container') as HTMLElement;
    const questions = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
    this.questionPrompterView = new QuestionPrompterView(prompterEl, {
      onPracticeTTS: (text) => this.ttsDrillModalView.open(text),
      onGenerateFollowUp: (q) => this.handleFollowUp(q),
      onSelectAlternativeQuestion: (qid) => {}
    });
    this.questionPrompterView.setQuestions(questions);

    // 5. Popout HUD
    const hudEl = this.root.querySelector('#popout-hud-wrapper') as HTMLElement;
    this.popoutHudView = new PopoutHudView(hudEl, {
      onPracticeTTS: (text) => this.ttsDrillModalView.open(text),
      onAskNow: (q) => this.handleAskDebater(q),
      onGenerateFollowUp: (q) => this.handleFollowUp(q),
      onDismiss: () => {}
    }, this.controller.settingsModel.getSettings().autoHidePopoutSec);

    // 6. Floating Ball
    const fbEl = this.root.querySelector('#floating-ball-container') as HTMLElement;
    this.floatingBallView = new FloatingBallView(fbEl, {
      onExpandWindow: () => this.toggleFloatMode(false),
      onToggleTimer: () => {
        const timer = this.controller.timerController;
        if (timer.getState().isRunning) {
          timer.pause();
        } else {
          timer.start();
        }
      },
      onTagCoachFeedback: () => {
        this.controller.recordingModel.detectAndSplitCoachFeedback();
        this.titleBarView.setSyncStatus('☁ 老師講評段落已獨立切割備份', true);
      },
      onOpenSettings: () => this.settingsView.open(),
      onTriggerRandomQuestion: () => {
        const q = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide())[0];
        if (q) this.popoutHudView.show(q, '手動快捷即時提問');
      }
    });

    // 7. TTS Drill Modal
    const ttsModalEl = this.root.querySelector('#tts-drill-modal-container') as HTMLElement;
    this.ttsDrillModalView = new TTSDrillModalView(ttsModalEl, this.controller.ttsController, {
      onConfirmAsk: (text) => this.handleAskDebater({ questionEn: text } as BenchQuestion),
      onClose: () => {}
    });

    // 8. Settings View
    const settingsEl = this.root.querySelector('#settings-view-container') as HTMLElement;
    this.settingsView = new SettingsView(settingsEl, this.controller.settingsModel, {
      onSettingsSaved: () => this.applyDisplaySettings(),
      onClose: () => {}
    });

    // 9. Surface Touch Gestures
    this.touchGestureManager = new TouchGestureManager(this.root, {
      onSwipeLeft: () => {
        // Next roadmap node
        const next = this.controller.roadmapModel.advanceToNextNode();
        if (next) this.controller.selectOralUnit(next.id);
      },
      onSwipeRight: () => {
        // Toggle side
        const currentSide = this.controller.contextEngine.getSide();
        this.controller.switchSide(currentSide === 'prosecution' ? 'defense' : 'prosecution');
      },
      onSwipeDown: () => {
        this.popoutHudView.hide();
      },
      onLongPress: (x, y) => {
        this.triggerRadialRing(x, y);
      }
    });

    this.applyDisplaySettings();
  }

  private bindControllerEvents(): void {
    // Timer subscription
    this.controller.timerController.subscribe((timerState) => {
      this.titleBarView.updateTimerDisplay(timerState.remainingSeconds, timerState.isRunning);
      this.floatingBallView.updateState(
        timerState.remainingSeconds,
        this.controller.recordingModel.getCurrentSession()?.isRecording || false,
        true
      );
    });

    // Popout question trigger
    this.controller.onPopoutTrigger = (q, reason) => {
      this.popoutHudView.show(q, reason);
      this.floatingBallView.triggerAlert();
    };

    // State change callback
    this.controller.onStateChanged = () => {
      this.roadmapView.setModel(this.controller.roadmapModel);
      const activeNode = this.controller.roadmapModel.getActiveNode();
      if (activeNode) {
        const u = this.controller.debateModel.findOralUnitById(activeNode.id);
        this.scriptAlignmentView.setUnit(u || null);
      }
      this.titleBarView.setRecording(
        this.controller.recordingModel.getCurrentSession()?.isRecording || false
      );
    };
  }

  public applyDisplaySettings(): void {
    const s = this.controller.settingsModel.getSettings();
    const roadmapEl = this.root.querySelector('#roadmap-container') as HTMLElement;
    const scriptEl = this.root.querySelector('#script-container') as HTMLElement;
    const prompterEl = this.root.querySelector('#prompter-container') as HTMLElement;

    if (roadmapEl) roadmapEl.style.display = s.showRoadmap ? 'flex' : 'none';
    if (scriptEl) scriptEl.style.display = s.showScriptTracker ? 'flex' : 'none';
    if (prompterEl) prompterEl.style.display = s.showAIQuestionPrompts ? 'flex' : 'none';
  }

  public toggleFloatMode(force?: boolean): void {
    this.isFloatingMode = force !== undefined ? force : !this.isFloatingMode;
    const ws = this.root.querySelector('#workspace-container') as HTMLElement;
    const fb = this.root.querySelector('#floating-ball-widget') as HTMLElement;

    if (this.isFloatingMode) {
      if (ws) ws.style.display = 'none';
      if (fb) fb.style.display = 'flex';
      // Signal Electron to shrink window
      const electronAPI = (window as any).electronAPI;
      if (electronAPI && electronAPI.setFloatingWindow) {
        electronAPI.setFloatingWindow(true);
      }
    } else {
      if (ws) ws.style.display = 'grid';
      // Signal Electron to restore full window
      const electronAPI = (window as any).electronAPI;
      if (electronAPI && electronAPI.setFloatingWindow) {
        electronAPI.setFloatingWindow(false);
      }
    }
  }

  private handleMinimize(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.minimize) {
      electronAPI.minimize();
    }
  }

  private handleMaximize(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.maximize) {
      electronAPI.maximize();
    }
  }

  private handleClose(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.close) {
      electronAPI.close();
    }
  }

  private handleAskDebater(q: BenchQuestion): void {
    this.controller.roadmapModel.markNodeInterrupted(
      this.controller.roadmapModel.getActiveNode()?.id || ''
    );
    this.roadmapView.render();
  }

  private handleFollowUp(q: BenchQuestion): void {
    const followUp = this.controller.triggerFollowUp(q, 'We argue that under Nicaragua effective control is satisfied.');
    alert(`[AI 即時追問建議]\n英文：${followUp.followUpEn}\n中文：${followUp.followUpZh}`);
  }

  public startSpeechSimulation(): void {
    const activeNode = this.controller.roadmapModel.getActiveNode();
    const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || 'PO-01');
    if (!unit) return;

    this.controller.speechController.simulateDebateSpeech(unit.textEn, 250, () => {
      this.titleBarView.setSyncStatus('☁ 模擬朗讀完成，紀錄已同步', true);
    });
  }

  private triggerRadialRing(x: number, y: number): void {
    const ring = this.root.querySelector('#touch-radial-ring') as HTMLElement;
    if (!ring) return;

    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.add('active');

    ring.innerHTML = `
      <div class="radial-sector" style="top: 15%; left: 50%;" id="rad-tts">🔊 朗讀</div>
      <div class="radial-sector" style="top: 50%; left: 85%;" id="rad-ask">⚡ 提問</div>
      <div class="radial-sector" style="top: 85%; left: 50%;" id="rad-timer">⏱ 計時</div>
      <div class="radial-sector" style="top: 50%; left: 15%;" id="rad-coach">🎙 講評</div>
    `;

    const closeRing = () => {
      ring.classList.remove('active');
      document.removeEventListener('click', closeRing);
    };

    setTimeout(() => {
      document.addEventListener('click', closeRing, { once: true });
    }, 100);

    ring.querySelector('#rad-tts')?.addEventListener('click', () => {
      const q = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide())[0];
      if (q) this.ttsDrillModalView.open(q.questionEn);
    });

    ring.querySelector('#rad-ask')?.addEventListener('click', () => {
      const q = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide())[0];
      if (q) this.popoutHudView.show(q, '觸控環快速提問');
    });

    ring.querySelector('#rad-coach')?.addEventListener('click', () => {
      this.controller.recordingModel.detectAndSplitCoachFeedback();
      this.titleBarView.setSyncStatus('☁ 老師講評段落已獨立切割備份', true);
    });
  }
}
