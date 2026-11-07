import { SettingsModel } from '../models/SettingsModel';
import type { AppSettings, Side, CounselSeat } from '../types';
import { Icons } from './icons';

export interface SettingsViewCallbacks {
  onSettingsSaved: (settings: AppSettings) => void;
  onClose: () => void;
  onCheckUpdates?: () => void;
  onOpenAuth?: () => void;
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
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--rule); background: var(--paper-2); position: sticky; top: 0; z-index: 10;">
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="app-seal" style="width: 28px; height: 28px; font-size: 0.9rem;">辯</span>
            <span style="font-size: 1.15rem; font-weight: bold; color: var(--ink);">模擬庭提問陪伴台帳 · 系統偏好設定</span>
          </div>
          <div style="display: flex; gap: 0.8rem;">
            <button class="btn btn-outline" id="btn-settings-cancel-top" type="button">返回</button>
            <button class="btn btn-primary" id="btn-settings-save-top" type="button">
              ${Icons.check('', 14)}
              <span>儲存並返回</span>
            </button>
          </div>
        </div>

        <!-- Body -->
        <div style="max-width: 800px; width: 100%; margin: 0 auto; padding: 2rem 1rem; display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- Section 1: Display Elements Selection -->
          <div class="card">
            <div class="card-title">
              <span class="panel-icon">${Icons.settings('', 16)}</span>
              <span>介面輔助模組自訂呈現 (自選開啟)</span>
            </div>
            <p style="font-size: 0.82rem; color: var(--ink-2); margin-top: 0.2rem; margin-bottom: 0.8rem;">
              您可以依據今日研究員的專注需求，自由勾選希望在畫面上呈現的輔助面板：
            </p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem;">
              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showRoadmap" ${s.showRoadmap ? 'checked' : ''} />
                <span>辯論爭點架構圖 (Roadmap)</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showScriptTracker" ${s.showScriptTracker ? 'checked' : ''} />
                <span>口說稿即時對照追蹤</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showLiveChineseSummary" ${s.showLiveChineseSummary ? 'checked' : ''} />
                <span>隨念隨摘即時中文摘要</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showAIQuestionPrompts" ${s.showAIQuestionPrompts ? 'checked' : ''} />
                <span>智慧提問時機點提示 (AI Prompts)</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-showTTSHelper" ${s.showTTSHelper ? 'checked' : ''} />
                <span>研究員朗讀發音小幫手</span>
              </label>

              <label class="setting-toggle-label">
                <input type="checkbox" id="set-enableFeedbackSegmentation" ${s.enableFeedbackSegmentation ? 'checked' : ''} />
                <span>老師講評自動獨立切分</span>
              </label>
            </div>
          </div>

          <!-- Section 2: Moot Rules & Timing -->
          <div class="card">
            <div class="card-title">
              <span class="panel-icon">${Icons.timer('', 16)}</span>
              <span>模擬庭規則、AI 動態提問時機與自動計時</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.8rem;">
              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">辯方立場</label>
                <div class="pills">
                  <button class="pill-item ${s.targetSide === 'prosecution' ? 'active' : ''}" id="btn-side-pros-set" type="button">正方 (申請方)</button>
                  <button class="pill-item ${s.targetSide === 'defense' ? 'active' : ''}" id="btn-side-def-set" type="button">反方 (被申請方)</button>
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">AI 最佳提問時機敏感度 (完全動態判斷)</label>
                <div class="pills" id="sensitivity-pills">
                  <button class="pill-item ${s.interruptionSensitivity === 'aggressive' ? 'active' : ''}" data-sens="aggressive" type="button">積極抗壓</button>
                  <button class="pill-item ${s.interruptionSensitivity === 'balanced' ? 'active' : ''}" data-sens="balanced" type="button">標準攻防</button>
                  <button class="pill-item ${s.interruptionSensitivity === 'conservative' ? 'active' : ''}" data-sens="conservative" type="button">沈著等待</button>
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">即時吐出小視窗停留秒數</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="number" id="set-popoutSec" value="${s.autoHidePopoutSec}" min="3" max="30" style="padding: 0.4rem; border: 1px solid var(--rule); border-radius: var(--radius); width: 80px; background: var(--paper-2); color: var(--ink);" /> 秒
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.82rem; margin-bottom: 0.4rem;">智慧功能開關</label>
                <div style="display: flex; flex-direction: column; gap: 0.4rem;">
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
                    <span>練習開始時自動本機/雲端安全錄音</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Section 3: Web Auth & Cloud DB -->
          <div class="card">
            <div class="card-title">
              <span class="panel-icon">${Icons.cloudCheck('', 16)}</span>
              <span>網站帳號授權與雲端資料庫連線</span>
            </div>
            <p style="font-size: 0.82rem; color: var(--ink-2); margin-top: 0.2rem; margin-bottom: 0.8rem;">
              資料庫連線端點：<code>https://elisfbvxwowvhdkynzqu.supabase.co</code> (與 wason.dev 官網即時雙向連線同步)
            </p>
            <div style="display: flex; gap: 0.8rem; align-items: center;">
              <button class="btn btn-outline" id="btn-settings-open-auth" type="button">
                ${Icons.external('', 14)}
                <span>開啟網站授權與通行碼驗證</span>
              </button>
            </div>
          </div>

          <!-- Section 4: Updates & Maintenance -->
          <div class="card">
            <div class="card-title">
              <span class="panel-icon">${Icons.refresh('', 16)}</span>
              <span>軟體版本與線上熱修復更新</span>
            </div>
            <p style="font-size: 0.82rem; color: var(--ink-2); margin-top: 0.2rem; margin-bottom: 0.8rem;">
              可自動線上偵測最新正式發行版與緊急熱修復，並支援一鍵無縫下載安裝。
            </p>
            <div style="display: flex; gap: 0.8rem; align-items: center;">
              <button class="btn btn-outline" id="btn-settings-check-update" type="button">
                ${Icons.refresh('', 14)}
                <span>立即檢查線上最新版本</span>
              </button>
            </div>
          </div>

          <!-- Section 5: Save button footer -->
          <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem; border-top: 1px solid var(--rule); padding-top: 1.2rem;">
            <button class="btn btn-outline btn-touch" id="btn-settings-cancel" type="button">取消</button>
            <button class="btn btn-primary btn-touch" id="btn-settings-save" type="button">儲存設定</button>
          </div>

        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    let currentSide: Side = this.model.getSettings().targetSide;
    let currentSensitivity = this.model.getSettings().interruptionSensitivity;

    this.container.querySelectorAll('#sensitivity-pills button[data-sens]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentSensitivity = btn.getAttribute('data-sens') as any;
        this.container.querySelectorAll('#sensitivity-pills button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

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

    this.container.querySelector('#btn-settings-open-auth')?.addEventListener('click', () => {
      if (this.callbacks.onOpenAuth) this.callbacks.onOpenAuth();
    });

    this.container.querySelector('#btn-settings-check-update')?.addEventListener('click', () => {
      if (this.callbacks.onCheckUpdates) this.callbacks.onCheckUpdates();
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
        interruptionSensitivity: currentSensitivity,
        targetSide: currentSide
      };

      this.model.updateAll(updated);
      this.callbacks.onSettingsSaved(this.model.getSettings());
      this.close();
    };

    this.container.querySelector('#btn-settings-save-top')?.addEventListener('click', handleSave);
    this.container.querySelector('#btn-settings-save')?.addEventListener('click', handleSave);
    this.container.querySelector('#btn-settings-cancel')?.addEventListener('click', () => this.close());
    this.container.querySelector('#btn-settings-cancel-top')?.addEventListener('click', () => this.close());
  }
}
