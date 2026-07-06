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

export async function selectRecentRecords(
  table: string,
  columns = "*",
  limit = 25,
): Promise<{ configured: boolean; data: Record<string, unknown>[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { configured: false, data: [] };
  const { data, error } = await client
    .from(table)
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { configured: true, data: [], error: error.message };
  return { configured: true, data: (data ?? []) as unknown as Record<string, unknown>[] };
}

export async function countTable(
  table: string,
): Promise<{ configured: boolean; reachable: boolean; count: number | null; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { configured: false, reachable: false, count: null };
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) return { configured: true, reachable: false, count: null, error: error.message };
  return { configured: true, reachable: true, count: count ?? 0 };
}
