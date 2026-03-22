// Required env vars:
// VAPID_PUBLIC_KEY — public VAPID key for push subscriptions
// VAPID_PRIVATE_KEY — private VAPID key for sending
// VAPID_EMAIL — e.g. mailto:admin@dumpsite.io

import { createAdminSupabase } from './supabase'

let webPushConfigured = false
let webPush: any = null

async function getWebPush() {
  if (webPush) return webPush
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@dumpsite.io'
  if (!publicKey || !privateKey) return null

  try {
    const wp = await import('web-push')
    wp.setVapidDetails(email, publicKey, privateKey)
    webPush = wp
    webPushConfigured = true
    return wp
  } catch {
    return null
  }
}

export async function sendPushToCity(cityId: string, title: string, body: string, url: string) {
  try {
    const wp = await getWebPush()
    if (!wp) return { sent: 0, failed: 0 }

    const supabase = createAdminSupabase()

    // Get active drivers in this city with push subscriptions
    const { data: drivers } = await supabase
      .from('driver_profiles')
      .select('user_id')
      .eq('city_id', cityId)
      .eq('status', 'active')

    if (!drivers || drivers.length === 0) return { sent: 0, failed: 0 }

    const driverIds = drivers.map(d => d.user_id)
    const { data: subs } = await supabase
      .from('driver_push_subscriptions')
      .select('id, user_id, subscription_json')
      .in('user_id', driverIds)

    if (!subs || subs.length === 0) return { sent: 0, failed: 0 }

    let sent = 0
    let failed = 0
    const payload = JSON.stringify({ title, body, url })

    for (const sub of subs) {
      try {
        await wp.sendNotification(sub.subscription_json, payload)
        sent++
      } catch (err: any) {
        // 410 Gone = subscription expired, clean up
        if (err?.statusCode === 410) {
          await supabase.from('driver_push_subscriptions').delete().eq('id', sub.id)
        }
        failed++
      }
    }

    return { sent, failed }
  } catch (e: any) {
    console.error('Push notification error:', e.message)
    return { sent: 0, failed: 0 }
  }
}
