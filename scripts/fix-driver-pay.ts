import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'
import { getDriverPayCents, CITY_DRIVER_PAY_CENTS, DEFAULT_DRIVER_PAY_CENTS } from '../lib/driver-pay-rates'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Fix ALL dispatching orders to use the correct city flat rate.
 * Uses the centralized rate config from lib/driver-pay-rates.ts.
 */
async function fix() {
  const { data: orders, error } = await supabase
    .from('dispatch_orders')
    .select('id, driver_pay_cents, price_quoted_cents, cities(name)')
    .eq('status', 'dispatching')

  if (error) { console.error('Failed to fetch orders:', error); process.exit(1) }
  if (!orders?.length) { console.log('No dispatching orders found.'); return }

  console.log(`Found ${orders.length} dispatching orders:\n`)

  let fixed = 0
  let alreadyCorrect = 0

  for (const order of orders) {
    const cityName = (order.cities as any)?.name || 'unknown'
    const correctPay = getDriverPayCents(cityName)

    if (order.driver_pay_cents === correctPay) {
      alreadyCorrect++
      continue
    }

    console.log(`🔧 ${order.id} — ${cityName} — $${(order.driver_pay_cents || 0)/100} → $${correctPay/100}/load`)

    const { error: updateErr } = await supabase
      .from('dispatch_orders')
      .update({ driver_pay_cents: correctPay })
      .eq('id', order.id)

    if (updateErr) {
      console.error(`   ❌ Failed to update ${order.id}:`, updateErr)
    } else {
      console.log(`   ✅ Fixed`)
      fixed++
    }
  }

  console.log(`\nDone. Fixed: ${fixed}, Already correct: ${alreadyCorrect}, Total: ${orders.length}`)
}

fix()
