import { AuthModel } from '../models/AuthModel';
import { SupabaseService } from '../services/SupabaseService';

export interface AuthVerificationCallbacks {
  onAuthenticated: () => void;
  onDismissOffline: () => void;
}

export class AuthVerificationModalView {
  private container: HTMLElement;
  private authModel: AuthModel;
  private callbacks: AuthVerificationCallbacks;
  private isVerifying: boolean = false;

  constructor(container: HTMLElement, authModel: AuthModel, callbacks: AuthVerificationCallbacks) {
    this.container = container;
    this.authModel = authModel;
    this.callbacks = callbacks;
  }

  public show(): void {
    this.render();
    this.container.style.display = 'flex';
  }

  public close(): void {
    this.container.style.display = 'none';
  }

  public render(): void {
    const isAuth = this.authModel.isAuthenticated();
    const session = this.authModel.getSession();
    const code = this.authModel.getDebateCode();
    const profile = this.authModel.getUserProfile();

    this.container.innerHTML = `
      <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(29, 27, 23, 0.7); backdrop-filter: blur(5px); z-index: 10005; display: flex; align-items: center; justify-content: center; padding: 1.2rem;">
        <div class="card" style="width: 520px; max-width: 100%; background: var(--paper); box-shadow: var(--shadow-lg); padding: 1.8rem; border: 1px solid var(--rule);">
          
          <!-- Header -->
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--rule); padding-bottom: 0.8rem; margin-bottom: 1.2rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="app-seal" style="width: 26px; height: 26px; font-size: 0.9rem;">辯</span>
              <h2 style="margin: 0; font-size: 1.15rem; color: var(--ink);">模擬庭陪伴台帳 · 網站授權與權限檢查</h2>
            </div>
            ${isAuth ? `<span class="badge badge-koke">已授權連線</span>` : `<span class="badge badge-shu">需要授權</span>`}
          </div>

          <!-- Body Description -->
          <p style="font-size: 0.88rem; color: var(--ink-2); line-height: 1.6; margin-bottom: 1.2rem;">
            本桌面應用程式專為辯論選手與研究員打造，需與 <strong>wason.dev</strong> 官方網站進行身份登入與權限檢查，以取得專屬法官提問庫、爭點對照路徑樹並啟用雲端同步演練紀錄。
          </p>

          ${isAuth ? `
            <div style="background: var(--paper-2); border-left: 4px solid var(--koke); padding: 0.8rem 1rem; border-radius: var(--radius); margin-bottom: 1.2rem;">
              <div style="font-weight: bold; font-size: 0.9rem; color: var(--ink); margin-bottom: 0.3rem;">
                帳號身份驗證成功
              </div>
              <div style="font-size: 0.82rem; color: var(--ink-2); line-height: 1.5;">
                使用者：<strong>${session?.userName || '研究員'}</strong> (${session?.userEmail || profile?.email || '網站授權用戶'})<br>
                通行代碼：<code style="font-family: var(--mono); color: var(--shu-ink);">${code || '網站自動授權金鑰'}</code>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; gap: 0.8rem;">
              <button class="btn btn-outline" id="btn-re-auth" type="button">切換帳號 / 重新驗證</button>
              <button class="btn btn-primary" id="btn-enter-workspace" type="button" style="min-width: 130px;">進入陪伴台帳</button>
            </div>
          ` : `
            <!-- Action 1: Web Authorization Button -->
            <div style="background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 1rem; margin-bottom: 1.2rem; text-align: center;">
              <div style="font-size: 0.86rem; color: var(--ink); font-weight: 600; margin-bottom: 0.5rem;">
                方式一：透過瀏覽器一鍵授權回傳
              </div>
              <p style="font-size: 0.8rem; color: var(--ink-3); margin-bottom: 0.8rem; line-height: 1.4;">
                點擊下方按鈕將開啟瀏覽器登入 wason.dev，完成後瀏覽器會自動喚醒並將授權金鑰回傳至本桌面應用程式。
              </p>
              <button class="btn btn-primary btn-touch" id="btn-open-web-auth" style="width: 100%; font-size: 0.95rem; font-weight: bold;" type="button">
                前往網站進行身份驗證與授權
              </button>
              <div id="auth-listening-hint" style="font-size: 0.75rem; color: var(--ink-3); margin-top: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
                <span class="badge-status rec-dot" style="animation: pulseRec 1.5s infinite;"></span>
                本地授權伺服器就緒中，等待網站回傳 (連接埠 48231)
              </div>
            </div>

            <!-- Action 2: Manual Code Input -->
            <div style="border-top: 1px dashed var(--rule); padding-top: 0.9rem; margin-bottom: 1.2rem;">
              <div style="font-size: 0.82rem; font-weight: 600; color: var(--ink-2); margin-bottom: 0.4rem;">
                方式二：手動輸入辯論通行代碼 (Debate Code) 或存取金鑰
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <input type="text" id="input-manual-code" placeholder="例如：DEBATE-2026 或網站金鑰" style="flex: 1; padding: 0.45rem 0.7rem; font-family: var(--mono); font-size: 0.85rem; border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper-2); color: var(--ink);" value="${code}">
                <button class="btn btn-outline" id="btn-verify-manual-code" type="button" style="white-space: nowrap;">驗證通行碼</button>
              </div>
              <div id="manual-verify-error" style="color: var(--shu-ink); font-size: 0.78rem; margin-top: 0.3rem; display: none;"></div>
            </div>

            <!-- Footer: Offline option -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
              <button class="btn btn-outline" id="btn-offline-mode" type="button" style="color: var(--ink-3);">
                以訪客模式離線演練
              </button>
            </div>
          `}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const isAuth = this.authModel.isAuthenticated();

    if (isAuth) {
      this.container.querySelector('#btn-enter-workspace')?.addEventListener('click', () => {
        this.close();
        this.callbacks.onAuthenticated();
      });

      this.container.querySelector('#btn-re-auth')?.addEventListener('click', () => {
        this.authModel.clearSession();
        this.render();
      });
      return;
    }

    // Web OAuth redirect button
    this.container.querySelector('#btn-open-web-auth')?.addEventListener('click', () => {
      const port = 48231;
      const redirectUri = encodeURIComponent(`http://127.0.0.1:${port}/auth/callback`);
      const webUrl = `https://wason.dev/debate?action=desk_login&redirect=${redirectUri}`;

      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.openExternal) {
        electronAPI.openExternal(webUrl);
      } else {
        window.open(webUrl, '_blank');
      }

