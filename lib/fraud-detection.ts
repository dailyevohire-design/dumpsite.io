/**
 * Fraud Detection Engine for DumpSite.io
 *
 * Analyzes GPS ping data, timing, and completion location to detect
 * fraudulent load completions. Never blocks a driver — flags for admin review.
 */

export interface FraudAnalysis {
  fraudScore: number           // 0-100, higher = more suspicious
  flags: string[]              // list of specific fraud signals
  recommendation: 'approve' | 'flag' | 'reject'
  details: Record<string, any>
}

export interface PingData {
  lat: number
  lng: number
  recorded_at: string
  accuracy_meters?: number
  speed_kmh?: number
  distance_from_delivery_km?: number
  at_delivery_site?: boolean
}

/**
 * Haversine formula — distance between two GPS points in km.
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Analyze a load completion for fraud signals.
 * Uses GPS pings, timing, and location data.
 * Returns a score 0-100 and specific flags.
 */
export function analyzeForFraud(opts: {
  pings: PingData[]
  claimedLoads: number
  completionLat?: number
  completionLng?: number
  deliveryLat?: number
  deliveryLng?: number
  sessionStartedAt?: string
}): FraudAnalysis {
  const { pings, claimedLoads, completionLat, completionLng, deliveryLat, deliveryLng, sessionStartedAt } = opts
  const flags: string[] = []
  let fraudScore = 0

  const totalPings = pings.length
  const deliverySitePings = pings.filter(p => p.at_delivery_site).length

  // ── CHECK 1: No GPS data at all ────────────────────────────────────────
  if (totalPings === 0) {
    flags.push('NO_GPS_DATA: Zero location pings recorded')
    fraudScore += 30
  }

  // ── CHECK 2: Delivery site visits vs claimed loads ─────────────────────
  // Each load requires physically going to the delivery site at least once
  if (totalPings > 0 && deliveryLat != null && deliveryLng != null) {
    // Count distinct "visits" — a visit is a cluster of pings at the site
    // separated by at least 10 minutes of being away
    const visits = countDeliveryVisits(pings, deliveryLat, deliveryLng)
    if (visits < claimedLoads) {
      const ratio = visits / claimedLoads
      if (ratio < 0.5) {
        flags.push(`INSUFFICIENT_VISITS: Claimed ${claimedLoads} loads but only ${visits} delivery site visit(s) detected`)
        fraudScore += 40
      } else {
        flags.push(`LOW_VISIT_RATIO: ${visits} visit(s) for ${claimedLoads} claimed loads`)
        fraudScore += 15
      }
    }
  }

  // ── CHECK 3: Time analysis ─────────────────────────────────────────────
  // A dump truck round trip takes minimum ~30 minutes in DFW
  if (pings.length >= 2) {
    const firstTime = new Date(pings[0].recorded_at).getTime()
    const lastTime = new Date(pings[pings.length - 1].recorded_at).getTime()
    const totalMinutes = (lastTime - firstTime) / 60000
    const minRequired = claimedLoads * 30

    if (totalMinutes < minRequired && claimedLoads > 1) {
      flags.push(`IMPOSSIBLE_TIME: ${claimedLoads} loads claimed in ${Math.round(totalMinutes)} min (need ~${minRequired} min)`)
      fraudScore += 50
    }
  } else if (sessionStartedAt && claimedLoads > 1) {
    const sessionMinutes = (Date.now() - new Date(sessionStartedAt).getTime()) / 60000
    const minRequired = claimedLoads * 30
    if (sessionMinutes < minRequired) {
      flags.push(`IMPOSSIBLE_TIME: ${claimedLoads} loads claimed in ${Math.round(sessionMinutes)} min session`)
      fraudScore += 50
    }
  }

  // ── CHECK 4: Completion location vs delivery site ──────────────────────
  if (
    typeof completionLat === 'number' && typeof completionLng === 'number' &&
    typeof deliveryLat === 'number' && typeof deliveryLng === 'number'
  ) {
    const distance = haversineKm(completionLat, completionLng, deliveryLat, deliveryLng)
    if (distance > 50) {
      flags.push(`DISTANT_COMPLETION: Submitted ${Math.round(distance)}km from delivery site`)
      fraudScore += 35
    } else if (distance > 5) {
      flags.push(`OFFSITE_COMPLETION: Submitted ${Math.round(distance * 1000)}m from delivery site`)
      fraudScore += 15
    }
  }

  // ── CHECK 5: Suspiciously high load count ──────────────────────────────
  if (claimedLoads > 10) {
    flags.push(`HIGH_LOAD_COUNT: ${claimedLoads} loads claimed in single submission`)
    fraudScore += 20
  }

  // ── CHECK 6: GPS teleportation (impossible speed) ──────────────────────
  if (pings.length > 2) {
    for (let i = 1; i < pings.length; i++) {
      const prev = pings[i - 1]
      const curr = pings[i]
      const timeDiffMin = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 60000
      if (timeDiffMin <= 0) continue
      const dist = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng)
      const speedKmh = (dist / timeDiffMin) * 60

      if (speedKmh > 200 && timeDiffMin < 5) {
        flags.push(`GPS_TELEPORT: Jumped ${Math.round(dist)}km in ${Math.round(timeDiffMin)} min (${Math.round(speedKmh)} km/h)`)
        fraudScore += 45
        break // one teleport flag is enough
      }
    }
  }

  // Cap at 100
  fraudScore = Math.min(fraudScore, 100)

  let recommendation: 'approve' | 'flag' | 'reject'
  if (fraudScore >= 70) recommendation = 'reject'
  else if (fraudScore >= 30) recommendation = 'flag'
  else recommendation = 'approve'

  return {
    fraudScore,
    flags,
    recommendation,
    details: {
      totalPings,
      deliverySitePings,
      claimedLoads,
    },
  }
}

/**
 * Count distinct delivery site visits from pings.
 * A "visit" = consecutive pings within 0.5km of delivery site.
 * Two visits must be separated by at least 10 min of being away.
 */
function countDeliveryVisits(
  pings: PingData[],
  deliveryLat: number,
  deliveryLng: number
): number {
  const THRESHOLD_KM = 0.5
  let visits = 0
  let wasAtSite = false
  let lastDepartureTime = 0

  for (const p of pings) {
    const dist = haversineKm(p.lat, p.lng, deliveryLat, deliveryLng)
    const atSite = dist <= THRESHOLD_KM
    const time = new Date(p.recorded_at).getTime()

    if (atSite && !wasAtSite) {
      // Arrived — count as new visit if >10 min since last departure
      if (visits === 0 || (time - lastDepartureTime) > 10 * 60 * 1000) {
        visits++
      }
    } else if (!atSite && wasAtSite) {
      lastDepartureTime = time
    }
    wasAtSite = atSite
  }

  return visits
}
