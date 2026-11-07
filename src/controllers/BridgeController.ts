import type { AuthSession } from '../types';
import { AuthModel } from '../models/AuthModel';

export class BridgeController {
  private authModel: AuthModel;
  private listeners: Array<(session: AuthSession) => void> = [];

  constructor(authModel: AuthModel) {
    this.authModel = authModel;
    this.setupWindowListeners();
  }

  public onAuthSuccess(cb: (session: AuthSession) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  public setOnAuthSuccess(cb: (session: AuthSession) => void): void {
    this.listeners.push(cb);
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
    for (const listener of this.listeners) {
      try {
        listener(session);
      } catch (e) {
        console.error('Error in onAuthSuccess listener:', e);
      }
    }
  }

  /**
   * Generates web handoff login URL directing user to the web portal
   * which validates the user and redirects back via debate-companion://
   */
  public getWebLoginUrl(port: number = 48231): string {
    const redirectUri = encodeURIComponent(`http://127.0.0.1:${port}/auth/callback`);
    return `https://wason.dev/debate?action=desk_login&redirect=${redirectUri}`;
  }
}
