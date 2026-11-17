import { createAdminClient } from '@/lib/supabase/admin'

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

/**
 * Writes one line to the activity log (audit_logs).
 *
 * Always through the server key. audit_logs lets only admins write through
 * their own session, and most callers used to pass the user's session: every
 * action by a store, by the Office or by an assistant user who is not an admin
 * was refused (42501) and lost, with only a line in Vercel's one-hour log.
 * The caller has already checked who the user is; this only records it.
 *
 * Never throws: a log line that cannot be written must not undo or fail the
 * action it describes.
 */
export async function logAction(entry: Omit<LogEntry, 'type'>) {
  await insertLog({ ...entry, type: 'action' })
}

export async function logAuth(entry: Omit<LogEntry, 'type'>) {
  await insertLog({ ...entry, type: 'auth' })
}

async function insertLog(entry: LogEntry) {
  try {
    const admin = createAdminClient()
    const { error } = await (admin.from('audit_logs') as any).insert({
      type: entry.type,
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId || null,
      details: entry.details || null,
      metadata: entry.metadata || null,
      status: entry.status || null,
    })
    if (error) console.error(`audit log (${entry.action}) failed:`, JSON.stringify(error))
  } catch (e) { console.error(`audit log (${entry.action}) failed:`, e) }
}
