import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CITY_DRIVER_PAY: Record<string, number> = {
  'burleson': 6500,
  'mckinney': 6500,
  'plano': 6500,
  'dallas': 5000,
}

async function fix() {
  // Get all dispatching orders with their city names
  const { data: orders, error } = await supabase
    .from('dispatch_orders')
    .select('id, driver_pay_cents, price_quoted_cents, cities(name)')
    .eq('status', 'dispatching')

  if (error) { console.error('Failed to fetch orders:', error); process.exit(1) }
  if (!orders?.length) { console.log('No dispatching orders found.'); return }

  console.log(`Found ${orders.length} dispatching orders:\n`)

  for (const order of orders) {
    const cityName = (order.cities as any)?.name?.toLowerCase() || 'unknown'
    const correctPay = CITY_DRIVER_PAY[cityName]

    if (!correctPay) {
      console.log(`⚠️  ${order.id} — city "${cityName}" not in fix list, skipping`)
      continue
    }

    if (order.driver_pay_cents === correctPay) {
      console.log(`✓  ${order.id} — ${cityName} — already $${correctPay/100}/load`)
      continue
    }

    console.log(`🔧 ${order.id} — ${cityName} — $${order.driver_pay_cents/100} → $${correctPay/100}/load`)

    const { error: updateErr } = await supabase
      .from('dispatch_orders')
      .update({ driver_pay_cents: correctPay })
      .eq('id', order.id)

    if (updateErr) {
      console.error(`   ❌ Failed to update ${order.id}:`, updateErr)
    } else {
      console.log(`   ✅ Fixed`)
    }
  }

  console.log('\nDone.')
}

fix()
