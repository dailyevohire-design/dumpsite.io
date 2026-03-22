import { createAdminSupabase } from './supabase'

export async function createNotification(userId: string, opts: {
  type: string
  title: string
  message: string
  actionUrl?: string
}) {
  try {
    const supabase = createAdminSupabase()
    await supabase.from('driver_notifications').insert({
      user_id: userId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      action_url: opts.actionUrl || null,
    })
  } catch {}
}

export async function notifyDriversInCity(cityId: string, opts: {
  type: string
  title: string
  message: string
  actionUrl?: string
}) {
  try {
    const supabase = createAdminSupabase()
    const { data: drivers } = await supabase
      .from('driver_profiles')
      .select('user_id')
      .eq('city_id', cityId)
      .eq('status', 'active')
    if (!drivers?.length) return
    const rows = drivers.map(d => ({
      user_id: d.user_id,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      action_url: opts.actionUrl || null,
    }))
    await supabase.from('driver_notifications').insert(rows)
  } catch {}
}
