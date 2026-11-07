import { DebatePracticeController } from '../controllers/DebatePracticeController';
import { CustomTitleBarView } from './CustomTitleBarView';
import { RoadmapView } from './RoadmapView';
import { ScriptAlignmentView } from './ScriptAlignmentView';
import { QuestionPrompterView } from './QuestionPrompterView';
import { PopoutHudView } from './PopoutHudView';
import { FloatingBallView } from './FloatingBallView';
import { FloatingMiniHudView } from './FloatingMiniHudView';
import { TTSDrillModalView } from './TTSDrillModalView';
import { SettingsView } from './SettingsView';
import { AuthVerificationModalView } from './AuthVerificationModalView';
import { UpdateModalView } from './UpdateModalView';
import { TouchGestureManager } from './TouchGestureManager';
import { SupabaseService } from '../services/SupabaseService';
import type { BenchQuestion, OralUnit } from '../types';

export class AppView {
  private root: HTMLElement;
  private controller: DebatePracticeController;

  private titleBarView!: CustomTitleBarView;
  private roadmapView!: RoadmapView;
  private scriptAlignmentView!: ScriptAlignmentView;
  private questionPrompterView!: QuestionPrompterView;
  private popoutHudView!: PopoutHudView;
  private floatingBallView!: FloatingBallView;
  private floatingMiniHudView!: FloatingMiniHudView;
  private ttsDrillModalView!: TTSDrillModalView;
  private settingsView!: SettingsView;
  private authVerificationModalView!: AuthVerificationModalView;
  private updateModalView!: UpdateModalView;
  private touchGestureManager!: TouchGestureManager;

  private isFloatingMode: boolean = false;

  constructor(root: HTMLElement, controller: DebatePracticeController) {
    this.root = root;
    this.controller = controller;
    this.initViews();
    this.bindControllerEvents();
    this.checkInitialAuthAndUpdates();
  }

