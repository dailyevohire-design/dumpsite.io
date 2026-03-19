import { describe, it, expect } from 'vitest'

describe('SMS phone normalization', () => {
  const normalize = (phone: string) =>
    phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, '')

  it('normalizes 10-digit to E.164', () => {
    expect(normalize('5125551234')).toBe('+15125551234')
  })

  it('leaves E.164 unchanged', () => {
    expect(normalize('+15125551234')).toBe('+15125551234')
  })

  it('strips dashes', () => {
    expect(normalize('512-555-1234')).toBe('+15125551234')
  })

  it('strips parentheses and spaces', () => {
    expect(normalize('(512) 555-1234')).toBe('+15125551234')
  })
})

describe('SMS config validation logic', () => {
  it('throws when required env var is missing', () => {
    const validate = (env: Record<string, string | undefined>) => {
      if (!env.sid || !env.key || !env.secret || !env.from || !env.admin) {
        throw new Error('Missing Twilio env vars')
      }
    }
    expect(() => validate({ sid: 'AC', key: '', secret: 's', from: '+1', admin: '+1' })).toThrow('Missing Twilio')
    expect(() => validate({ sid: 'AC', key: 'SK', secret: 's', from: '+1', admin: '+1' })).not.toThrow()
  })
})
