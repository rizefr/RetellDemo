import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function insertRecord<T extends Record<string, unknown>>(
  table: string,
  record: T,
): Promise<{ persisted: boolean; data: Record<string, unknown> | null; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { persisted: false, data: null };

  const { data, error } = await client.from(table).insert(record).select("*").single();
  if (error) return { persisted: false, data: null, error: error.message };
  return { persisted: true, data: data as Record<string, unknown> };
}
