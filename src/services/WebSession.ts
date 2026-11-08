/**
 * Restores the website's Supabase session in the desktop app, using the token pair
 * the website hands over when the desktop is authorized. The website debate module
 * and the desktop app then share one login (same storage key, same client).
 */
import { db } from '../web/lib/db';
import { me } from '../web/lib/auth';

export interface HandedOverSession {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export async function restoreWebSession(s: HandedOverSession): Promise<boolean> {
  if (!s.accessToken || !s.refreshToken) return false;
  const { error } = await db().auth.setSession({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
  });
  if (error) {
    console.warn('Website session could not be restored', error.message);
    return false;
  }
  // Drop the cached account so the next read reflects the restored session.
  await me(true).catch(() => null);
  return true;
}
