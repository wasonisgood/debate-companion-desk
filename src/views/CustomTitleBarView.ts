export interface TitleBarCallbacks {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onToggleFloatMode: () => void;
  onOpenSettings: () => void;
  onSwitchSide: (side: 'prosecution' | 'defense') => void;
  onStartSimulation: () => void;
}

export class CustomTitleBarView {
  private container: HTMLElement;
  private callbacks: TitleBarCallbacks;
  private isFloating: boolean = false;

  constructor(container: HTMLElement, callbacks: TitleBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public render(): void {
    this.container.innerHTML = `
      <div id="custom-titlebar">
        <div class="titlebar-left">
          <div class="app-branding">
            <span class="app-seal">辯</span>
            <span>模擬庭提問陪伴台帳</span>
          </div>

          <nav class="custom-menu-bar">
            <!-- 檔案 Menu -->
            <div class="custom-menu-item" data-menu="file">
              <button class="custom-menu-btn" type="button">檔案</button>
              <div class="custom-dropdown-list">
                <button class="dropdown-action-btn" id="menu-new-prep">新練習回合</button>
                <button class="dropdown-action-btn" id="menu-export-record">匯出今日錄音紀錄</button>
                <div class="dropdown-divider"></div>
                <button class="dropdown-action-btn" id="menu-exit">關閉陪伴台帳</button>
              </div>
            </div>

            <!-- 模式 Menu -->
            <div class="custom-menu-item" data-menu="mode">
              <button class="custom-menu-btn" type="button">辯方</button>
              <div class="custom-dropdown-list">
                <button class="dropdown-action-btn" id="menu-side-pros">切換為 簡方 (申請方)</button>
                <button class="dropdown-action-btn" id="menu-side-def">切換為 扁方 (被申請方)</button>
              </div>
            </div>

            <!-- 工具 Menu -->
            <div class="custom-menu-item" data-menu="tools">
              <button class="custom-menu-btn" type="button">工具</button>
              <div class="custom-dropdown-list">
                <button class="dropdown-action-btn" id="menu-sim-speech">模擬辯士朗讀口說</button>
                <button class="dropdown-action-btn" id="menu-tts-drill">發音朗讀小幫手</button>
                <button class="dropdown-action-btn" id="menu-split-feedback">手動標註老師講評</button>
              </div>
            </div>

            <!-- 設定 Menu -->
            <div class="custom-menu-item" data-menu="settings">
              <button class="custom-menu-btn" id="menu-open-settings" type="button">設定</button>
            </div>
          </nav>
        </div>

        <div class="titlebar-center">
          <span class="badge-status" id="tb-timer-badge">⏱ 15:00</span>
          <span class="badge-status rec" id="tb-rec-badge" style="display: none;">
            <span class="badge-status rec-dot"></span> 錄音中
          </span>
          <span class="badge-status sync-ok" id="tb-sync-badge">☁ 雲端同步已就緒</span>
        </div>

        <div class="titlebar-right">
          <button class="win-control-btn float-toggle" id="btn-win-float" title="切換懸浮球微型視窗" type="button">⧉</button>
          <button class="win-control-btn" id="btn-win-min" title="最小化" type="button">—</button>
          <button class="win-control-btn" id="btn-win-max" title="最大化" type="button">□</button>
          <button class="win-control-btn close" id="btn-win-close" title="關閉" type="button">✕</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Menu dropdown toggles
    const menuItems = this.container.querySelectorAll('.custom-menu-item');
    menuItems.forEach(item => {
      const btn = item.querySelector('.custom-menu-btn');
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        menuItems.forEach(other => {
          if (other !== item) other.classList.remove('active');
        });
        item.classList.toggle('active');
      });
    });

    document.addEventListener('click', () => {
      menuItems.forEach(item => item.classList.remove('active'));
    });

    // Window controls
    this.container.querySelector('#btn-win-min')?.addEventListener('click', () => this.callbacks.onMinimize());
    this.container.querySelector('#btn-win-max')?.addEventListener('click', () => this.callbacks.onMaximize());
    this.container.querySelector('#btn-win-close')?.addEventListener('click', () => this.callbacks.onClose());
    this.container.querySelector('#btn-win-float')?.addEventListener('click', () => {
      this.isFloating = !this.isFloating;
      const btn = this.container.querySelector('#btn-win-float');
      if (this.isFloating) {
        btn?.classList.add('active');
      } else {
        btn?.classList.remove('active');
      }
      this.callbacks.onToggleFloatMode();
    });

    // Menu actions
    this.container.querySelector('#menu-side-pros')?.addEventListener('click', () => this.callbacks.onSwitchSide('prosecution'));
    this.container.querySelector('#menu-side-def')?.addEventListener('click', () => this.callbacks.onSwitchSide('defense'));
    this.container.querySelector('#menu-sim-speech')?.addEventListener('click', () => this.callbacks.onStartSimulation());
    this.container.querySelector('#menu-open-settings')?.addEventListener('click', () => this.callbacks.onOpenSettings());
    this.container.querySelector('#menu-exit')?.addEventListener('click', () => this.callbacks.onClose());
  }

  public updateTimerDisplay(remainingSec: number, isRunning: boolean): void {
    const badge = this.container.querySelector('#tb-timer-badge');
    if (!badge) return;
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const clock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    badge.textContent = `⏱ ${clock}`;
    if (isRunning) {
      badge.classList.add('active');
    } else {
      badge.classList.remove('active');
    }
  }

  public setRecording(isRecording: boolean): void {
    const badge = this.container.querySelector('#tb-rec-badge') as HTMLElement;
    if (badge) {
      badge.style.display = isRecording ? 'inline-flex' : 'none';
    }
  }

  public setSyncStatus(text: string, isOk: boolean): void {
    const badge = this.container.querySelector('#tb-sync-badge');
    if (badge) {
      badge.textContent = text;
      badge.className = `badge-status ${isOk ? 'sync-ok' : ''}`;
    }
  }
}
