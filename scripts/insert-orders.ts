import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── STEP 1: Query existing data ──────────────────────────────────────────
async function auditExisting() {
  console.log('\n═══ STEP 1: EXISTING DISPATCH ORDERS ═══\n')
  const { data: orders, error } = await supabase
    .from('dispatch_orders')
    .select('id, client_name, client_address, city_id, yards_needed, status, created_at, truck_type_needed, driver_pay_cents')
    .order('created_at', { ascending: false })

  if (error) { console.error('Error fetching orders:', error); return null }
  console.log(`Total existing orders: ${orders?.length || 0}`)
  for (const o of (orders || [])) {
    console.log(`  ${o.client_name || 'N/A'} | ${o.client_address || 'N/A'} | ${o.yards_needed}yd | ${o.status} | truck: ${o.truck_type_needed || 'null'} | $${(o.driver_pay_cents||0)/100}/load`)
  }

  console.log('\n═══ CITIES TABLE ═══\n')
  const { data: cities, error: cErr } = await supabase
    .from('cities')
    .select('id, name')
    .order('name')

  if (cErr) { console.error('Error fetching cities:', cErr); return null }
  for (const c of (cities || [])) {
    console.log(`  ${c.name} → ${c.id}`)
  }

  return { orders: orders || [], cities: cities || [] }
}

// ── STEP 2: Check duplicates ─────────────────────────────────────────────
function checkDuplicates(existingOrders: any[], newAddresses: string[]) {
  console.log('\n═══ STEP 2: DUPLICATE CHECK ═══\n')
  const existingAddrsLower = existingOrders.map((o: any) => (o.client_address || '').toLowerCase().trim())

  const dupes: string[] = []
  const fresh: string[] = []

  for (const addr of newAddresses) {
    const addrLower = addr.toLowerCase().trim()
    // Fuzzy match — check if the street portion matches
    const isDupe = existingAddrsLower.some(ea => {
      if (!ea) return false
      // Exact match
      if (ea === addrLower) return true
      // Check if key parts match (street number + street name)
      const aWords = addrLower.split(/[\s,]+/).filter((w: string) => w.length > 1)
      const eWords = ea.split(/[\s,]+/).filter((w: string) => w.length > 1)
      // Match if first 3 significant words match
      const aKey = aWords.slice(0, 3).join(' ')
      const eKey = eWords.slice(0, 3).join(' ')
      return aKey === eKey && aKey.length > 5
    })
    if (isDupe) {
      dupes.push(addr)
      console.log(`  DUPLICATE: ${addr}`)
    } else {
      fresh.push(addr)
      console.log(`  NEW: ${addr}`)
    }
  }

  console.log(`\nDuplicates: ${dupes.length}, New: ${fresh.length}`)
  return { dupes, fresh }
}

// ── STEP 3-5: Build and insert orders ────────────────────────────────────
interface OrderInput {
  client_name: string
  client_phone: string
  client_address: string
  city_name: string
  yards_needed: number
  driver_pay_cents: number
  truck_type_needed: string
  notes: string
}

function lookupCityId(cityName: string, cities: any[]): string | null {
  // Direct case-insensitive match
  const direct = cities.find(c => c.name.toLowerCase() === cityName.toLowerCase())
  if (direct) return direct.id

  // Partial match
  const partial = cities.find(c =>
    c.name.toLowerCase().includes(cityName.toLowerCase()) ||
    cityName.toLowerCase().includes(c.name.toLowerCase())
  )
  if (partial) {
    console.log(`  City fuzzy match: "${cityName}" → "${partial.name}"`)
    return partial.id
  }

  return null
}

