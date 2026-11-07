import type { AuthSession } from '../types';
import { AuthModel } from '../models/AuthModel';

export class BridgeController {
  private authModel: AuthModel;
  private onAuthSuccess?: (session: AuthSession) => void;

  constructor(authModel: AuthModel) {
    this.authModel = authModel;
    this.setupWindowListeners();
  }

  public setOnAuthSuccess(cb: (session: AuthSession) => void): void {
    this.onAuthSuccess = cb;
  }

  private setupWindowListeners(): void {
    if (typeof window !== 'undefined') {
      // Listen for custom IPC events from Electron main process
      const electronAPI = (window as any).electronAPI;
      if (electronAPI && electronAPI.onAuthGranted) {
        electronAPI.onAuthGranted((session: AuthSession) => {
          this.handleAuthSession(session);
        });
      }

      // Also listen for postMessage or BroadcastChannel if opened in same origin
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'DEBATE_AUTH_GRANTED') {
          this.handleAuthSession(event.data.session);
        }
      });
    }
  }

  public handleAuthSession(session: AuthSession): void {
    if (!session || !session.token) return;
    this.authModel.setSession(session);
    if (this.onAuthSuccess) {
      this.onAuthSuccess(session);
    }
  }

  /**
   * Generates web handoff login URL directing user to the web portal
   * which validates the user and redirects back via debate-companion://
   */
  public getWebLoginUrl(port: number = 48231): string {
    const redirectUri = encodeURIComponent(`http://127.0.0.1:${port}/auth/callback`);
    return `https://wasonisgood.github.io/wasm_web/#/debate?action=desk_login&redirect=${redirectUri}`;
  }
}
