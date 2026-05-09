import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

interface LogEntry {
  type: 'action' | 'auth'
  action: string
  userId?: string
  userName?: string
  entityType?: string
  entityId?: string
  details?: string
  metadata?: any
  status?: string
}

export async function logAction(
  entry: Omit<LogEntry, 'type'>,
  client?: SupabaseClient<Database>
) {
  try {
    const supabase = client || await createServerSupabaseClient()
    const { error } = await (supabase.from('audit_logs') as any).insert({
      type: 'action',
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId || null,
      details: entry.details || null,
      metadata: entry.metadata || null,
    })
    if (error) console.error('logAction failed:', JSON.stringify(error))
  } catch (e) { console.error('logAction failed:', e) }
}

export async function logAuth(
  entry: Omit<LogEntry, 'type'>,
  client?: SupabaseClient<Database>
) {
  try {
    const supabase = client || await createServerSupabaseClient()
    const { error } = await (supabase.from('audit_logs') as any).insert({
      type: 'auth',
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      details: entry.details || null,
      status: entry.status || null,
      metadata: entry.metadata || null,
    })
    if (error) console.error('logAuth failed:', JSON.stringify(error))
  } catch (e) { console.error('logAuth failed:', e) }
}
