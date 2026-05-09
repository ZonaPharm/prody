import { createServerSupabaseClient } from '@/lib/supabase/server'

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

export async function logAction(entry: Omit<LogEntry, 'type'>) {
  try {
    const supabase = await createServerSupabaseClient()
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
    if (error) console.error('logAction failed:', error)
  } catch (e) { console.error('logAction failed:', e) }
}

export async function logAuth(entry: Omit<LogEntry, 'type'>) {
  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await (supabase.from('audit_logs') as any).insert({
      type: 'auth',
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      details: entry.details || null,
      status: entry.status || null,
      metadata: entry.metadata || null,
    })
    if (error) console.error('logAuth failed:', error)
  } catch (e) { console.error('logAuth failed:', e) }
}
