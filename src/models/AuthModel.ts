import type { AuthSession } from '../types';
import { SupabaseService, type UserProfile } from '../services/SupabaseService';

export class AuthModel {
  private session: AuthSession | null = null;
  private userProfile: UserProfile | null = null;
  private debateCode: string = '';
  private readonly SESSION_STORAGE_KEY = 'debate_companion_auth_session_v1';
  private readonly CODE_STORAGE_KEY = 'debate_companion_code_v1';

  constructor() {
    this.loadSession();
  }

  public getSession(): AuthSession | null {
    return this.session;
  }

  public getUserProfile(): UserProfile | null {
    return this.userProfile;
  }

  public getDebateCode(): string {
    return this.debateCode;
  }

  public setDebateCode(code: string): void {
    this.debateCode = code.trim();
    SupabaseService.getInstance().setBankCode(this.debateCode);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.CODE_STORAGE_KEY, this.debateCode);
      }
    } catch (_) {}
  }

  public isAuthenticated(): boolean {
    if (this.debateCode.length > 0) return true;
    if (!this.session) return false;
    // Session valid within 30 days
    return (Date.now() - this.session.authorizedAt < 30 * 24 * 3600 * 1000);
  }

  public hasDebatePermission(): boolean {
    if (this.debateCode.length > 0) return true;
    if (!this.session) return false;
    if (this.userProfile) {
      if (this.userProfile.owner) return true;
      if (this.userProfile.status !== 'active') return false;
      const grants = this.userProfile.grants || [];
      const hasGrant = grants.some(g => g.module === 'debate' || g.module === 'desk');
      if (hasGrant) return true;
    }
    // If authenticated by token with role
    return !!this.session.token;
  }

  public async setSession(session: AuthSession, profile?: UserProfile): Promise<void> {
    this.session = session;
    this.userProfile = profile || null;
    this.persistSession();

    if (session.token) {
      const verified = await SupabaseService.getInstance().verifyUserSession(session.token);
      if (verified) {
        this.userProfile = verified;
      }
    }
  }

  public clearSession(): void {
    this.session = null;
    this.userProfile = null;
    this.debateCode = '';
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.SESSION_STORAGE_KEY);
        localStorage.removeItem(this.CODE_STORAGE_KEY);
      }
    } catch (_) {}
  }

  private loadSession(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const storedCode = localStorage.getItem(this.CODE_STORAGE_KEY);
        if (storedCode) {
          this.debateCode = storedCode;
          SupabaseService.getInstance().setBankCode(storedCode);
        }

        const raw = localStorage.getItem(this.SESSION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.token || parsed.userId)) {
            this.session = parsed;
          }
        }
      }
    } catch (_) {}
  }

  private persistSession(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        if (this.session) {
          localStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(this.session));
        }
        if (this.debateCode) {
          localStorage.setItem(this.CODE_STORAGE_KEY, this.debateCode);
        }
      }
    } catch (_) {}
  }
}
