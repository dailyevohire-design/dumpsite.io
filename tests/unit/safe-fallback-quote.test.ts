import { describe, it, expect } from 'vitest'
import { safeFallbackQuote } from '../../lib/services/customer-pricing.service'

describe('safeFallbackQuote', () => {
  it('always returns a usable quote with no distance hint (defaults to zone B)', () => {
    const q = safeFallbackQuote('fill_dirt', 20, 'no_coordinates')
    expect(q).not.toBeNull()
    expect(q.zone).toBe('B')
    expect(q.perYardCents).toBe(1500)        // $15/yd zone B base
    expect(q.totalCents).toBe(30000)         // 20 × $15 (no small-load fee — exactly 20 yards)
    expect(q.smallLoadFeeCents).toBe(0)      // 20+ yards = no fee
    expect(q.billableYards).toBe(20)
    expect(q.isFallback).toBe(true)
    expect(q.reason).toBe('no_coordinates')
  })

  it('enforces 10-yard minimum AND charges small-load fee', () => {
    const q = safeFallbackQuote('fill_dirt', 5, 'no_coordinates')
    expect(q.billableYards).toBe(10)
    expect(q.dirtSubtotalCents).toBe(15000)  // 10 × $15
    expect(q.smallLoadFeeCents).toBe(5000)   // +$50 small-load fee
    expect(q.totalCents).toBe(20000)         // dirt + fee
  })

  it('applies material surcharge for screened topsoil (+$5/yd) plus small-load fee', () => {
    const q = safeFallbackQuote('screened_topsoil', 10, 'no_coordinates')
    expect(q.perYardCents).toBe(2000)        // $15 + $5
    expect(q.dirtSubtotalCents).toBe(20000)  // 10 × $20
    expect(q.smallLoadFeeCents).toBe(5000)   // small-load fee (under 20yds)
    expect(q.totalCents).toBe(25000)         // dirt + fee
  })

  it('applies structural fill surcharge (+$8/yd)', () => {
    const q = safeFallbackQuote('structural_fill', 10, 'pricing_engine_error')
    expect(q.perYardCents).toBe(2300)        // $15 + $8
  })

  it('applies sand surcharge (+$6/yd)', () => {
    const q = safeFallbackQuote('sand', 10, 'no_coordinates')
    expect(q.perYardCents).toBe(2100)        // $15 + $6
  })

  it('NO small-load fee for orders 20+ yards', () => {
    const q = safeFallbackQuote('fill_dirt', 20, 'no_coordinates')
    expect(q.smallLoadFeeCents).toBe(0)
    expect(q.totalCents).toBe(30000)         // 20 × $15
  })

  it('charges small-load fee for 19 yards (just under threshold)', () => {
    const q = safeFallbackQuote('fill_dirt', 19, 'no_coordinates')
    expect(q.smallLoadFeeCents).toBe(5000)
    expect(q.dirtSubtotalCents).toBe(28500)  // 19 × $15
    expect(q.totalCents).toBe(33500)
  })

  it('uses zone A pricing when distance hint is in zone A range', () => {
    const q = safeFallbackQuote('fill_dirt', 10, 'pricing_engine_error', 5)
    expect(q.zone).toBe('A')
    expect(q.perYardCents).toBe(1200)        // $12/yd zone A
  })

  it('uses zone B pricing when distance hint is in zone B range', () => {
    const q = safeFallbackQuote('fill_dirt', 10, 'pricing_engine_error', 30)
    expect(q.zone).toBe('B')
    expect(q.perYardCents).toBe(1500)
  })

  it('uses zone C pricing when distance hint is in zone C range', () => {
    const q = safeFallbackQuote('fill_dirt', 10, 'outside_service_area', 55)
    expect(q.zone).toBe('C')
    expect(q.perYardCents).toBe(1800)        // $18/yd zone C
  })

  it('falls back to zone B when distance hint is outside all zones', () => {
    // 100 miles is past zone C, no zone match — defaults to B
    const q = safeFallbackQuote('fill_dirt', 10, 'outside_service_area', 100)
    expect(q.zone).toBe('B')
  })

  it('marks the reason on every fallback quote', () => {
    expect(safeFallbackQuote('fill_dirt', 10, 'no_coordinates').reason).toBe('no_coordinates')
    expect(safeFallbackQuote('fill_dirt', 10, 'outside_service_area').reason).toBe('outside_service_area')
    expect(safeFallbackQuote('fill_dirt', 10, 'pricing_engine_error').reason).toBe('pricing_engine_error')
  })

  it('NEVER returns null no matter how absurd the input', () => {
    expect(safeFallbackQuote('', 0, 'no_coordinates')).not.toBeNull()
    expect(safeFallbackQuote('weird_unknown_material', 999999, 'pricing_engine_error')).not.toBeNull()
    expect(safeFallbackQuote('fill_dirt', -5, 'no_coordinates')).not.toBeNull() // min-yards clamps
  })
})
