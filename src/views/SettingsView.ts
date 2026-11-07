import { SettingsModel } from '../models/SettingsModel';
import type { AppSettings, Side, CounselSeat } from '../types';

export interface SettingsViewCallbacks {
  onSettingsSaved: (settings: AppSettings) => void;
  onClose: () => void;
}

export class SettingsView {
  private container: HTMLElement;
  private model: SettingsModel;
  private callbacks: SettingsViewCallbacks;

  constructor(container: HTMLElement, model: SettingsModel, callbacks: SettingsViewCallbacks) {
    this.container = container;
    this.model = model;
    this.callbacks = callbacks;
  }

  public open(): void {
    this.render();
    this.container.style.display = 'block';
  }

  public close(): void {
    this.container.style.display = 'none';
    this.callbacks.onClose();
  }

  public render(): void {
    const s = this.model.getSettings();

    this.container.innerHTML = `
      <div id="settings-fullscreen-overlay" style="position: fixed; inset: 0; background: var(--paper); z-index: 10002; display: flex; flex-direction: column; overflow-y: auto;">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--rule); background: var(--paper-2);">
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="app-seal" style="width: 28px; height: 28px; font-size: 0.9rem;">設</span>
            <span style="font-size: 1.15rem; font-weight: bold; color: var(--ink);">模擬庭提問陪伴台帳 · 全螢幕偏好設定</span>
          </div>
          <button class="btn btn-primary btn-touch" id="btn-settings-save-top">
            ✓ 儲存並返回陪伴視窗
          </button>
        </div>

        <!-- Body -->
        <div style="max-width: 800px; width: 100%; margin: 0 auto; padding: 2rem 1rem; display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- Section 1: Display Elements Selection -->
          <div class="card">
            <div class="card-title">🖥 介面輔助模組自訂呈現 (自選開啟)</div>
            <p style="font-size: 0.82rem; color: var(--ink-2); margin-top: 0.2rem;">
              您可以依據今日研究員的專注需求，自由勾選希望在畫面上呈現的輔助面板：
            </p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-top: 0.8rem;">
              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showRoadmap" ${s.showRoadmap ? 'checked' : ''} />
                <span>🗺 辯論爭點架構圖 (Roadmap)</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showScriptTracker" ${s.showScriptTracker ? 'checked' : ''} />
                <span>🎙 口說稿即時對照追蹤</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showLiveChineseSummary" ${s.showLiveChineseSummary ? 'checked' : ''} />
                <span>隨念隨摘即時中文摘要</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showAIQuestionPrompts" ${s.showAIQuestionPrompts ? 'checked' : ''} />
                <span>⚖ 智慧提問時機點提示 (AI Prompts)</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showTTSHelper" ${s.showTTSHelper ? 'checked' : ''} />
                <span>🔊 研究員朗讀發音小幫手</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-enableFeedbackSegmentation" ${s.enableFeedbackSegmentation ? 'checked' : ''} />
                <span>🎙 老師講評自動獨立切分</span>
              </label>
            </div>
          </div>

          <!-- Section 2: Moot Rules & Timing -->
          <div class="card">
            <div class="card-title">⏱ 模擬庭規則與自動計時</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.8rem;">
              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">辯方立場</label>
                <div class="pills">
                  <button class="pill-item ${s.targetSide === 'prosecution' ? 'active' : ''}" id="btn-side-pros-set" type="button">簡方 (申請方)</button>
                  <button class="pill-item ${s.targetSide === 'defense' ? 'active' : ''}" id="btn-side-def-set" type="button">扁方 (被申請方)</button>
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">即時吐出小視窗停留秒數 (無操作自動收回)</label>
                <input type="number" id="set-popoutSec" value="${s.autoHidePopoutSec}" min="3" max="30" style="padding: 0.4rem; border: 1px solid var(--rule); border-radius: var(--radius); width: 80px;" /> 秒
              </div>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-enableSmartTimer" ${s.enableSmartTimer ? 'checked' : ''} />
                <span>口說開始時自動啟動計時</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-enableAutoBells" ${s.enableAutoBells ? 'checked' : ''} />
                <span>時間到達自動響鈴 (殘餘2分與結束)</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-enableAutoRecording" ${s.enableAutoRecording ? 'checked' : ''} />
                <span>練習開始時自動安全本機/雲端錄音</span>
              </label>
            </div>
          </div>

          <!-- Section 3: Save button footer -->
          <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
            <button class="btn btn-outline btn-touch" id="btn-settings-cancel">取消</button>
            <button class="btn btn-primary btn-touch" id="btn-settings-save">儲存設定</button>
          </div>

        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    let currentSide: Side = this.model.getSettings().targetSide;

    this.container.querySelector('#btn-side-pros-set')?.addEventListener('click', () => {
      currentSide = 'prosecution';
      this.container.querySelector('#btn-side-pros-set')?.classList.add('active');
      this.container.querySelector('#btn-side-def-set')?.classList.remove('active');
    });

    this.container.querySelector('#btn-side-def-set')?.addEventListener('click', () => {
      currentSide = 'defense';
      this.container.querySelector('#btn-side-def-set')?.classList.add('active');
      this.container.querySelector('#btn-side-pros-set')?.classList.remove('active');
    });

    const handleSave = () => {
      const showRoadmap = (this.container.querySelector('#set-showRoadmap') as HTMLInputElement)?.checked ?? true;
      const showScriptTracker = (this.container.querySelector('#set-showScriptTracker') as HTMLInputElement)?.checked ?? true;
      const showLiveChineseSummary = (this.container.querySelector('#set-showLiveChineseSummary') as HTMLInputElement)?.checked ?? true;
      const showAIQuestionPrompts = (this.container.querySelector('#set-showAIQuestionPrompts') as HTMLInputElement)?.checked ?? true;
      const showTTSHelper = (this.container.querySelector('#set-showTTSHelper') as HTMLInputElement)?.checked ?? true;
      const enableFeedbackSegmentation = (this.container.querySelector('#set-enableFeedbackSegmentation') as HTMLInputElement)?.checked ?? true;
      const enableSmartTimer = (this.container.querySelector('#set-enableSmartTimer') as HTMLInputElement)?.checked ?? true;
      const enableAutoBells = (this.container.querySelector('#set-enableAutoBells') as HTMLInputElement)?.checked ?? true;
      const enableAutoRecording = (this.container.querySelector('#set-enableAutoRecording') as HTMLInputElement)?.checked ?? true;
      const popoutSec = parseInt((this.container.querySelector('#set-popoutSec') as HTMLInputElement)?.value || '8', 10);

      const updated: Partial<AppSettings> = {
        showRoadmap,
        showScriptTracker,
        showLiveChineseSummary,
        showAIQuestionPrompts,
        showTTSHelper,
        enableFeedbackSegmentation,
        enableSmartTimer,
        enableAutoBells,
        enableAutoRecording,
        autoHidePopoutSec: popoutSec,
        targetSide: currentSide
      };

      this.model.updateAll(updated);
      this.callbacks.onSettingsSaved(this.model.getSettings());
      this.close();
    };

    this.container.querySelector('#btn-settings-save-top')?.addEventListener('click', handleSave);
    this.container.querySelector('#btn-settings-save')?.addEventListener('click', handleSave);
    this.container.querySelector('#btn-settings-cancel')?.addEventListener('click', () => this.close());
  }
}