  private initViews(): void {
    this.root.innerHTML = `
      <div id="titlebar-container"></div>
      <div id="workspace-container" class="workspace-container">
        <div id="roadmap-container"></div>
        <div id="script-container"></div>
        <div id="prompter-container"></div>
      </div>
      <div id="floating-mini-hud-container"></div>
      <div id="floating-ball-container"></div>
      <div id="popout-hud-wrapper"></div>
      <div id="tts-drill-modal-container" style="display: none;"></div>
      <div id="settings-view-container" style="display: none;"></div>
      <div id="auth-verification-modal-container" style="display: none;"></div>
      <div id="update-modal-container" style="display: none;"></div>
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
      onOpenAuth: () => this.authVerificationModalView.show(),
      onCheckUpdates: () => this.handleCheckUpdates(),
      onTTSDrill: () => this.openTTSDrill(),
      onManualCoachFeedback: () => this.handleTagCoachFeedback(),
      onSwitchSide: (side) => this.controller.switchSide(side),
      onStartSimulation: () => this.startSpeechSimulation(),
      onExportRecord: () => this.handleExportRecord(),
      onNewRound: () => this.handleNewRound()
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
      onSelectAlternativeQuestion: (_qid) => {}
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
      onToggleTimer: () => this.toggleTimer(),
      onTagCoachFeedback: () => this.handleTagCoachFeedback(),
      onOpenSettings: () => this.settingsView.open(),
      onOpenTTSDrill: () => this.openTTSDrill(),
      onTriggerRandomQuestion: () => {
        const q = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide())[0];
        if (q) this.popoutHudView.show(q, '快捷即時提問');
      }
    });

    // 7. Floating Mini HUD (Compact Window Mode)
    const miniHudEl = this.root.querySelector('#floating-mini-hud-container') as HTMLElement;
    this.floatingMiniHudView = new FloatingMiniHudView(miniHudEl, {
      onExpand: () => this.toggleFloatMode(false),
      onMinimize: () => this.handleMinimize(),
      onClose: () => this.handleClose(),
      onToggleTimer: () => this.toggleTimer(),
      onTagFeedback: () => this.handleTagCoachFeedback(),
      onTTSDrill: (text) => this.openTTSDrill(text),
      onNextQuestion: () => {
        const qList = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
        const randomQ = qList[Math.floor(Math.random() * qList.length)];
        if (randomQ) {
          const activeNode = this.controller.roadmapModel.getActiveNode();
          const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || '');
          this.floatingMiniHudView.setData(unit || null, randomQ);
        }
      }
    });

    // 8. TTS Drill Modal
    const ttsModalEl = this.root.querySelector('#tts-drill-modal-container') as HTMLElement;
    this.ttsDrillModalView = new TTSDrillModalView(ttsModalEl, this.controller.ttsController, {
      onConfirmAsk: (text) => this.handleAskDebater({ questionEn: text } as BenchQuestion),
      onClose: () => {}
    });

    // 9. Settings View
    const settingsEl = this.root.querySelector('#settings-view-container') as HTMLElement;
    this.settingsView = new SettingsView(settingsEl, this.controller.settingsModel, {
      onSettingsSaved: () => this.applyDisplaySettings(),
      onClose: () => {},
      onCheckUpdates: () => this.handleCheckUpdates(),
      onOpenAuth: () => this.authVerificationModalView.show()
    });

    // 10. Auth Verification Modal
    const authModalEl = this.root.querySelector('#auth-verification-modal-container') as HTMLElement;
    this.authVerificationModalView = new AuthVerificationModalView(
      authModalEl,
      this.controller.authModel,
      {
        onAuthenticated: () => {
          this.titleBarView.setSyncStatus('網站授權成功，正在同步辯論庫', true);
          this.syncCloudDebateBank();
        },
        onDismissOffline: () => {
          this.titleBarView.setSyncStatus('離線訪客演練模式', false);
        }
      }
    );

    // 11. Update Modal View
    const updateModalEl = this.root.querySelector('#update-modal-container') as HTMLElement;
    this.updateModalView = new UpdateModalView(updateModalEl);

    // 12. Surface Touch Gestures
    this.touchGestureManager = new TouchGestureManager(this.root, {
      onSwipeLeft: () => {
        const next = this.controller.roadmapModel.advanceToNextNode();
        if (next) this.controller.selectOralUnit(next.id);
      },
      onSwipeRight: () => {
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

  private checkInitialAuthAndUpdates(): void {
    // 1. Check if user is authenticated or holds a debate code
    if (!this.controller.authModel.isAuthenticated()) {
      setTimeout(() => {
        this.authVerificationModalView.show();
      }, 500);
    } else {
      this.syncCloudDebateBank();
    }
  }

  private async syncCloudDebateBank(): Promise<void> {
    try {
      const bank = await SupabaseService.getInstance().loadDebateBank();
      if (bank && bank.data) {
        this.controller.debateModel.updateData(bank.data);
        const questions = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
        this.questionPrompterView.setQuestions(questions);
        const activeNode = this.controller.roadmapModel.getActiveNode();
        const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || '');
        this.scriptAlignmentView.setUnit(unit || null);
        this.titleBarView.setSyncStatus('雲端資料庫已同步最新爭點', true);
      }
    } catch (e) {
      console.warn('Sync cloud debate bank note:', e);
    }
  }

  public openTTSDrill(text?: string): void {
    if (text && text.trim().length > 0) {
      this.ttsDrillModalView.open(text);
      return;
    }

    // Default to active question or oral unit
    const questions = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
    const candidateText = questions[0]?.questionEn ||
      this.controller.debateModel.findOralUnitById(this.controller.roadmapModel.getActiveNode()?.id || '')?.textEn ||
      'Mr. President, Members of the Court, may it please the Court.';

    this.ttsDrillModalView.open(candidateText);
  }

  public handleTagCoachFeedback(): void {
    const seg = this.controller.recordingModel.detectAndSplitCoachFeedback();
    this.titleBarView.setSyncStatus('老師講評段落已獨立切割備份', true);
    this.floatingBallView.triggerAlert();

    const toast = document.createElement('div');
    toast.className = 'card';
    toast.style.cssText = 'position: fixed; top: 48px; right: 24px; z-index: 10006; background: var(--paper); border-left: 4px solid var(--shu); padding: 0.8rem 1.2rem; box-shadow: var(--shadow-lg); font-size: 0.88rem; animation: popIn 0.2s ease;';
    toast.innerHTML = `<strong>老師講評段落標註成功</strong><div style="font-size: 0.78rem; color: var(--ink-2); margin-top: 0.2rem;">系統已獨立隔離語音與文字紀錄並準備雲端備份。</div>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3200);
  }

  private toggleTimer(): void {
    const timer = this.controller.timerController;
    if (timer.getState().isRunning) {
      timer.pause();
    } else {
      timer.start();
    }
  }

  public async handleCheckUpdates(): Promise<void> {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.checkForUpdates) {
      const res = await electronAPI.checkForUpdates();
      this.updateModalView.show(res);
    } else {
      this.updateModalView.show({
        hasUpdate: false,
        currentVersion: '1.0.0',
        message: '目前已是最新版本 (v1.0.0)。'
      });
    }
  }

  private handleNewRound(): void {
    this.controller.timerController.reset();
    this.controller.recordingModel.startSession(this.controller.contextEngine.getSide(), this.controller.contextEngine.getSeat());
    this.titleBarView.setSyncStatus('新練習回合已建立', true);
  }

  private handleExportRecord(): void {
    const session = this.controller.recordingModel.getCurrentSession();
    if (!session) {
      alert('今日尚無錄音或練習紀錄可供匯出。');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(session, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `debate_practice_${Date.now()}.json`);
    dlAnchor.click();
    dlAnchor.remove();
  }

  private bindControllerEvents(): void {
    // Timer subscription
    this.controller.timerController.subscribe((timerState) => {
      const isRec = this.controller.recordingModel.getCurrentSession()?.isRecording || false;
      this.titleBarView.updateTimerDisplay(timerState.remainingSeconds, timerState.isRunning);
      this.floatingBallView.updateState(timerState.remainingSeconds, isRec, true);
      this.floatingMiniHudView.updateTimer(timerState.remainingSeconds, timerState.isRunning, isRec);
    });

    // Popout question trigger
    this.controller.onPopoutTrigger = (q, reason) => {
      this.popoutHudView.show(q, reason);
      this.floatingBallView.triggerAlert();
      const activeNode = this.controller.roadmapModel.getActiveNode();
      const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || '');
      this.floatingMiniHudView.setData(unit || null, q);
    };

    // State change callback
    this.controller.onStateChanged = () => {
      this.roadmapView.setModel(this.controller.roadmapModel);
      const activeNode = this.controller.roadmapModel.getActiveNode();
      const u = activeNode ? this.controller.debateModel.findOralUnitById(activeNode.id) : null;
      this.scriptAlignmentView.setUnit(u || null);

      const questions = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
      this.questionPrompterView.setQuestions(questions);

      this.floatingMiniHudView.setData(u || null, questions[0] || null);
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

    if (this.isFloatingMode) {
      this.root.classList.add('floating-mode');
      const activeNode = this.controller.roadmapModel.getActiveNode();
      const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || '');
      const questions = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide());
      this.floatingMiniHudView.setData(unit || null, questions[0] || null);

      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.setFloatingWindow) {
        electronAPI.setFloatingWindow(true);
      }
    } else {
      this.root.classList.remove('floating-mode');
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.setFloatingWindow) {
        electronAPI.setFloatingWindow(false);
      }
    }
  }

  private handleMinimize(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.minimize) {
      electronAPI.minimize();
    }
  }

  private handleMaximize(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.maximize) {
      electronAPI.maximize();
    }
  }

  private handleClose(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.close) {
      electronAPI.close();
    }
  }

  private handleAskDebater(_q: BenchQuestion): void {
    this.controller.roadmapModel.markNodeInterrupted(
      this.controller.roadmapModel.getActiveNode()?.id || ''
    );
    this.roadmapView.render();
  }

  private handleFollowUp(q: BenchQuestion): void {
    const followUp = this.controller.triggerFollowUp(q, 'We argue that under Nicaragua effective control is satisfied.');
    alert(`[即時追問建議]\n英文：${followUp.followUpEn}\n中文：${followUp.followUpZh}`);
  }

  public startSpeechSimulation(): void {
    const activeNode = this.controller.roadmapModel.getActiveNode();
    const unit = this.controller.debateModel.findOralUnitById(activeNode?.id || 'PO-01');
    if (!unit) return;

    this.controller.speechController.simulateDebateSpeech(unit.textEn, 250, () => {
      this.titleBarView.setSyncStatus('模擬朗讀完成，紀錄已同步', true);
    });
  }

  private triggerRadialRing(x: number, y: number): void {
    const ring = this.root.querySelector('#touch-radial-ring') as HTMLElement;
    if (!ring) return;

    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.add('active');

    ring.innerHTML = `
      <div class="radial-sector" style="top: 15%; left: 50%;" id="rad-tts">朗讀練習</div>
      <div class="radial-sector" style="top: 50%; left: 85%;" id="rad-ask">即時提問</div>
      <div class="radial-sector" style="top: 85%; left: 50%;" id="rad-timer">計時開關</div>
      <div class="radial-sector" style="top: 50%; left: 15%;" id="rad-coach">標註講評</div>
    `;

    const closeRing = () => {
      ring.classList.remove('active');
      document.removeEventListener('click', closeRing);
    };

    setTimeout(() => {
      document.addEventListener('click', closeRing, { once: true });
    }, 100);

    ring.querySelector('#rad-tts')?.addEventListener('click', () => {
      this.openTTSDrill();
    });

    ring.querySelector('#rad-ask')?.addEventListener('click', () => {
      const q = this.controller.debateModel.getQuestionsForSide(this.controller.contextEngine.getSide())[0];
      if (q) this.popoutHudView.show(q, '觸控環快速提問');
    });

    ring.querySelector('#rad-timer')?.addEventListener('click', () => {
      this.toggleTimer();
    });

    ring.querySelector('#rad-coach')?.addEventListener('click', () => {
      this.handleTagCoachFeedback();
    });
  }
}
