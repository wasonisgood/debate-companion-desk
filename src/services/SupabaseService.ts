import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DebateData, BenchQuestion, OralUnit } from '../types';

export const SUPABASE_URL = 'https://elisfbvxwowvhdkynzqu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_A_lWVITAxz_FammE4Ol5rA_Dwx9ca_i';
const STORAGE_KEY = 'debate_practice_data_v1';
const BASE_KEY = 'debate_practice_base_v1';

export interface RemoteBankResponse {
  data: DebateData | null;
  version: number;
  updated_at: string | null;
  can_manage: boolean;
}

export interface UserGrant {
  module: string;
  role: string;
  expires_at?: string | null;
}

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  owner: boolean;
  grants: UserGrant[];
}

export class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient;
  private currentCode: string = '';

  private constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        storageKey: 'site-auth'
      }
    });
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public getClient(): SupabaseClient {
    return this.client;
  }

  public setBankCode(code: string): void {
    this.currentCode = code.trim();
  }

  public getBankCode(): string {
    return this.currentCode;
  }

  /**
   * Check user identity and permissions via Supabase RPC site_me
   */
  public async verifyUserSession(token?: string, refreshToken?: string): Promise<UserProfile | null> {
    try {
      if (token) {
        await this.client.auth.setSession({
          access_token: token,
          refresh_token: refreshToken || token
        });
      }

      const { data: { session } } = await this.client.auth.getSession();
      if (!session) return null;

      const { data, error } = await this.client.rpc('site_me');
      if (error) {
        console.warn('site_me RPC error:', error.message);
        return null;
      }

      return data as UserProfile;
    } catch (e) {
      console.error('Failed to verify user session with Supabase:', e);
      return null;
    }
  }

  /**
   * Load debate bank from Supabase site_debate_load RPC
   */
  public async loadDebateBank(codeOverride?: string): Promise<RemoteBankResponse | null> {
    const code = codeOverride !== undefined ? codeOverride : this.currentCode;

    try {
      const { data, error } = await this.client.rpc('site_debate_load', { p_code: code || '' });
      if (error) {
        console.warn('site_debate_load RPC returned error:', error.message);
      } else if (data && (data as RemoteBankResponse).data) {
        const bank = data as RemoteBankResponse;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bank.data));
            localStorage.setItem(BASE_KEY, String(bank.version));
          } catch (_) {}
        }
        return bank;
      }
    } catch (e) {
      console.warn('Network or remote error during site_debate_load:', e);
    }

    // Fallback to local storage if remote not reachable
    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.prosecutionQuestions)) {
            const ver = Number(localStorage.getItem(BASE_KEY) || 0);
            return {
              data: parsed,
              version: ver,
              updated_at: null,
              can_manage: false
            };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Save / Sync debate bank back to Supabase site_debate_save RPC
   */
  public async saveDebateBank(data: DebateData, codeOverride?: string): Promise<boolean> {
    const code = codeOverride !== undefined ? codeOverride : this.currentCode;
    try {
      const { error } = await this.client.rpc('site_debate_save', {
        p_code: code || '',
        p_data: data,
        p_version: null
      });

      if (error) {
        console.error('site_debate_save error:', error.message);
        return false;
      }

      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (_) {}
      }
      return true;
    } catch (e) {
      console.error('Failed to save debate bank to Supabase:', e);
      return false;
    }
  }
}