      const hint = this.container.querySelector('#auth-listening-hint');
      if (hint) {
        hint.innerHTML = `<span style="color: var(--shu-ink);">已開啟瀏覽器，請在網站完成登入並點擊「授權案頭端」...</span>`;
      }
    });

    // Manual code button
    this.container.querySelector('#btn-verify-manual-code')?.addEventListener('click', async () => {
      if (this.isVerifying) return;
      const input = this.container.querySelector('#input-manual-code') as HTMLInputElement;
      const val = (input?.value || '').trim();
      const errBox = this.container.querySelector('#manual-verify-error') as HTMLElement;

      if (!val) {
        if (errBox) {
          errBox.textContent = '請輸入通行代碼或金鑰。';
          errBox.style.display = 'block';
        }
        return;
      }

      this.isVerifying = true;
      const btn = this.container.querySelector('#btn-verify-manual-code') as HTMLButtonElement;
      if (btn) btn.textContent = '驗證中...';

      try {
        const bank = await SupabaseService.getInstance().loadDebateBank(val);
        this.authModel.setDebateCode(val);
        this.authModel.setSession({
          userId: 'code_user',
          userName: `研究員 (${val})`,
          userEmail: '',
          token: val,
          role: 'member',
          authorizedAt: Date.now()
        });

        this.render();
        this.callbacks.onAuthenticated();
      } catch (e: any) {
        if (errBox) {
          errBox.textContent = `驗證失敗: ${e.message || '無法連線至雲端資料庫'}`;
          errBox.style.display = 'block';
        }
      } finally {
        this.isVerifying = false;
        if (btn) btn.textContent = '驗證通行碼';
      }
    });

    // Offline guest button
    this.container.querySelector('#btn-offline-mode')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onDismissOffline();
    });
  }
}
