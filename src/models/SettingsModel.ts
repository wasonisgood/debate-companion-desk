import type { AppSettings, Side, CounselSeat } from '../types';

export class SettingsModel {
  private settings: AppSettings;
  private readonly STORAGE_KEY = 'debate_companion_desk_settings_v1';

  constructor(initial?: Partial<AppSettings>) {
    this.settings = {
      showRoadmap: true,
      showScriptTracker: true,
      showLiveChineseSummary: true,
      showAIQuestionPrompts: true,
      showTTSHelper: true,
      enableSmartTimer: true,
      enableAutoBells: true,
      enableAutoRecording: true,
      enableFeedbackSegmentation: true,
      autoHidePopoutSec: 8,
      ttsSpeed: 1.0,
      ttsVoiceName: '',
      bridgePort: 48231,
      targetSide: 'prosecution',
      targetSeat: 1,
      ...initial
    };
    this.loadFromStorage();
  }

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.saveToStorage();
  }

  public updateAll(newSettings: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveToStorage();
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.settings = { ...this.settings, ...parsed };
        }
      }
    } catch (_) {}
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch (_) {}
  }
}
