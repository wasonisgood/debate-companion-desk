import type { AuthSession } from '../types';

export class AuthModel {
  private session: AuthSession | null = null;
  private readonly SESSION_STORAGE_KEY = 'debate_companion_auth_session_v1';

  constructor() {
    this.loadSession();
  }

  public getSession(): AuthSession | null {
    return this.session;
  }

  public isAuthenticated(): boolean {
    return !!this.session && (Date.now() - this.session.authorizedAt < 30 * 24 * 3600 * 1000);
  }

  public setSession(session: AuthSession): void {
    this.session = session;
    this.persistSession();
  }

  public clearSession(): void {
    this.session = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.SESSION_STORAGE_KEY);
      }
    } catch (_) {}
  }

  private loadSession(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.SESSION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.token) {
            this.session = parsed;
          }
        }
      }
    } catch (_) {}
  }

  private persistSession(): void {
    try {
      if (typeof localStorage !== 'undefined' && this.session) {
        localStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(this.session));
      }
    } catch (_) {}
  }
}