const orders: OrderInput[] = [
  { client_name: 'Bobby', client_phone: '501-658-3565', client_address: '1120 Raglan Ct Midlothian TX 76065', city_name: 'Midlothian', yards_needed: 24, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Bobby — 24 yds, $180/12yd' },
  { client_name: 'Sonal', client_phone: '682-259-9005', client_address: '8856 Oakville St Fort Worth TX 76244', city_name: 'Fort Worth', yards_needed: 512, driver_pay_cents: 14400, truck_type_needed: 'end_dump', notes: 'Sonal — 512 yd, $144/12yd, OVER 100 YDS' },
  { client_name: 'Otto', client_phone: '972-489-2841', client_address: '2109 Newt Patterson Rd Mansfield TX 76063', city_name: 'Mansfield', yards_needed: 136, driver_pay_cents: 14400, truck_type_needed: 'end_dump', notes: 'Otto — 136 yd, $144/12yd, OVER 100 YDS' },
  { client_name: 'Chad', client_phone: '817-676-7467', client_address: '6816 Sundance Circle Joshua TX 76058', city_name: 'Joshua', yards_needed: 24, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Chad — 24 yd, $180/12yd' },
  { client_name: 'Claudio', client_phone: '469-350-2914', client_address: '926 S Bluebird Ln Midlothian TX', city_name: 'Midlothian', yards_needed: 48, driver_pay_cents: 16000, truck_type_needed: 'tandem_axle', notes: 'Claudio — 48 yd, $160/12yd' },
  { client_name: 'Magaly', client_phone: '817-891-6404', client_address: 'Everman TX', city_name: 'Everman', yards_needed: 20, driver_pay_cents: 24000, truck_type_needed: 'tandem_axle', notes: 'Magaly — 20 yds, $240/20yd' },
  { client_name: 'John', client_phone: '817-766-0441', client_address: '129 Briar Meadows Circle Azle TX 76020', city_name: 'Azle', yards_needed: 100, driver_pay_cents: 14400, truck_type_needed: 'end_dump', notes: 'John — 100 yds, $144/12yd, BORDERLINE 100 YDS → end_dump' },
  { client_name: 'Tyler', client_phone: '817-932-2461', client_address: '401 N Bowen Rd Arlington TX 76012', city_name: 'Arlington', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Tyler — 12 yds, $144/12yd' },
  { client_name: 'Stephen', client_phone: '214-732-2254', client_address: '9531 Hackamore Ct Justin TX', city_name: 'Justin', yards_needed: 70, driver_pay_cents: 15000, truck_type_needed: 'tandem_axle', notes: 'Stephen — 60-80 yd (midpoint 70), $150/12yd' },
  { client_name: 'Saado', client_phone: '972-799-1776', client_address: 'Carrollton TX', city_name: 'Carrollton', yards_needed: 100, driver_pay_cents: 17500, truck_type_needed: 'end_dump', notes: 'Saado — 100 yards, $175/12yd, BORDERLINE 100 YDS → end_dump' },
  { client_name: 'Jamie', client_phone: '214-674-8257', client_address: '3038 S Denley Dr Dallas TX', city_name: 'Dallas', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Jamie — 12 yd, $144/12yd (appears twice in list — inserted once)' },
  { client_name: 'Uzaifa', client_phone: '972-891-1678', client_address: '212 W Madison St Hillsboro TX', city_name: 'Hillsboro', yards_needed: 96, driver_pay_cents: 15600, truck_type_needed: 'tandem_axle', notes: 'Uzaifa — 96 yd (8 loads x 12yd), $156/12yd ($13/yd x 12)' },
  { client_name: 'Dan', client_phone: '682-667-6261', client_address: '110 Inwood Trail Azle TX 76020', city_name: 'Azle', yards_needed: 18, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Dan — 12-24 yd (midpoint 18), $144/12yd' },
  { client_name: 'Luke', client_phone: '817-583-1711', client_address: '541 Daisy Rd Midlothian TX', city_name: 'Midlothian', yards_needed: 12, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Luke — 12 yd, $180/12yd' },
  { client_name: 'Gonzalo', client_phone: '972-672-8268', client_address: '625 Crockett Street Grand Prairie TX', city_name: 'Grand Prairie', yards_needed: 18, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Gonzalo — 12-24 yd (midpoint 18), $144/12yd' },
  { client_name: 'Kasha', client_phone: '702-371-3611', client_address: '620 Old Stoney Ct Ponder TX', city_name: 'Ponder', yards_needed: 90, driver_pay_cents: 15000, truck_type_needed: 'tandem_axle', notes: 'Kasha — 80-100 yd (midpoint 90), $150/12yd' },
  { client_name: 'Spencer', client_phone: '972-971-2735', client_address: '1208 Bluff View Dr Hutchins TX 75141', city_name: 'Hutchins', yards_needed: 20, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Spencer — 20yd, $144/12yd' },
  { client_name: 'BJ', client_phone: '817-522-8755', client_address: '9104 Fossil Ridge Dr TX 75104', city_name: 'Cedar Hill', yards_needed: 20, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'BJ — 20 yd, $144/12yd, zip 75104 = Cedar Hill area' },
  { client_name: 'Chi-Jim', client_phone: '817-592-4555', client_address: '4124 Buckwheat St Fort Worth TX', city_name: 'Fort Worth', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Chi-Jim — 12 yd, $144/12yd' },
  { client_name: 'Becky', client_phone: '806-292-3067', client_address: '1625 Main St Matador TX 79244', city_name: 'Matador', yards_needed: 12, driver_pay_cents: 20400, truck_type_needed: 'tandem_axle', notes: 'Becky — 12 yd, $204/12yd, Matador TX far from DFW' },
  { client_name: 'Ruben', client_phone: '817-896-0615', client_address: '2401 Chimney Hill Dr Arlington TX 76012', city_name: 'Arlington', yards_needed: 100, driver_pay_cents: 14400, truck_type_needed: 'end_dump', notes: 'Ruben — 100 yds, $144/12yd, BORDERLINE 100 YDS → end_dump' },
  { client_name: 'Scott', client_phone: '817-240-2968', client_address: '2932 County Rd 312 Cleburne TX', city_name: 'Cleburne', yards_needed: 750, driver_pay_cents: 12000, truck_type_needed: 'end_dump', notes: 'Scott — 750 yds, $120/12yd ($10/yd x 12), OVER 100 YDS' },
  { client_name: 'Reed', client_phone: '817-269-6003', client_address: '605 N East St Arlington TX 76011', city_name: 'Arlington', yards_needed: 20, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Reed — 20 yds, $144/12yd' },
  { client_name: 'Austin', client_phone: '719-240-3992', client_address: '218 High Meadows Loop Elizabeth TX', city_name: 'Elizabeth', yards_needed: 48, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Austin — 4-5 loads x 12 (48 yd), $180/12yd' },
  { client_name: 'James', client_phone: '405-740-5572', client_address: '1587 Hillcrest Circle Gordonville TX', city_name: 'Gordonville', yards_needed: 240, driver_pay_cents: 18000, truck_type_needed: 'end_dump', notes: 'James — 20 loads x 12 (240 yd), $180/12yd ($15/yd x 12), OVER 100 YDS' },
  { client_name: 'Gary', client_phone: '214-679-3575', client_address: '1203 Plantation Drive Colleyville TX', city_name: 'Colleyville', yards_needed: 24, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Gary — 24 yd, $144/12yd' },
  { client_name: 'Lesly', client_phone: '214-715-3403', client_address: '2635 Tealford Dr Dallas TX 75228', city_name: 'Dallas', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Lesly — 12yd, $144/12yd' },
  { client_name: 'Isay', client_phone: '469-254-1449', client_address: 'Venus TX', city_name: 'Venus', yards_needed: 12, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Isay — 12 yd, $180/12yd' },
  { client_name: 'Jorge', client_phone: '817-789-8983', client_address: '4401 Lon Stevenson Rd Fort Worth TX 76140', city_name: 'Fort Worth', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Jorge — 12 yd, $144/12yd' },
  { client_name: 'CJ', client_phone: '214-395-0282', client_address: '3607 Carpenter Ave Dallas TX', city_name: 'Dallas', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'CJ — 12 yd, $144/12yd' },
  { client_name: 'Todd', client_phone: '817-243-2596', client_address: '905 Barry Lane Cleburne TX', city_name: 'Cleburne', yards_needed: 40, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Todd — 40yd, $180/12yd ($15/yd x 12)' },
  { client_name: 'Osborne', client_phone: '817-269-7487', client_address: '5512 Royal Meadow Ln Arlington TX', city_name: 'Arlington', yards_needed: 12, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Osborne — 12 yd, $144/12yd' },
  { client_name: 'Victor', client_phone: '817-889-1382', client_address: '101 County Rd 1114 Blum TX 76627', city_name: 'Blum', yards_needed: 60, driver_pay_cents: 14400, truck_type_needed: 'tandem_axle', notes: 'Victor — 60yd, $144/12yd (standard price)' },
  { client_name: 'Joel', client_phone: '972-757-1582', client_address: '1141 CR 208 Gainesville TX', city_name: 'Gainesville', yards_needed: 12, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Joel — 12 yd, $180/12yd' },
  { client_name: 'Krystal', client_phone: '817-449-4734', client_address: '1518 Grey Willow Ln Arlington TX', city_name: 'Arlington', yards_needed: 12, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Krystal — 12 yd, $180/12yd' },
  { client_name: 'Edgar', client_phone: '214-874-1283', client_address: '4709 Drexler Highland Park TX', city_name: 'Highland Park', yards_needed: 100, driver_pay_cents: 14400, truck_type_needed: 'end_dump', notes: 'Edgar — 100 yd, $144/12yd ($12/yd x 12), BORDERLINE 100 YDS → end_dump' },
  { client_name: 'Trieu', client_phone: '682-358-4838', client_address: '660 Seeton Rd TX 75054', city_name: 'Grand Prairie', yards_needed: 20, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Trieu — 20 yd, $180/12yd ($15/yd x 12), zip 75054 = Grand Prairie area' },
  { client_name: 'Jessica', client_phone: '817-692-2996', client_address: '1789 CR 4698 Boyd TX 76023', city_name: 'Boyd', yards_needed: 20, driver_pay_cents: 18000, truck_type_needed: 'tandem_axle', notes: 'Jessica — 20yd, $180/12yd ($15/yd x 12)' },
]

// SKIPPED orders (per instructions):
// - Winter 338 Wildbriar Garland — DELIVERED
// - Dave 303 Stallings St Terrell — DELIVERED
// - Trevor Thorp — no street address
// - Trey 4210 Leonard rd Bryan TX — outside DFW (flagged)

async function insertOrders(existingOrders: any[], cities: any[]) {
  console.log('\n═══ STEP 2-5: DUPLICATE CHECK + INSERT ═══\n')

  const existingAddrsLower = existingOrders.map(o => (o.client_address || '').toLowerCase().replace(/[.,]/g, '').trim())

  let inserted = 0
  let skipped = 0
  let cityMissing: string[] = []
  const endDumpCount = orders.filter(o => o.truck_type_needed === 'end_dump').length

  for (const order of orders) {
    const addrLower = order.client_address.toLowerCase().replace(/[.,]/g, '').trim()

    // Check duplicates by matching key address parts
    const isDupe = existingAddrsLower.some(ea => {
      if (!ea) return false
      if (ea === addrLower) return true
      // Extract street number + first words
      const aWords = addrLower.split(/\s+/).slice(0, 3).join(' ')
      const eWords = ea.split(/\s+/).slice(0, 3).join(' ')
      return aWords === eWords && aWords.length > 5
    })

    if (isDupe) {
      console.log(`  SKIP (duplicate): ${order.client_name} — ${order.client_address}`)
      skipped++
      continue
    }

    // Look up city
    let cityId = lookupCityId(order.city_name, cities)
    if (!cityId) {
      // Try closest DFW city
      const fallbacks = ['Fort Worth', 'Dallas', 'Arlington']
      for (const fb of fallbacks) {
        cityId = lookupCityId(fb, cities)
        if (cityId) {
          console.log(`  City "${order.city_name}" not found — fallback to "${fb}"`)
          cityMissing.push(`${order.client_name}: ${order.city_name} → ${fb}`)
          break
        }
      }
    }

    if (!cityId) {
      console.error(`  ERROR: No city found for ${order.client_name} — ${order.city_name}`)
      cityMissing.push(`${order.client_name}: ${order.city_name} → NO MATCH`)
      continue
    }

    const insertData = {
      client_name: order.client_name,
      client_phone: order.client_phone,
      client_address: order.client_address,
      city_id: cityId,
      yards_needed: order.yards_needed,
      price_quoted_cents: order.driver_pay_cents,
      driver_pay_cents: order.driver_pay_cents,
      truck_type_needed: order.truck_type_needed,
      urgency: 'standard',
      status: 'dispatching',
      source: 'manual',
      notes: order.notes,
    }

    const { error } = await supabase.from('dispatch_orders').insert(insertData)
    if (error) {
      console.error(`  INSERT ERROR for ${order.client_name}: ${error.message}`)
    } else {
      console.log(`  INSERTED: ${order.client_name} — ${order.client_address} — ${order.yards_needed}yd — $${order.driver_pay_cents/100}/load — ${order.truck_type_needed}`)
      inserted++
    }
  }

  console.log(`\n═══ INSERT SUMMARY ═══`)
  console.log(`Inserted: ${inserted}`)
  console.log(`Skipped (duplicates): ${skipped}`)
  console.log(`Orders with end_dump access: ${endDumpCount}`)
  if (cityMissing.length > 0) {
    console.log(`City mismatches:`)
    cityMissing.forEach(c => console.log(`  ${c}`))
  }

  return { inserted, skipped, endDumpCount, cityMissing }
}

// ── STEP 7: Update existing orders over 100 yds ─────────────────────────
async function updateEndDump() {
  console.log('\n═══ STEP 7: UPDATE EXISTING ORDERS ≥100 YDS ═══\n')
  const { data, error } = await supabase
    .from('dispatch_orders')
    .update({ truck_type_needed: 'end_dump' })
    .gte('yards_needed', 100)
    .eq('status', 'dispatching')
    .or('truck_type_needed.is.null,truck_type_needed.eq.tandem_axle')
    .select('id, client_name, yards_needed')

  if (error) {
    console.error('Update error:', error)
  } else {
    console.log(`Updated ${data?.length || 0} orders to end_dump:`)
    for (const o of (data || [])) {
      console.log(`  ${o.client_name} — ${o.yards_needed}yd`)
    }
  }
}

// ── STEP 8: Final verification ───────────────────────────────────────────
async function verify() {
  console.log('\n═══ STEP 8: FINAL VERIFICATION ═══\n')
  const { data, error } = await supabase
    .from('dispatch_orders')
    .select('client_name, client_address, yards_needed, truck_type_needed, driver_pay_cents, status, created_at')
    .eq('status', 'dispatching')
    .order('yards_needed', { ascending: false })

  if (error) { console.error('Verify error:', error); return }

  console.log(`Total dispatching orders: ${data?.length || 0}\n`)
  for (const o of (data || [])) {
    console.log(`  ${(o.client_name || 'N/A').padEnd(12)} | ${(o.client_address || 'N/A').padEnd(45)} | ${String(o.yards_needed).padStart(4)}yd | ${(o.truck_type_needed || 'null').padEnd(12)} | $${((o.driver_pay_cents||0)/100).toFixed(0)}/load`)
  }

  const endDumps = (data || []).filter(o => o.truck_type_needed === 'end_dump')
  console.log(`\nOrders with end_dump access: ${endDumps.length}`)
}

// ── RUN ──────────────────────────────────────────────────────────────────
async function main() {
  const existing = await auditExisting()
  if (!existing) { console.error('Failed to audit'); process.exit(1) }

  await insertOrders(existing.orders, existing.cities)
  await updateEndDump()
  await verify()

  console.log('\n═══ FLAGGED: Trey 4210 Leonard Rd Bryan TX — OUTSIDE DFW, not inserted. Confirm with owner. ═══')
  console.log('═══ SKIPPED: Winter (DELIVERED), Dave (DELIVERED), Trevor (no address) ═══')
}

main().catch(console.error)
