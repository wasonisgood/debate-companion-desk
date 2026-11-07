export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  mandatory?: boolean;
  notesZh?: string;
  installerUrl?: string;
  sha256?: string;
  message?: string;
}

export class UpdateModalView {
  private container: HTMLElement;
  private currentUpdate: UpdateInfo | null = null;
  private isDownloading: boolean = false;
  private downloadPercent: number = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupListeners();
  }

  private setupListeners(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onUpdateDownloadProgress) {
      electronAPI.onUpdateDownloadProgress((prog: { percent: number; transferred: number; total: number }) => {
        this.downloadPercent = prog.percent;
        this.updateProgressUi(prog.percent, prog.transferred, prog.total);
      });
    }

    if (electronAPI?.onUpdateAvailable) {
      electronAPI.onUpdateAvailable((info: UpdateInfo) => {
        this.show(info);
      });
    }
  }

  public show(info: UpdateInfo): void {
    this.currentUpdate = info;
    this.isDownloading = false;
    this.downloadPercent = 0;
    this.render();
    this.container.style.display = 'flex';
  }

  public close(): void {
    if (this.currentUpdate?.mandatory && this.currentUpdate?.hasUpdate) {
      // Cannot close mandatory update
      return;
    }
    this.container.style.display = 'none';
  }

  private render(): void {
    const info = this.currentUpdate;
    if (!info) return;

    if (!info.hasUpdate) {
      this.container.innerHTML = `
        <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(29, 27, 23, 0.6); backdrop-filter: blur(4px); z-index: 10002; display: flex; align-items: center; justify-content: center; padding: 1rem;">
          <div class="card" style="width: 440px; max-width: 100%; background: var(--paper); box-shadow: var(--shadow-lg); padding: 1.5rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.8rem;">
              <span class="app-seal" style="width: 24px; height: 24px; font-size: 0.85rem;">辯</span>
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--ink);">軟體版本檢查結果</h3>
            </div>
            <p style="color: var(--ink-2); font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.2rem;">
              您目前的應用程式已是最新版本 (<strong>v${info.currentVersion}</strong>)。<br>
              雲端爭點資料庫、即時對照引擎與法官提問庫皆處於最新狀態。
            </p>
            <div style="display: flex; justify-content: flex-end;">
              <button class="btn btn-primary" id="btn-update-ok" style="min-width: 80px;">確定</button>
            </div>
          </div>
        </div>
      `;
      this.container.querySelector('#btn-update-ok')?.addEventListener('click', () => this.close());
      return;
    }

    const isMandatory = !!info.mandatory;

    this.container.innerHTML = `
      <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(29, 27, 23, 0.65); backdrop-filter: blur(5px); z-index: 10002; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div class="card" style="width: 490px; max-width: 100%; background: var(--paper); box-shadow: var(--shadow-lg); padding: 1.5rem; border: 1px solid var(--rule);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.6rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="app-seal" style="width: 24px; height: 24px; font-size: 0.85rem;">辯</span>
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--ink);">發現新版本熱修復更新</h3>
            </div>
            ${isMandatory ? `<span class="badge badge-shu" style="font-weight: bold;">強制更新</span>` : `<span class="badge badge-ainezu">可選更新</span>`}
          </div>

          <div style="display: flex; gap: 1rem; margin-bottom: 1rem; background: var(--paper-2); padding: 0.6rem 0.8rem; border-radius: var(--radius); font-size: 0.85rem;">
            <div>目前版本: <strong style="font-family: var(--mono);">${info.currentVersion}</strong></div>
            <div style="color: var(--shu-ink);">最新版本: <strong style="font-family: var(--mono);">v${info.latestVersion}</strong></div>
          </div>

          <div style="font-size: 0.82rem; font-weight: bold; color: var(--ink-2); margin-bottom: 0.4rem;">更新摘要與熱修復記錄：</div>
          <div style="max-height: 140px; overflow-y: auto; background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 0.75rem; font-size: 0.84rem; line-height: 1.6; white-space: pre-wrap; color: var(--ink); margin-bottom: 1.2rem;">
${info.notesZh || '・系統爭點對照模組升級\n・修復語音辨識與老師講評切分功能\n・優化視窗響應式排版與自訂捲軸'}
          </div>

          <!-- Progress bar -->
          <div id="update-download-box" style="display: none; margin-bottom: 1.2rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--ink-2); margin-bottom: 0.35rem;">
              <span>正在下載最新發行套件...</span>
              <span id="update-percent-text" style="font-family: var(--mono);">0%</span>
            </div>
            <div style="width: 100%; height: 8px; background: var(--paper-3); border-radius: 4px; overflow: hidden; border: 1px solid var(--rule);">
              <div id="update-progress-bar-fill" style="width: 0%; height: 100%; background: var(--shu); transition: width 0.15s ease;"></div>
            </div>
            <div id="update-status-detail" style="font-size: 0.75rem; color: var(--ink-3); margin-top: 0.3rem; font-family: var(--mono);">
              準備中...
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.6rem;">
            ${!isMandatory ? `
              <button class="btn btn-outline" id="btn-update-cancel" type="button">稍後提醒</button>
            ` : `
              <div style="font-size: 0.78rem; color: var(--shu-ink); display: flex; align-items: center; margin-right: auto;">
                注意：此版本包含核心資料庫修復，請更新以繼續練習
              </div>
            `}
            <button class="btn btn-primary" id="btn-update-install" type="button" style="min-width: 130px;">
              一鍵自動安裝更新
            </button>
          </div>
        </div>
      </div>
    `;

    if (!isMandatory) {
      this.container.querySelector('#btn-update-cancel')?.addEventListener('click', () => this.close());
    }

    this.container.querySelector('#btn-update-install')?.addEventListener('click', () => {
      this.startInstall();
    });
  }

  private updateProgressUi(percent: number, transferred: number, total: number): void {
    const box = this.container.querySelector('#update-download-box') as HTMLElement;
    if (box) box.style.display = 'block';

    const fill = this.container.querySelector('#update-progress-bar-fill') as HTMLElement;
    if (fill) fill.style.width = `${percent}%`;

    const text = this.container.querySelector('#update-percent-text');
    if (text) text.textContent = `${percent}%`;

    const detail = this.container.querySelector('#update-status-detail');
    if (detail) {
      const mbTrans = (transferred / (1024 * 1024)).toFixed(1);
      const mbTotal = total > 0 ? (total / (1024 * 1024)).toFixed(1) : '?';
      detail.textContent = `${mbTrans} MB / ${mbTotal} MB`;
    }
  }

  private async startInstall(): Promise<void> {
    if (this.isDownloading || !this.currentUpdate) return;
    this.isDownloading = true;

    const btn = this.container.querySelector('#btn-update-install') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在下載...';
    }

    const box = this.container.querySelector('#update-download-box') as HTMLElement;
    if (box) box.style.display = 'block';

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.downloadAndInstallUpdate) {
      const res = await electronAPI.downloadAndInstallUpdate(this.currentUpdate);
      if (!res.success) {
        alert('下載更新時發生錯誤: ' + (res.error || '未知錯誤'));
        if (btn) {
          btn.disabled = false;
          btn.textContent = '重試下載安裝';
        }
        this.isDownloading = false;
      }
    } else {
      // In web browser preview mode: open external download link
      window.open(this.currentUpdate.installerUrl || 'https://github.com/wasonisgood/debate-companion-desk/releases', '_blank');
      this.close();
    }
  }
}
