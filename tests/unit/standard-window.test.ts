import { describe, it, expect } from 'vitest'
import { isWithinStandardWindow } from '../../lib/services/customer-pricing.service'

// Use a fixed reference date so tests are deterministic. Tuesday April 7 2026.
const TUE = new Date('2026-04-07T12:00:00')

describe('isWithinStandardWindow — the bug that started this', () => {
  it('"by Friday" said on Tuesday is within standard window (3 days out)', () => {
    expect(isWithinStandardWindow('by Friday', TUE)).toBe(true)
  })
  it('"Friday" said on Tuesday is within standard window', () => {
    expect(isWithinStandardWindow('friday', TUE)).toBe(true)
  })
  it('"this Friday" said on Tuesday is within standard window', () => {
    // 'this' isn't matched specifically, but the day-of-week extractor handles it
    expect(isWithinStandardWindow('this friday', TUE)).toBe(true)
  })
})

describe('truly urgent dates → NOT within standard window', () => {
  it('today', () => expect(isWithinStandardWindow('today', TUE)).toBe(false))
  it('tomorrow', () => expect(isWithinStandardWindow('tomorrow', TUE)).toBe(false))
  it('asap', () => expect(isWithinStandardWindow('asap', TUE)).toBe(false))
  it('right away', () => expect(isWithinStandardWindow('right away', TUE)).toBe(false))
  it('same day', () => expect(isWithinStandardWindow('same day', TUE)).toBe(false))
  it('day after tomorrow', () => expect(isWithinStandardWindow('day after tomorrow', TUE)).toBe(false))
  it('tonight', () => expect(isWithinStandardWindow('tonight', TUE)).toBe(false))
  it('Wednesday said on Tuesday (1 day out)', () => {
    expect(isWithinStandardWindow('wednesday', TUE)).toBe(false)
  })
  it('Thursday said on Tuesday (2 days out)', () => {
    expect(isWithinStandardWindow('thursday', TUE)).toBe(false)
  })
})

describe('flexible / future dates → within standard window', () => {
  it('flexible', () => expect(isWithinStandardWindow('flexible', TUE)).toBe(true))
  it('whenever', () => expect(isWithinStandardWindow('whenever', TUE)).toBe(true))
  it('no rush', () => expect(isWithinStandardWindow('no rush', TUE)).toBe(true))
  it('this week', () => expect(isWithinStandardWindow('this week', TUE)).toBe(true))
  it('next week', () => expect(isWithinStandardWindow('next week', TUE)).toBe(true))
  it('next month', () => expect(isWithinStandardWindow('next month', TUE)).toBe(true))
  it('in 2 weeks', () => expect(isWithinStandardWindow('in 2 weeks', TUE)).toBe(true))
  it('in a few weeks', () => expect(isWithinStandardWindow('in a few weeks', TUE)).toBe(true))
  it('end of the month', () => expect(isWithinStandardWindow('end of the month', TUE)).toBe(true))
  it('Saturday said on Tuesday (4 days out)', () => {
    expect(isWithinStandardWindow('saturday', TUE)).toBe(true)
  })
  it('Monday said on Tuesday (6 days out — next Monday)', () => {
    expect(isWithinStandardWindow('monday', TUE)).toBe(true)
  })
  it('Tuesday said on Tuesday (assumes next Tuesday, 7 days out)', () => {
    expect(isWithinStandardWindow('tuesday', TUE)).toBe(true)
  })
})

describe('numeric dates', () => {
  it('4/15 said on April 7 (8 days out)', () => {
    expect(isWithinStandardWindow('4/15', TUE)).toBe(true)
  })
  it('4/8 said on April 7 (1 day out)', () => {
    expect(isWithinStandardWindow('4/8', TUE)).toBe(false)
  })
  it('"April 20" said on April 7 (13 days out)', () => {
    expect(isWithinStandardWindow('April 20', TUE)).toBe(true)
  })
  it('"apr 9" said on April 7 (2 days out)', () => {
    expect(isWithinStandardWindow('apr 9', TUE)).toBe(false)
  })
})

describe('edge cases', () => {
  it('empty string → standard (treat as flexible)', () => {
    expect(isWithinStandardWindow('', TUE)).toBe(true)
  })
  it('garbled text → standard (default)', () => {
    expect(isWithinStandardWindow('zzzz', TUE)).toBe(true)
  })
  it('Spanish "manana" → urgent', () => {
    expect(isWithinStandardWindow('manana', TUE)).toBe(false)
  })
  it('Spanish "viernes" Tue (Friday, 3 days) → standard', () => {
    expect(isWithinStandardWindow('viernes', TUE)).toBe(true)
  })
})
