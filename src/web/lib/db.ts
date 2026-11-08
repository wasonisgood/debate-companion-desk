import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, storageKey: 'site-auth' },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

export interface Post {
  slug: string;
  title: string;
  dek: string;
  body_md: string;
  tags: string[];
  series?: string;
  published: boolean;
  published_at: string | null;
  views: number;
  updated_at?: string;
}
export type PostSummary = Omit<Post, 'body_md'> & { minutes: number };

export interface Note { id: number; post_slug: string; author: string; body: string; created_at: string; }
export interface BenchRow { id: number; handle: string; js_ms: number; wasm_ms: number; simd_ms: number; pool_ms: number; threads: number; ua: string; created_at: string; }
