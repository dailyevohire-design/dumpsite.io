import { describe, it, expect } from 'vitest'
import { classifyTwilioError, isRetryable, shouldFallBackToDefault } from '../../lib/services/twilio-errors'

describe('classifyTwilioError', () => {
  it('classifies 21606 as permanent_from_invalid', () => {
    const c = classifyTwilioError(21606)
    expect(c.class).toBe('permanent_from_invalid')
    expect(c.hint).toMatch(/SMS-capable/)
  })

  it('classifies 21659 (messaging service required) as permanent_from_invalid', () => {
    expect(classifyTwilioError(21659).class).toBe('permanent_from_invalid')
  })

  it('classifies 30007 (A2P unregistered) as permanent_from_invalid', () => {
    const c = classifyTwilioError(30007)
    expect(c.class).toBe('permanent_from_invalid')
    expect(c.hint).toMatch(/A2P/)
  })

  it('classifies 21408 (geo permission) as permanent_from_invalid', () => {
    expect(classifyTwilioError(21408).class).toBe('permanent_from_invalid')
  })

  it('classifies 21610 (STOP) as permanent_to_blocked', () => {
    expect(classifyTwilioError(21610).class).toBe('permanent_to_blocked')
  })

  it('classifies 20429 (rate limit) as transient', () => {
    expect(classifyTwilioError(20429).class).toBe('transient')
  })

  it('classifies 20500 (Twilio 5xx) as transient', () => {
    expect(classifyTwilioError(20500).class).toBe('transient')
  })

  it('classifies unknown codes as permanent_other (fail safe)', () => {
    const c = classifyTwilioError(99999)
    expect(c.class).toBe('permanent_other')
    expect(c.hint).toMatch(/Unknown/)
  })

  it('handles string error codes from Twilio JSON', () => {
    expect(classifyTwilioError('21606').class).toBe('permanent_from_invalid')
  })

  it('handles null/undefined as permanent_other', () => {
    expect(classifyTwilioError(null).class).toBe('permanent_other')
    expect(classifyTwilioError(undefined).class).toBe('permanent_other')
  })
})

describe('isRetryable', () => {
  it('only transient errors are retryable', () => {
    expect(isRetryable(classifyTwilioError(20429))).toBe(true)
    expect(isRetryable(classifyTwilioError(21606))).toBe(false)
    expect(isRetryable(classifyTwilioError(30007))).toBe(false)
    expect(isRetryable(classifyTwilioError(21610))).toBe(false)
    expect(isRetryable(classifyTwilioError(99999))).toBe(false)
  })
})

describe('shouldFallBackToDefault', () => {
  it('only falls back on transient errors', () => {
    // The whole point of the bug fix: never fall back on permanent errors,
    // because that would silently send from the wrong number.
    expect(shouldFallBackToDefault(classifyTwilioError(20429))).toBe(true)
    expect(shouldFallBackToDefault(classifyTwilioError(21606))).toBe(false)
    expect(shouldFallBackToDefault(classifyTwilioError(21659))).toBe(false)
    expect(shouldFallBackToDefault(classifyTwilioError(30007))).toBe(false)
    expect(shouldFallBackToDefault(classifyTwilioError(21408))).toBe(false)
    expect(shouldFallBackToDefault(classifyTwilioError(21610))).toBe(false)
    expect(shouldFallBackToDefault(classifyTwilioError(99999))).toBe(false)
  })
})
