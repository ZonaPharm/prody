import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { tripSendSchema } from '@/lib/deliveries/schemas'
import { verifyDriverPassword } from '@/lib/deliveries/driver'
import { mayDrive } from '@/lib/roles'
import { notifyTripSent } from '@/lib/deliveries/notify'

/**
 * The driver signs that they took the boxes: their own account and password,
 * typed on the screen in Офис. Then the whole trip leaves Офис in one
 * transaction (send_trip): stock moves to the stores and sells there at once.
 * The admin who opened the screen is kept in the audit log.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Курсът не е намерен' }, { status: 404 })

  const body = await parseBody(request, tripSendSchema)
  if (!body.ok) return body.response
  const { driver_id, password } = body.data

  const admin = createAdminClient()
  const { data: driver } = await (admin.from('users') as any)
    .select('*')
    .eq('id', driver_id)
    .maybeSingle()
  if (!driver || driver.is_active === false) {
    return NextResponse.json({ error: 'Шофьорът не е намерен или акаунтът му е спрян' }, { status: 400 })
  }
  if (!mayDrive(driver)) {
    return NextResponse.json({ error: `${driver.display_name} няма роля Шофьор. Сложете я в Настройки → Потребители.` }, { status: 400 })
  }
  if (!(await verifyDriverPassword(driver.id, driver.email, password))) {
    return NextResponse.json({ error: `Грешна парола за ${driver.display_name}` }, { status: 400 })
  }

  const { data, error } = await (admin as any).rpc('send_trip', { p_trip_id: id, p_driver: driver.id })
  if (error) return rpcFailure('send_trip', error, 'Курсът не тръгна')
  await notifyTripSent(admin, id, driver.display_name)

  await logAction({
    action: 'trip_sent',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: id,
    details: `Шофьор ${driver.display_name}: ${data?.shipments ?? 0} пратки, ${data?.units ?? 0} бр.`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
