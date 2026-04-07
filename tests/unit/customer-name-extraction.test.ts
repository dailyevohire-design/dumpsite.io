import { describe, it, expect } from 'vitest'
import { extractCustomerName } from '../../lib/services/customer-name'

describe('extractCustomerName', () => {
  describe('explicit introductions', () => {
    it('extracts "I\'m Mike"', () => {
      expect(extractCustomerName("I'm Mike, need 10 yards")).toBe('Mike')
    })
    it('extracts "im John"', () => {
      expect(extractCustomerName('im John looking for fill dirt')).toBe('John')
    })
    it('extracts "this is José"', () => {
      expect(extractCustomerName('this is José')).toBe('José')
    })
    it('extracts "my name is Sarah"', () => {
      expect(extractCustomerName('my name is Sarah')).toBe('Sarah')
    })
    it('extracts spanish "soy Carlos"', () => {
      expect(extractCustomerName('soy Carlos, busco tierra')).toBe('Carlos')
    })
    it('extracts "Its John"', () => {
      expect(extractCustomerName("Its John from the jobsite")).toBe('John')
    })
    it('extracts "Hey John"', () => {
      expect(extractCustomerName('Hey John need a quote')).toBe('John')
    })
  })

  describe('leading-name patterns (the bug fix)', () => {
    it('extracts "John from fb"', () => {
      expect(extractCustomerName('John from fb wanting dirt')).toBe('John')
    })
    it('extracts "Mike here"', () => {
      expect(extractCustomerName('Mike here, need 5 yards topsoil')).toBe('Mike')
    })
    it('extracts "José texting about dirt"', () => {
      expect(extractCustomerName('José texting about dirt delivery')).toBe('José')
    })
    it('extracts "Carlos checking on prices"', () => {
      expect(extractCustomerName('Carlos checking on prices')).toBe('Carlos')
    })
    it('extracts "Maria interested in fill"', () => {
      expect(extractCustomerName('Maria interested in fill')).toBe('Maria')
    })
  })

  describe('blocklist — rejects common non-name words', () => {
    it('rejects "hey there"', () => {
      expect(extractCustomerName('hey there')).toBeNull()
    })
    it('rejects "this is just a question"', () => {
      // "this is just" → "just" blocked
      expect(extractCustomerName('this is just a question')).toBeNull()
    })
    it('rejects "im really tired" (two-word capture, blocklist hits "really")', () => {
      expect(extractCustomerName('im really tired of waiting')).toBeNull()
    })
    it('rejects "fill from the pile"', () => {
      expect(extractCustomerName('fill from the pile please')).toBeNull()
    })
    it('rejects "looking from afar"', () => {
      expect(extractCustomerName('looking from afar')).toBeNull()
    })
    it('rejects "dirt here"', () => {
      expect(extractCustomerName('dirt here please')).toBeNull()
    })
  })

  describe('no name present', () => {
    it('returns null for plain question', () => {
      expect(extractCustomerName('how much for 10 yards?')).toBeNull()
    })
    it('returns null for empty string', () => {
      expect(extractCustomerName('')).toBeNull()
    })
    it('returns null for just an address', () => {
      expect(extractCustomerName('123 Main St Dallas TX')).toBeNull()
    })
  })

  describe('two-word names', () => {
    // We intentionally only capture the first token to avoid greedy
    // false-positives like "Hey John need" → "John need". Two-word names
    // get truncated to the first word, which Sarah can confirm later.
    it('captures only first token of "I\'m Mary Ann"', () => {
      expect(extractCustomerName("I'm Mary Ann")).toBe('Mary')
    })
  })
})
